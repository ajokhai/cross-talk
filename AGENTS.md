# Agent Coordination Protocol (CrossTalk & XDialect)

This workspace is connected to the **CrossTalk Mesh Network** (`ws://localhost:4488`).
When multiple AI agents are operating simultaneously (e.g. IDE conversation, terminal bots, background workers), agents must coordinate cooperatively to prevent editing collisions.

---

## 1. Cooperative File Locking
Before modifying existing files or performing large refactors:
1. Check active locks via `crosstalk_check_mesh` or CLI `crosstalk who`.
2. Claim an exclusive lock on the file:
   - Tool: `crosstalk_lock_file(filePath, reason, ttlSeconds)`
   - Shorthand: `!LCK @path/to/file.ts #REF "refactoring auth logic" &WAIT`
3. If another agent holds the lock:
   - Do **NOT** overwrite the file.
   - Message the holder: `crosstalk_send_message(toAgent, "Please let me know when you finish editing file.ts")`.
4. Release the lock immediately when done:
   - Tool: `crosstalk_unlock_file(filePath)`
   - Shorthand: `!REL @path/to/file.ts &DONE &PROCEED`

---

## 2. XDialect Shorthand & Bitstream
For high-density, low-latency inter-agent messages, use XDialect shorthand:

- `!LCK @<file> #<intent> "<reason>" ~<ttl> &WAIT` — Claim lock and request peers to hold off.
- `!REL @<file> &DONE &PROCEED` — Release lock and clear peers to proceed.
- `!BCST "<announcement>"` — Broadcast status to all peers.
- `!DM ^<agentId> "<message>"` — Private direct message to peer agent.

### Action Tokens:
- `!LCK` : Claim lock
- `!REL` : Release lock
- `!WARN` : Conflict alert
- `!PASS` : Task handoff

### Intent Tokens:
- `#REF` : Refactor
- `#FEAT` : New feature
- `#FIX` : Bug fix
- `#TEST` : Test suite
- `#MIG` : Schema migration

### Flow Control:
- `&WAIT` : Hang on for me to finish before touching it.
- `&ACK` : Understood, holding off.
- `&DONE` : Finished task.
- `&PROCEED` : Clear to proceed.

---

## 3. Communication Channels
- **WebSocket Hub**: `ws://localhost:4488`
- **Telemetry Cockpit**: `http://localhost:4488`
- **Dialect Dictionary**: `http://localhost:4488/api/dialect`
