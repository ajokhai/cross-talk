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

    ZH_TOKENS = {
        "!LCK": "申请文件独占锁",
        "!REL": "释放文件锁",
        "!BCST": "全网广播公告",
        "!DM": "定向私信发送",
        "!WARN": "文件冲突警告",
        "!PASS": "移交任务与文件锁",
        "#REF": "代码重构",
        "#FEAT": "新功能开发",
        "#FIX": "修复缺陷",
        "#TEST": "测试用例",
        "#BLD": "代码编译构建",
        "#MIG": "数据库迁移",
        "#REV": "代码审查",
        "#DOC": "文档编写",
        "&WAIT": "请稍候，等我修改完成再操作。",
        "&ACK": "已收到，暂不修改。",
        "&DONE": "工作已完成。",
        "&PROCEED": "您可以继续推进了。",
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

    @classmethod
    def to_chinese(cls, shorthand: str) -> str:
        parts = []
        tokens = shorthand.split()
        for t in tokens:
            if t.startswith("@"):
                parts.append(f'针对文件 "{t[1:]}"')
            elif t in cls.ZH_TOKENS:
                parts.append(cls.ZH_TOKENS[t])
            elif t.startswith('"') or t.startswith("'"):
                parts.append(f"（{t.strip('\"\'')}）")
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
        self.http_url = url.replace("ws://", "http://").replace("wss://", "https://")
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

    def fetch_dialect_dictionary(self) -> Dict[str, Any]:
        """Fetch versioned dialect dictionary over HTTP."""
        try:
            with urllib.request.urlopen(f"{self.http_url}/api/dialect", timeout=3) as resp:
                self.dialect = json.loads(resp.read().decode())
                return self.dialect
        except Exception as e:
            return {}

    def fetch_who(self) -> Dict[str, Any]:
        """Query active agents and locks via zero-dependency HTTP."""
        try:
            with urllib.request.urlopen(f"{self.http_url}/api/who", timeout=3) as resp:
                return json.loads(resp.read().decode())
        except Exception as e:
            return {"error": str(e), "agents": [], "locks": []}

    def fetch_history(self, limit: int = 50) -> Dict[str, Any]:
        """Fetch recent message ring buffer via zero-dependency HTTP."""
        try:
            with urllib.request.urlopen(f"{self.http_url}/api/history?limit={limit}", timeout=3) as resp:
                return json.loads(resp.read().decode())
        except Exception as e:
            return {"error": str(e), "messages": []}

    def broadcast_http(self, content: str) -> bool:
        """Broadcast message via zero-dependency HTTP."""
        try:
            data = json.dumps({
                "channel": self.channel,
                "from": self.name,
                "role": self.role,
                "content": content
            }).encode('utf-8')
            req = urllib.request.Request(
                f"{self.http_url}/api/broadcast",
                data=data,
                headers={"Content-Type": "application/json"}
            )
            with urllib.request.urlopen(req, timeout=3) as resp:
                return resp.status == 200
        except Exception as e:
            print(f"[CrossTalk] Broadcast failed: {e}")
            return False

    def connect(self):
        """Connects via WebSocket in a background thread."""
        if websocket is None:
            raise RuntimeError(
                "websocket-client package not installed. "
                "Install via `pip install websocket-client`, or use zero-dependency HTTP methods."
            )

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
        else:
            self.broadcast_http(content)

    def send_shorthand(self, shorthand: str):
        """Broadcasts concise XDialect shorthand message."""
        if self.ws and self.connected:
            self.ws.send(json.dumps({"type": "shorthand_broadcast", "shorthand": shorthand}))
        else:
            self.broadcast_http(shorthand)

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


if __name__ == '__main__':
    import sys
    import os
    import shutil

    args = sys.argv[1:]
    cmd = args[0] if args else "help"

    if cmd in ("-h", "--help", "help"):
        print("""CrossTalk Python Standalone CLI (Zero External Dependencies)

Usage: python3 crosstalk.py <command> [arguments]

Commands:
  install             Install this single-file script to system PATH (/usr/local/bin or ~/.local/bin)
  who                 Query connected agents and active file locks
  dict                Print the versioned XDialect token dictionary
  to-zh <expr>        Translate XDialect shorthand to natural Chinese
  to-human <expr>     Translate XDialect shorthand to natural English
  msg <content>       Broadcast a message to the mesh network
  short <expr>        Broadcast concise XDialect shorthand
  history [limit]     Display recent message ring buffer (last 50-100 msgs)
""")
        sys.exit(0)

    elif cmd == "install":
        target_dir = os.environ.get("CROSSTALK_BIN_DIR")
        if not target_dir:
            if hasattr(os, "getuid") and os.getuid() == 0:
                target_dir = "/usr/local/bin"
            elif os.access("/usr/local/bin", os.W_OK):
                target_dir = "/usr/local/bin"
            else:
                target_dir = os.path.expanduser("~/.local/bin")

        os.makedirs(target_dir, exist_ok=True)
        target_file = os.path.join(target_dir, "crosstalk")
        this_file = os.path.abspath(__file__)
        shutil.copy2(this_file, target_file)
        os.chmod(target_file, 0o755)

        print(f"\n✔ CrossTalk Python CLI successfully installed to {target_file}!")
        print("✔ Air-gapped single-file installation complete without internet connection.")
        if target_dir not in os.environ.get("PATH", ""):
            print(f"\nNotice: {target_dir} is not in your PATH. Add it to ~/.bashrc or ~/.zshrc:")
            print(f'  export PATH="{target_dir}:$PATH"\n')
        else:
            print(f"You can now run: crosstalk who, crosstalk dict, crosstalk to-zh\n")

    elif cmd == "who":
        client = CrossTalkClient(name="Python-CLI")
        res = client.fetch_who()
        agents = res.get("agents", [])
        locks = res.get("locks", [])
        print(f"\n=== CrossTalk Mesh State ===")
        print(f"Active Agents ({len(agents)}):")
        for a in agents:
            print(f"  🤖 {a.get('name', 'Unknown')} ({a.get('role', 'agent')} · {a.get('environment', 'os')})")
        print(f"Active Locks ({len(locks)}):")
        if not locks:
            print("  (No files currently locked)")
        for l in locks:
            print(f"  🔒 {l.get('file')} held by {l.get('holderName')} ({l.get('reason')})")
        print()

    elif cmd == "dict":
        print("\n📖 XDialect Dictionary v1.0.0 (Zero-Dependency Stdlib)")
        for k, v in XDialect.TOKENS.items():
            zh = XDialect.ZH_TOKENS.get(k, "")
            print(f"  {k:8} : {v} | {zh}")
        print()

    elif cmd == "to-zh":
        expr = " ".join(args[1:]) if len(args) > 1 else "!LCK @src/api.py #FIX 'null' ~60 &WAIT"
        print(f"\nShorthand: {expr}")
        print(f"中文展开:  {XDialect.to_chinese(expr)}\n")

    elif cmd == "to-human":
        expr = " ".join(args[1:]) if len(args) > 1 else "!LCK @src/api.py #FIX 'null' ~60 &WAIT"
        print(f"\nShorthand: {expr}")
        print(f"English:   {XDialect.to_human(expr)}\n")

    elif cmd == "msg":
        content = " ".join(args[1:])
        if not content:
            print("Error: Message content required.")
            sys.exit(1)
        client = CrossTalkClient(name="Python-CLI")
        ok = client.broadcast_http(content)
        print("✔ Broadcast sent." if ok else "✖ Broadcast failed.")

    elif cmd == "short":
        content = " ".join(args[1:])
        client = CrossTalkClient(name="Python-CLI")
        ok = client.broadcast_http(content)
        print("✔ Shorthand broadcast sent." if ok else "✖ Shorthand broadcast failed.")

    elif cmd == "history":
        limit = int(args[1]) if len(args) > 1 else 10
        client = CrossTalkClient(name="Python-CLI")
        res = client.fetch_history(limit)
        msgs = res.get("messages", [])
        print(f"\n=== Recent Messages ({len(msgs)}) ===")
        for m in msgs:
            sender = m.get("from", {}).get("name", "System") if isinstance(m.get("from"), dict) else m.get("from", "System")
            print(f"[{sender}] {m.get('content')}")
        print()
    else:
        print(f"Unknown command: {cmd}. Run with --help.")

