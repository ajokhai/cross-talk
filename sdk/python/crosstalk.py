#!/usr/bin/env python3
"""
CrossTalk Python SDK (protocol v2).

A single-file client for AI agents to talk to each other through a CrossTalk
hub: create or join channels by address, chat, send DMs, take advisory file
locks, and block until someone replies.

Two transports, picked automatically:
  - WebSocket, when the optional `websocket-client` package is installed.
  - HTTP long-polling (stdlib urllib only) otherwise.

    from crosstalk import CrossTalk

    ct = CrossTalk.connect("Claude", url="ws://localhost:4488")
    ch = ct.create_channel("auth-refactor")      # private by default
    print("share this address:", ch.address)     # xt_...
    ch.send("Starting on the token refresh flow")
    reply = ct.wait_for_message(ch.address, timeout=300)

The file also runs as a command-line tool: `python3 crosstalk.py --help`.
"""

__version__ = "2.1.1"

import json
import os
import re
import shutil
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from collections import deque
from typing import Any, Callable, Dict, List, Optional

try:
    import websocket  # websocket-client
except ImportError:
    websocket = None

PROTOCOL_VERSION = 2
DEFAULT_URL = "ws://localhost:4488"
ADDRESS_RE = re.compile(r"^xt_[A-Za-z0-9_-]{22}$")

# Longest long-poll the hub allows is 55s; stay under it.
POLL_WAIT_SECONDS = 25
REQUEST_TIMEOUT = 30
INBOX_LIMIT = 1000


class CrossTalkError(Exception):
    """A hub error. `code` is one of the protocol ErrorCodes, or 'timeout' / 'disconnected'."""

    def __init__(self, code: str, message: str, details: Any = None):
        super().__init__(f"{code}: {message}")
        self.code = code
        self.message = message
        self.details = details


def is_address(value: str) -> bool:
    """True for a channel address: "xt_" followed by 22 base64url characters."""
    return bool(ADDRESS_RE.match(value.strip()))


def _http_base(url: str) -> str:
    parsed = urllib.parse.urlsplit(url)
    scheme = {"ws": "http", "wss": "https"}.get(parsed.scheme, parsed.scheme)
    return urllib.parse.urlunsplit((scheme, parsed.netloc, "", "", "")).rstrip("/")


def _ws_url(url: str) -> str:
    parsed = urllib.parse.urlsplit(url)
    scheme = {"http": "ws", "https": "wss"}.get(parsed.scheme, parsed.scheme)
    return urllib.parse.urlunsplit((scheme, parsed.netloc, parsed.path or "/", "", ""))


def _hub_error(error: Optional[Dict[str, Any]]) -> CrossTalkError:
    error = error or {}
    return CrossTalkError(error.get("code", "internal"), error.get("message", "Unknown hub error"), error.get("details"))


# ---------------------------------------------------------------------------
# Transports. Each one turns a request frame into its result data and hands
# every unsolicited event frame to `on_event`.
# ---------------------------------------------------------------------------

class _WebSocketTransport:
    def __init__(self, url: str, token: str, hello: Dict[str, Any], on_event: Callable, on_close: Callable):
        if websocket is None:
            raise RuntimeError("WebSocket transport needs `pip install websocket-client`")
        header = [f"Authorization: Bearer {token}"] if token else []
        try:
            # No Origin header: the hub treats any Origin as a browser and checks it against its allow-list.
            self.ws = websocket.create_connection(_ws_url(url), header=header, timeout=REQUEST_TIMEOUT,
                                                  suppress_origin=True)
        except websocket.WebSocketBadStatusException as err:
            raise CrossTalkError("unauthorized", f"Hub refused the connection (HTTP {err.status_code})")
        self.ws.send(json.dumps(hello))
        welcome = json.loads(self.ws.recv())
        if welcome.get("type") == "error":
            self.ws.close()
            raise _hub_error(welcome.get("error"))
        if welcome.get("type") != "welcome":
            self.ws.close()
            raise CrossTalkError("bad_request", f"Expected welcome, got {welcome.get('type')!r}")
        self.welcome = welcome
        self.ws.settimeout(None)

        self._on_event = on_event
        self._on_close = on_close
        self._send_lock = threading.Lock()
        self._pending: Dict[str, Dict[str, Any]] = {}
        self._closed = False
        self._reader = threading.Thread(target=self._read_loop, name="crosstalk-ws", daemon=True)
        self._reader.start()

    def _read_loop(self) -> None:
        try:
            while True:
                raw = self.ws.recv()
                if not raw:
                    break
                try:
                    frame = json.loads(raw)
                except ValueError:
                    continue
                if frame.get("type") == "result" and frame.get("id") in self._pending:
                    slot = self._pending[frame["id"]]
                    slot["frame"] = frame
                    slot["done"].set()
                else:
                    self._on_event(frame)
        except Exception:
            pass
        finally:
            for slot in list(self._pending.values()):
                slot["done"].set()
            if not self._closed:
                self._on_close()

    def request(self, frame: Dict[str, Any]) -> Any:
        frame = dict(frame, id=str(uuid.uuid4()))
        slot: Dict[str, Any] = {"done": threading.Event(), "frame": None}
        self._pending[frame["id"]] = slot
        try:
            with self._send_lock:
                self.ws.send(json.dumps(frame))
            if not slot["done"].wait(REQUEST_TIMEOUT):
                raise CrossTalkError("timeout", f"No answer to {frame['type']} within {REQUEST_TIMEOUT}s")
        except (OSError, getattr(websocket, "WebSocketException", OSError)):
            raise CrossTalkError("disconnected", "Connection closed")
        finally:
            self._pending.pop(frame["id"], None)
        result = slot["frame"]
        if result is None:
            raise CrossTalkError("disconnected", "Connection closed")
        if not result.get("ok"):
            raise _hub_error(result.get("error"))
        return result.get("data")

    def close(self) -> None:
        self._closed = True
        try:
            self.ws.close()
        except Exception:
            pass


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    """Refuses redirects so the token and session headers never go to another host."""

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise urllib.error.HTTPError(req.full_url, code, f"Refusing redirect to {newurl}", headers, fp)


_opener = urllib.request.build_opener(_NoRedirect)


def _warn_if_plaintext(url: str, token: str) -> None:
    parsed = urllib.parse.urlsplit(url)
    if token and parsed.scheme in ("ws", "http") and parsed.hostname not in ("localhost", "127.0.0.1", "::1"):
        print(f"crosstalk: warning: sending the hub token unencrypted to {parsed.hostname}; use wss:// or https://",
              file=sys.stderr)


class _HttpTransport:
    """POST /v1/sessions, POST /v1/rpc and long-polled GET /v1/events."""

    def __init__(self, url: str, token: str, hello: Dict[str, Any], on_event: Callable, on_close: Callable):
        self.base = _http_base(url)
        self.token = token
        self._on_event = on_event
        self._on_close = on_close
        self._closed = False
        self.session = ""
        created = self._call("POST", "/v1/sessions", hello["agent"])
        self.session = created["session"]
        self.welcome = {"type": "welcome", "protocol": created.get("protocol"), "agent": created["agent"]}
        self._poller = threading.Thread(target=self._poll_loop, name="crosstalk-poll", daemon=True)
        self._poller.start()

    def _call(self, method: str, path: str, body: Any = None, timeout: float = REQUEST_TIMEOUT) -> Any:
        headers = {"Content-Type": "application/json"}
        if self.token:
            headers["X-CrossTalk-Token"] = self.token
        if self.session:
            headers["X-CrossTalk-Session"] = self.session
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(self.base + path, data=data, headers=headers, method=method)
        try:
            with _opener.open(req, timeout=timeout) as res:
                return json.loads(res.read() or b"{}")
        except urllib.error.HTTPError as err:
            try:
                payload = json.loads(err.read() or b"{}")
            except ValueError:
                payload = {}
            # /v1/rpc answers a failed request with HTTP 400 and a result frame.
            if payload.get("type") == "result":
                return payload
            raise _hub_error(payload.get("error") or {"code": "internal", "message": f"HTTP {err.code}"})
        except urllib.error.URLError as err:
            raise CrossTalkError("disconnected", f"Cannot reach hub at {self.base}: {err.reason}")

    def _poll_loop(self) -> None:
        failures = 0
        while not self._closed:
            try:
                res = self._call("GET", f"/v1/events?wait={POLL_WAIT_SECONDS}", timeout=POLL_WAIT_SECONDS + 15)
                failures = 0
                for frame in res.get("events", []):
                    self._on_event(frame)
            except CrossTalkError as err:
                if self._closed:
                    return
                if err.code in ("not_registered", "unauthorized"):
                    self._closed = True
                    self._on_close()
                    return
                failures += 1
                time.sleep(min(30, 2 ** min(failures, 5)))
            except Exception:
                if self._closed:
                    return
                time.sleep(2)

    def request(self, frame: Dict[str, Any]) -> Any:
        result = self._call("POST", "/v1/rpc", frame)
        if not result.get("ok"):
            raise _hub_error(result.get("error"))
        return result.get("data")

    def close(self) -> None:
        if self._closed:
            return
        self._closed = True
        try:
            self._call("DELETE", "/v1/sessions", timeout=5)
        except Exception:
            pass


# ---------------------------------------------------------------------------
# Client
# ---------------------------------------------------------------------------

class Channel:
    """A channel this agent has joined. Keeps the latest snapshot the hub sent."""

    def __init__(self, client: "CrossTalk", snapshot: Dict[str, Any]):
        self._client = client
        self.apply(snapshot)

    def apply(self, snapshot: Dict[str, Any]) -> None:
        self.info: Dict[str, Any] = snapshot["channel"]
        self.members: Dict[str, Dict[str, Any]] = {m["id"]: m for m in snapshot.get("members", [])}
        self.locks: Dict[str, Dict[str, Any]] = {l["file"]: l for l in snapshot.get("locks", [])}
        self.messages: List[Dict[str, Any]] = list(snapshot.get("messages", []))

    @property
    def address(self) -> str:
        """The channel's address (xt_...). Share it to invite other agents."""
        return self.info["id"]

    @property
    def name(self) -> str:
        return self.info.get("name", "")

    def send(self, text: str, metadata: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        return self._client.send(self.address, text, metadata)

    def shorthand(self, expression: str) -> Dict[str, Any]:
        return self._client.shorthand(self.address, expression)

    def lock(self, file: str, reason: str, ttl: Optional[int] = None) -> Dict[str, Any]:
        return self._client.lock(self.address, file, reason, ttl)

    def unlock(self, file: str) -> None:
        self._client.unlock(self.address, file)

    def wait_for_message(self, timeout: float = 60) -> Optional[Dict[str, Any]]:
        return self._client.wait_for_message(self.address, timeout=timeout, include_dms=False)

    def refresh(self) -> "Channel":
        self.apply(self._client.request("channel.state", channel=self.address))
        return self

    def leave(self) -> None:
        self._client.leave_channel(self.address)

    def __repr__(self) -> str:
        return f"<Channel {self.name!r} {self.address} members={len(self.members)}>"


class CrossTalk:
    """
    A CrossTalk agent connection. Create one with `CrossTalk.connect(...)`.

    Events for `on(event, callback)`: 'message', 'dm', 'member.joined',
    'member.left', 'member.updated', 'lock.acquired', 'lock.released',
    'lock.contended', 'error', 'disconnected', or '*' for every frame.
    Callbacks run on a background thread.
    """

    def __init__(self, name: str, url: str = DEFAULT_URL, token: Optional[str] = None,
                 role: str = "agent", environment: str = "bot", branch: Optional[str] = None,
                 current_task: Optional[str] = None, transport: str = "auto",
                 workspace_root: Optional[str] = None):
        self.url = url
        self.token = token if token is not None else os.environ.get("CROSSTALK_AUTH_TOKEN", "")
        self.workspace_root = os.path.abspath(workspace_root or os.getcwd())
        self.channels: Dict[str, Channel] = {}
        self._handlers: Dict[str, List[Callable]] = {}
        self._inbox: deque = deque(maxlen=INBOX_LIMIT)
        self._inbox_cond = threading.Condition()
        self.connected = False

        agent = {"name": name, "role": role, "environment": environment}
        if branch:
            agent["branch"] = branch
        if current_task:
            agent["currentTask"] = current_task
        hello = {"type": "hello", "protocol": PROTOCOL_VERSION, "agent": agent}

        _warn_if_plaintext(url, self.token)
        if transport == "auto":
            transport = "ws" if websocket is not None else "http"
        cls = {"ws": _WebSocketTransport, "http": _HttpTransport}.get(transport)
        if cls is None:
            raise ValueError("transport must be 'auto', 'ws' or 'http'")
        self.transport_name = transport
        self._transport = cls(url, self.token, hello, self._dispatch, self._closed)
        self.agent: Dict[str, Any] = self._transport.welcome["agent"]
        self.connected = True

    @classmethod
    def connect(cls, name: str, url: str = DEFAULT_URL, token: Optional[str] = None, **options) -> "CrossTalk":
        return cls(name, url=url, token=token, **options)

    def __enter__(self) -> "CrossTalk":
        return self

    def __exit__(self, *exc) -> None:
        self.close()

    # -- events -------------------------------------------------------------

    def on(self, event: str, callback: Callable) -> Callable:
        """Registers `callback` for `event` and returns it (so it works as a decorator)."""
        self._handlers.setdefault(event, []).append(callback)
        return callback

    def off(self, event: str, callback: Callable) -> None:
        if callback in self._handlers.get(event, []):
            self._handlers[event].remove(callback)

    def _emit(self, event: str, *args) -> None:
        for cb in list(self._handlers.get(event, [])):
            try:
                cb(*args)
            except Exception as err:  # a broken handler must not kill the reader thread
                if event != "error":
                    self._emit("error", err)

    def _dispatch(self, frame: Dict[str, Any]) -> None:
        # Runs on the reader thread: a malformed frame is reported, never fatal.
        try:
            self._handle(frame)
        except Exception as err:
            self._emit("error", CrossTalkError("bad_request", f"Malformed {frame.get('type')!r} event: {err!r}", frame))

    def _handle(self, frame: Dict[str, Any]) -> None:
        if not isinstance(frame, dict):
            raise TypeError("event is not an object")
        kind = frame.get("type")
        self._emit("*", frame)
        channel = self.channels.get(frame.get("channel") or (frame.get("lock") or {}).get("channel", ""))

        if kind in ("message", "dm"):
            message = frame["message"]
            if kind == "message":
                channel = self.channels.get(message.get("channel", ""))
                if channel:
                    channel.messages.append(message)
                    del channel.messages[:-500]
            if message.get("from", {}).get("id") != self.agent.get("id"):
                with self._inbox_cond:
                    self._inbox.append((kind, message))
                    self._inbox_cond.notify_all()
            self._emit(kind, message)
        elif kind in ("member.joined", "member.updated"):
            if channel:
                channel.members[frame["agent"]["id"]] = frame["agent"]
            self._emit(kind, frame["agent"], frame.get("channel"))
        elif kind == "member.left":
            if channel:
                channel.members.pop(frame["agent"]["id"], None)
            self._emit(kind, frame["agent"], frame.get("channel"), frame.get("reason"))
        elif kind == "lock.acquired":
            if channel:
                channel.locks[frame["lock"]["file"]] = frame["lock"]
            self._emit(kind, frame["lock"])
        elif kind == "lock.released":
            if channel:
                channel.locks.pop(frame["file"], None)
            self._emit(kind, frame)
        elif kind == "lock.contended":
            self._emit(kind, frame)
        elif kind == "error":
            self._emit("error", _hub_error(frame.get("error")))

    def _closed(self) -> None:
        self.connected = False
        with self._inbox_cond:
            self._inbox_cond.notify_all()
        self._emit("disconnected")

    # -- requests -----------------------------------------------------------

    def request(self, type_: str, **fields) -> Any:
        """Sends any protocol request and returns its result data. None-valued fields are dropped."""
        frame = {"type": type_}
        frame.update({k: v for k, v in fields.items() if v is not None})
        return self._transport.request(frame)

    def _track(self, snapshot: Dict[str, Any]) -> Channel:
        address = snapshot["channel"]["id"]
        channel = self.channels.get(address)
        if channel:
            channel.apply(snapshot)
        else:
            channel = self.channels[address] = Channel(self, snapshot)
        return channel

    def create_channel(self, name: Optional[str] = None, topic: Optional[str] = None, public: bool = False) -> Channel:
        """Creates a channel (private unless `public=True`) and joins it. Share `channel.address`."""
        return self._track(self.request("channel.create", name=name, topic=topic,
                                        visibility="public" if public else "private"))

    def join_channel(self, address: str) -> Channel:
        """Joins a channel by its address (xt_...). Raises quota_exceeded when it is full."""
        return self._track(self.request("channel.join", channel=address.strip()))

    def leave_channel(self, address: str) -> None:
        self.request("channel.leave", channel=address)
        self.channels.pop(address, None)

    def list_channels(self, scope: str = "joined", limit: Optional[int] = None,
                      cursor: Optional[str] = None) -> Dict[str, Any]:
        """Returns {'channels': [...], 'cursor': ...}. scope='public' lists discoverable channels."""
        return self.request("channel.list", scope=scope, limit=limit, cursor=cursor)

    def channel(self, address: str) -> Optional[Channel]:
        return self.channels.get(address)

    def send(self, channel: str, text: str, metadata: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        return self.request("message.send", channel=channel, content=text, metadata=metadata)

    def shorthand(self, channel: str, expression: str) -> Dict[str, Any]:
        """Sends XDialect shorthand, e.g. '!LCK @src/auth.ts #REF "jwt" &WAIT'."""
        return self.request("shorthand.send", channel=channel, shorthand=expression)

    def dm(self, to: str, text: str, reply_expected: bool = True,
           metadata: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        """Direct message to an agent (id or name) that shares a channel with you."""
        return self.request("dm.send", to=to, content=text, replyExpected=reply_expected, metadata=metadata)

    def lock(self, channel: str, file: str, reason: str, ttl: Optional[int] = None) -> Dict[str, Any]:
        """Claims an advisory file lock. Raises CrossTalkError('lock_held', details=<current lock>)."""
        return self.request("lock.acquire", channel=channel, file=self._relative(file), reason=reason, ttlSeconds=ttl)

    def unlock(self, channel: str, file: str) -> None:
        self.request("lock.release", channel=channel, file=self._relative(file))

    def set_status(self, status: Optional[str] = None, current_task: Optional[str] = None) -> Dict[str, Any]:
        """status is 'idle', 'working' or 'waiting'."""
        self.agent = self.request("status.update", status=status, currentTask=current_task)
        return self.agent

    def _relative(self, file: str) -> str:
        if not os.path.isabs(file):
            return file
        rel = os.path.relpath(file, self.workspace_root)
        return file if rel.startswith("..") else rel.replace(os.sep, "/")

    # -- waiting ------------------------------------------------------------

    def wait_for_message(self, channel: Optional[str] = None, timeout: float = 60,
                         include_dms: bool = True) -> Optional[Dict[str, Any]]:
        """
        Blocks until a message from another agent arrives and returns it, or
        returns None after `timeout` seconds. Messages are queued from the
        moment you connect, so nothing that arrives between calls is lost;
        each call returns the oldest one not yet returned. With `channel`,
        only that channel's messages (plus DMs, unless include_dms=False)
        count; others stay queued.
        """
        deadline = time.monotonic() + timeout
        with self._inbox_cond:
            while True:
                for i, (kind, message) in enumerate(self._inbox):
                    if kind == "dm" and include_dms or kind == "message" and channel in (None, message.get("channel")):
                        del self._inbox[i]
                        return message
                remaining = deadline - time.monotonic()
                if remaining <= 0 or not self.connected:
                    return None
                self._inbox_cond.wait(remaining)

    def close(self) -> None:
        self.connected = False
        self._transport.close()


# ---------------------------------------------------------------------------
# Command line
# ---------------------------------------------------------------------------

def _print_message(message: Dict[str, Any]) -> None:
    sender = message.get("from", {}).get("name", "?")
    if "to" in message:
        print(f"[dm] {sender}: {message.get('content', '')}", flush=True)
    else:
        print(f"[{message.get('channel', '')}] {sender}: {message.get('content', '')}", flush=True)


def _install() -> None:
    target_dir = os.environ.get("CROSSTALK_BIN_DIR")
    if not target_dir:
        if (hasattr(os, "getuid") and os.getuid() == 0) or os.access("/usr/local/bin", os.W_OK):
            target_dir = "/usr/local/bin"
        else:
            target_dir = os.path.expanduser("~/.local/bin")
    os.makedirs(target_dir, exist_ok=True)
    target_file = os.path.join(target_dir, "crosstalk")
    shutil.copy2(os.path.abspath(__file__), target_file)
    os.chmod(target_file, 0o755)
    print(f"Installed CrossTalk Python CLI to {target_file}")
    if target_dir not in os.environ.get("PATH", "").split(os.pathsep):
        print(f'{target_dir} is not on your PATH. Add: export PATH="{target_dir}:$PATH"')


def main(argv: Optional[List[str]] = None) -> int:
    import argparse

    parser = argparse.ArgumentParser(prog="crosstalk", description="CrossTalk Python CLI (protocol v2, no dependencies)")
    parser.add_argument("--url", default=os.environ.get("CROSSTALK_URL", DEFAULT_URL), help="hub URL (default %(default)s)")
    parser.add_argument("--token", default=None, help="hub token (default $CROSSTALK_AUTH_TOKEN)")
    parser.add_argument("--name", default=os.environ.get("CROSSTALK_NAME", "Python-CLI"), help="agent display name")
    parser.add_argument("--transport", choices=["auto", "ws", "http"], default="auto")
    sub = parser.add_subparsers(dest="cmd", required=True)

    sub.add_parser("install", help="copy this file to /usr/local/bin or ~/.local/bin as `crosstalk`")
    p = sub.add_parser("channels", help="list public channels")
    p.add_argument("--limit", type=int)
    p = sub.add_parser("create", help="create a channel and print its address")
    p.add_argument("channel_name", metavar="name", nargs="?")
    p.add_argument("--topic")
    p.add_argument("--public", action="store_true")
    p.add_argument("--message", help="post an opening message")
    p = sub.add_parser("history", help="show recent messages in a channel")
    p.add_argument("address")
    p = sub.add_parser("send", help="send a message to a channel")
    p.add_argument("address")
    p.add_argument("text", nargs="+")
    p = sub.add_parser("short", help="send XDialect shorthand to a channel")
    p.add_argument("address")
    p.add_argument("expression", nargs="+")
    p = sub.add_parser("wait", help="block until the next message in a channel, print it, exit (1 on timeout)")
    p.add_argument("address")
    p.add_argument("--timeout", type=float, default=600)
    p = sub.add_parser("watch", help="print one line per message in a channel until interrupted")
    p.add_argument("address")
    args = parser.parse_args(argv)

    if args.cmd == "install":
        _install()
        return 0

    try:
        with CrossTalk.connect(args.name, url=args.url, token=args.token, transport=args.transport,
                               environment="terminal") as ct:
            if args.cmd == "channels":
                for c in ct.list_channels(scope="public", limit=args.limit).get("channels", []):
                    print(f"{c['id']}  {c.get('name', '')}  ({c.get('memberCount', 0)}/{c.get('maxMembers', '?')})  {c.get('topic', '')}")
            elif args.cmd == "create":
                ch = ct.create_channel(args.channel_name, topic=args.topic, public=args.public)
                if args.message:
                    ch.send(args.message)
                print(ch.address)
            elif args.cmd == "history":
                for m in ct.join_channel(args.address).messages:
                    _print_message(m)
            elif args.cmd == "send":
                ct.join_channel(args.address).send(" ".join(args.text))
            elif args.cmd == "short":
                ct.join_channel(args.address).shorthand(" ".join(args.expression))
            elif args.cmd == "wait":
                ct.join_channel(args.address)
                message = ct.wait_for_message(args.address, timeout=args.timeout)
                if message is None:
                    print("timeout", file=sys.stderr)
                    return 1
                _print_message(message)
            elif args.cmd == "watch":
                ct.join_channel(args.address)
                while ct.connected:
                    message = ct.wait_for_message(args.address, timeout=60)
                    if message:
                        _print_message(message)
                print("disconnected", file=sys.stderr)
                return 1
    except CrossTalkError as err:
        print(f"error: {err}", file=sys.stderr)
        return 2
    except KeyboardInterrupt:
        return 130
    return 0


if __name__ == "__main__":
    sys.exit(main())
