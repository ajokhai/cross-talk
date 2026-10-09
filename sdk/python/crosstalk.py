"""
CrossTalk Python SDK
Lightweight, zero-bloat client for AI agents to communicate over the CrossTalk mesh,
exchange XDialect shorthand, and acquire cooperative file locks.
"""

import json
import time
import threading
import urllib.request
from typing import Optional, Dict, Any, Callable

try:
    import websocket
except ImportError:
    websocket = None


class XDialect:
    """Helper for parsing and formatting XDialect shorthand in Python."""

    TOKENS = {
        "!LCK": "Claiming exclusive file lock",
        "!REL": "Releasing file lock",
        "!BCST": "Announcing to all agents",
        "!DM": "Direct message to agent",
        "!WARN": "Conflict Alert",
        "#REF": "refactoring",
        "#FEAT": "implementing new feature",
        "#FIX": "fixing bug",
        "#TEST": "testing",
        "&WAIT": "Hang on for me to finish before touching it.",
        "&ACK": "Understood, holding off.",
        "&DONE": "Finished work.",
        "&PROCEED": "You are clear to proceed now.",
    }

    @classmethod
    def to_human(cls, shorthand: str) -> str:
        parts = []
        tokens = shorthand.split()
        for t in tokens:
            if t.startswith("@"):
                parts.append(f'on "{t[1:]}"')
            elif t in cls.TOKENS:
                parts.append(cls.TOKENS[t])
            elif t.startswith('"') or t.startswith("'"):
                parts.append(f"({t.strip('\"\'')})")
        return " ".join(parts) if parts else shorthand


class CrossTalkClient:
    def __init__(
        self,
        name: str,
        role: str = "developer",
        url: str = "ws://localhost:4488",
        channel: str = "default",
        workspace: str = ".",
    ):
        self.name = name
        self.role = role
        self.url = url
        self.channel = channel
        self.workspace = workspace
        self.agent_id: Optional[str] = None
        self.dialect: Dict[str, Any] = {}
        self.ws = None
        self.connected = False
        self._handlers: Dict[str, list] = {}

    def on(self, event: str, handler: Callable):
        if event not in self._handlers:
            self._handlers[event] = []
        self._handlers[event].append(handler)

    def _emit(self, event: str, *args, **kwargs):
        for h in self._handlers.get(event, []):
            try:
                h(*args, **kwargs)
            except Exception as e:
                print(f"[CrossTalk] Error in event handler: {e}")

    def fetch_dialect_dictionary(self, http_url: str = "http://localhost:4488/api/dialect") -> Dict[str, Any]:
        """Fetch versioned dialect dictionary over HTTP."""
        try:
            with urllib.request.urlopen(http_url, timeout=3) as resp:
                self.dialect = json.loads(resp.read().decode())
                return self.dialect
        except Exception as e:
            print(f"[CrossTalk] Warning: Could not fetch dialect dictionary: {e}")
            return {}

    def connect(self):
        """Connects via WebSocket in a background thread."""
        if websocket is None:
            raise RuntimeError("Please install 'websocket-client' (`pip install websocket-client`)")

        def on_open(ws):
            self.connected = True
            reg = {
                "type": "register",
                "channel": self.channel,
                "agent": {
                    "name": self.name,
                    "role": self.role,
                    "environment": "bot",
                    "workspace": self.workspace,
                    "currentTask": "Connected via Python SDK",
                },
            }
            ws.send(json.dumps(reg))

        def on_message(ws, msg_raw):
            try:
                packet = json.loads(msg_raw)
                ptype = packet.get("type")
                if ptype == "registered":
                    self.agent_id = packet.get("agentId")
                    self.dialect = packet.get("dialect", {})
                    self._emit("ready", packet)
                elif ptype == "broadcast":
                    self._emit("broadcast", packet.get("message"))
                elif ptype == "lock_acquired":
                    self._emit("lock_acquired", packet.get("lock"))
                elif ptype == "lock_conflict_warning":
                    self._emit("lock_conflict_warning", packet)
            except Exception as e:
                self._emit("error", e)

        def on_close(ws, close_status, close_msg):
            self.connected = False
            self._emit("disconnected")

        self.ws = websocket.WebSocketApp(
            self.url,
            on_open=on_open,
            on_message=on_message,
            on_close=on_close,
        )

        w_thread = threading.Thread(target=self.ws.run_forever, daemon=True)
        w_thread.start()

        # Wait up to 3s for registration
        start = time.time()
        while not self.agent_id and time.time() - start < 3:
            time.sleep(0.05)

    def broadcast(self, content: str):
        if self.ws and self.connected:
            self.ws.send(json.dumps({"type": "broadcast", "content": content}))

    def send_shorthand(self, shorthand: str):
        """Broadcasts concise XDialect shorthand message."""
        if self.ws and self.connected:
            self.ws.send(json.dumps({"type": "shorthand_broadcast", "shorthand": shorthand}))

    def lock_file(self, file_path: str, reason: str, ttl_seconds: int = 300):
        if self.ws and self.connected:
            self.ws.send(
                json.dumps(
                    {
                        "type": "lock_acquire",
                        "file": file_path,
                        "reason": reason,
                        "ttlSeconds": ttl_seconds,
                    }
                )
            )

    def unlock_file(self, file_path: str):
        if self.ws and self.connected:
            self.ws.send(json.dumps({"type": "lock_release", "file": file_path}))

    def disconnect(self):
        if self.ws:
            self.ws.close()
