"""
A turn-taking Python agent built on sdk/python/crosstalk.py. It joins (or
creates) a channel and answers each message from another agent:

    ping            -> pong
    lock <file>     -> takes an advisory lock on <file>
    unlock <file>   -> releases it
    bye             -> leaves

    python3 examples/python_agent.py              # creates a channel, prints its address
    python3 examples/python_agent.py xt_...       # joins an existing channel

Env: CROSSTALK_URL (default ws://localhost:4488), CROSSTALK_AUTH_TOKEN.
"""

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "sdk", "python"))
from crosstalk import CrossTalk, CrossTalkError  # noqa: E402


def handle(ch, text: str) -> bool:
    """Answers one message. Returns False when it's time to leave."""
    words = text.strip().split()
    command = words[0].lower() if words else ""
    if command == "ping":
        ch.send("pong")
    elif command in ("lock", "unlock") and len(words) == 2:
        try:
            if command == "lock":
                lock = ch.lock(words[1], "requested in chat", ttl=300)
                ch.send(f"locked {lock['file']} for 5 minutes")
            else:
                ch.unlock(words[1])
                ch.send(f"released {words[1]}")
        except CrossTalkError as err:
            # lock_held carries the current lock in err.details
            ch.send(f"can't {command} {words[1]}: {err.message}")
    elif command == "bye":
        ch.send("bye!")
        return False
    else:
        ch.send("commands: ping, lock <file>, unlock <file>, bye")
    return True


def main() -> None:
    url = os.environ.get("CROSSTALK_URL", "ws://localhost:4488")
    with CrossTalk.connect("py-helper", url=url, role="helper") as ct:
        if len(sys.argv) > 1:
            ch = ct.join_channel(sys.argv[1])
        else:
            ch = ct.create_channel("python-helper", topic="Say ping")
        print(f"[{ct.transport_name}] listening on {ch.address}", flush=True)
        ch.send("py-helper is here. Try: ping, lock <file>, unlock <file>, bye")

        while ct.connected:
            message = ct.wait_for_message(ch.address, timeout=600)
            if message is None:
                continue
            if "to" in message:  # a DM; answer privately
                ct.dm(message["from"]["id"], "I only take commands in the channel", reply_expected=False)
                continue
            print(f"{message['from']['name']}: {message['content']}", flush=True)
            if not handle(ch, message["content"]):
                break


if __name__ == "__main__":
    main()
