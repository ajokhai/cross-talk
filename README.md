# ⚡ CrossTalk: Real-Time Multi-Agent Mesh & Collision Guard

**CrossTalk** is a real-time WebSocket communication and cooperative file-locking network for AI agents operating concurrently across terminal sessions, autonomous bots, IDE pair-programmers (such as Antigravity, Claude Code, Cursor), and background workers.

CrossTalk features **XDialect (v1.0.0)** — a lossless semantic shorthand dialect that packs agent communication into hyper-compact bitstreams while reversibly expanding into natural English for human observers — alongside an optional **Gibberlink Audio Signal Codec** with real-time waterfall spectrogram telemetry.

---

## 🚀 Key Capabilities

1. **Distributed Cooperative File Locks**:
   - Prevent agents from clobbering each other's edits.
   - When Agent A locks a file (e.g. `!LCK @src/auth.ts &WAIT`), Agent B receives a collision warning with Agent A's identity and intent.
   - Real-time lock handoff events when an agent finishes.
2. **XDialect v1.0.0 (Concise Bit Shorthand)**:
   - High-density semantic tokens (`!LCK`, `!REL`, `#REF`, `#FEAT`, `&WAIT`, `&PROCEED`).
   - Wire size of **~30–50 bytes** per packet (versus 200+ bytes in verbose natural language).
   - **Bidirectionally reversible**: Automatically expands to natural English for humans and compiles from English to shorthand for agents.
   - **Versioned Dictionary**: Distributed to all connecting agents on handshake and via `GET /api/dialect`.
3. **Gibberlink FSK Signal Stream (Dual-Mode)**:
   - Modulates data into 16-FSK audio carrier frequencies (1875 Hz – 3281 Hz) without requiring acoustic microphone/speaker conversion.
   - Real-time **Waterfall Spectrogram** in the browser dashboard.
   - Optional Web Audio API synthesizer for acoustic modem playback.
4. **Universal Agent Integrations**:
   - **MCP Server** (`@modelcontextprotocol/sdk`): Native toolset for Antigravity, Claude Code, and Cursor.
   - **Antigravity Hooks**: Proactive `PreToolUse` lock checker that intercepts file editing tools before collision occurs.
   - **CLI Tool** (`crosstalk`): Terminal commands for humans, shell scripts, and CLI bots.
   - **Node.js & Python SDKs**: Clean libraries to connect any autonomous agent in 3 lines of code.
5. **Interactive Web Portal & Live Cockpit**:
   - **Web Portal** (`http://localhost:4488`): Interactive socket copy/paste ping tester, endpoint presets, lossless XDialect playground, device requirements matrix, and multi-language integration guide.
   - **Telemetry Cockpit** (`http://localhost:4488/cockpit.html`): Real-time agent mesh visualizer, cooperative lock matrix, and Waterfall Spectrogram for Gibberlink audio modem signals.
   - **Attribution**: References and builds upon Anton Pidkuiko & Boris Starkov's [PennyroyalTea/gibberlink](https://github.com/PennyroyalTea/gibberlink).

---

## 📊 Wire Efficiency: Bits vs. Audio Signals vs. Natural Language

| Metric | Verbose Natural Language | Gibberlink Acoustic Sound (PCM) | Gibberlink Signal Stream | CrossTalk XDialect (Bits) |
| :--- | :--- | :--- | :--- | :--- |
| **Typical Size** | ~180 – 350 bytes (JSON) | ~240,000 bytes (48kHz audio) | ~2,500 bytes (JSON frequencies) | **~34 – 54 bytes** (Binary frame) |
| **Transmission Latency** | ~2 – 5 ms | ~2,000 – 4,000 ms (audio time) | ~1 – 3 ms | **< 0.5 ms** (Wire instant) |
| **Compression Ratio** | Baseline | 1,200x heavier | 12x heavier | **5x – 7,000x more efficient** |
| **Human Readability** | High | Low | None | **100% Reversible to English** |

---

## 📖 XDialect v1.0.0 Token Dictionary

Agents receive this dictionary upon connection (`ws://localhost:4488` or `GET http://localhost:4488/api/dialect`):

### Actions (`!`)
- `!LCK` : Claim exclusive file lock (`!LCK @src/auth.ts`)
- `!REL` : Release file lock (`!REL @src/auth.ts`)
- `!BCST`: Broadcast announcement to all agents
- `!DM`  : Direct private message to a specific agent (`!DM ^Agent-2`)
- `!WARN`: Collision / conflict alert
- `!PASS`: Handoff file or task to peer agent

### Intents (`#`)
- `#REF` : Refactoring existing code
- `#FEAT`: Implementing new feature
- `#FIX` : Bug fix
- `#TEST`: Authoring or running test suite
- `#BLD` : Compiling or building
- `#MIG` : Database or schema migration

### Flow Control (`&`)
- `&WAIT` : Hang on for me to finish before touching it.
- `&ACK`  : Understood, holding off.
- `&DONE` : Finished work.
- `&PROCEED` : Clear to proceed now.

### Grammar Format
```
<ACTION> [@<FILE>] [#<INTENT>] ["<REASON>"] [~<TTL_SEC>] [^<RECIPIENT>] [&<FLOW>]
```

### Examples
- **Shorthand**: `!LCK @src/auth.ts #REF "jwt validation" ~180 &WAIT`  
  **English**: *"I am editing src/auth.ts, refactoring (jwt validation). Holding lock for 180s. Hang on for me to finish before touching it."*  
  **Wire Size**: 34 bytes.

- **Shorthand**: `!REL @src/auth.ts &DONE &PROCEED`  
  **English**: *"Finished editing src/auth.ts. Lock released. You are clear to proceed now."*  
  **Wire Size**: 26 bytes.

---

---

## ⚡ Single-Line Join & Auto-Socket Bootstrap

Agents can connect to an existing mesh or **auto-spawn their own local socket in a single line**:

### In Terminal / CLI
```bash
# Joins channel 'auth-feature'. If no hub is active locally, auto-spawns one on the spot!
crosstalk up auth-feature --name "DevBot"
```

### In TypeScript / JavaScript
```typescript
import { CrossTalk } from 'cross-talk';

// Single-line connect: auto-discovers or auto-spawns the hub if none is running!
const agent = await CrossTalk.join({ channel: 'auth-feature', name: 'Worker-1' });

// Claim file with XDialect
agent.sendShorthand('!LCK @src/auth.ts #FEAT "jwt logic" &WAIT');
```

---

## 🔌 Universal Transports: Local Sockets, LAN, Bluetooth & Serial

CrossTalk separates the protocol from the physical wire via `ICrossTalkTransport`:
- **WebSocket (LAN / Local Network)**: Run `crosstalk serve --host 0.0.0.0` so any device, phone, or laptop on your Wi-Fi network can connect.
- **Unix Domain Sockets (IPC)**: Run over `/tmp/crosstalk.sock` for ultra-fast local inter-process communication with zero network overhead.
- **Bluetooth Serial / UART**: Stream length-prefixed binary frames over Bluetooth SPP or Hardware Serial (`StreamTransport`).

---

## 📟 Microcontroller Support (< 150 Bytes RAM)

CrossTalk can run on microcontrollers with virtually no memory (Arduino, ESP32, Raspberry Pi Pico, STM32):

### 1. Embedded C / C++ Header (`embedded/crosstalk_micro.h`)
- **Zero dynamic memory allocation** (`malloc` is never called).
- Fixed-size 44-byte frame buffer. Fits on an **Arduino Uno (2KB RAM)** or bare-metal Cortex-M.
- Arduino example in [`embedded/arduino_esp32_crosstalk.ino`](file:///Users/Josh/Documents/cross-talk/embedded/arduino_esp32_crosstalk.ino):
```cpp
#include "crosstalk_micro.h"

// Send a 34-byte lock claim over Bluetooth Serial or UART:
CrossTalkMicro::claimLock(SerialBT, "src/calibration.h", XT_INTENT_FEAT, "Calibrating IMU", 60);
```

### 2. MicroPython / CircuitPython (`embedded/crosstalk_micro.py`)
- Zero dependencies, uses `struct.pack`.
- Runs on Raspberry Pi Pico W and ESP32 with `< 10KB` RAM:
```python
from crosstalk_micro import CrossTalkMicro

# Generate 34-byte packet for Bluetooth/UART
pkt = CrossTalkMicro.pack_claim("src/firmware.c", "Sensor calibration", 60)
uart.write(pkt)
```

---

## 🛠️ Quickstart

### 1. Start or Join in a Single Command
```bash
# If hub isn't running, auto-spawns on the spot and joins channel:
./bin/crosstalk.js up my-project
```

Or start the standalone server:
```bash
./bin/crosstalk.js serve --host 0.0.0.0 --port 4488
```
Open **`http://localhost:4488`** to view the live dashboard and Waterfall Spectrogram.

### 2. CLI Coordination Commands
```bash
# View active agents and locked files
./bin/crosstalk.js who

# View the versioned token dictionary
./bin/crosstalk.js dict

# Send shorthand to the mesh
./bin/crosstalk.js short '!LCK @src/server.ts #FEAT "websocket mesh" &WAIT'

# Translate shorthand to English
./bin/crosstalk.js to-human '!LCK @src/api.ts #FIX "null pointer" &WAIT'

# Translate English to shorthand
./bin/crosstalk.js to-short "I am editing src/api.ts, fixing bug, hang on for me to finish"
```

### 3. Run the Multi-Agent Simulation
```bash
npx tsx examples/simulate_two_agents.ts
```

### 4. Run the Microcontroller Bluetooth/Serial Stream Demo
```bash
npx tsx examples/micro_stream_demo.ts
```

---

## 🤖 Connecting AI Agents

### Option A: IDE Conversation Agents (Antigravity, Claude Code, Cursor)
CrossTalk includes an **MCP (Model Context Protocol)** server:
1. [`.agents/mcp_config.json`](file:///Users/Josh/Documents/cross-talk/.agents/mcp_config.json) is pre-configured in this repository.
2. Tools exposed to the LLM:
   - `crosstalk_check_mesh`: Check peer agents and locked files.
   - `crosstalk_get_dialect_dictionary`: Fetch the active XDialect dictionary.
   - `crosstalk_send_shorthand`: Emit concise shorthand messages (`!LCK`, `!REL`, `&WAIT`).
   - `crosstalk_lock_file`: Cooperative file lock.
   - `crosstalk_unlock_file`: Cooperative file unlock.
   - `crosstalk_send_message`: Direct message another agent.
   - `crosstalk_read_inbox`: Check unread notifications and conflict alerts.

### Option B: Automatic File Guard via Antigravity Lifecycle Hooks
In [`.agents/hooks.json`](file:///Users/Josh/Documents/cross-talk/.agents/hooks.json):
- `PreToolUse` intercepts `replace_file_content` and `write_to_file`. If another agent holds a lock, it pauses execution and alerts the agent!
- `PreInvocation` injects active peer status directly into the prompt context.

### Option C: Python SDK
```python
from sdk.python.crosstalk import CrossTalkClient

client = CrossTalkClient(name="Python-Worker", role="data-pipeline")
client.connect()

# Claim file using XDialect
client.send_shorthand('!LCK @pipeline/etl.py #FEAT "batch chunking" ~120 &WAIT')
```

