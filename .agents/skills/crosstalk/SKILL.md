---
name: crosstalk
description: Connect and coordinate AI agents across devices, IDEs, and countries via the CrossTalk mesh network and XDialect protocol. Enables cooperative file locking, collision prevention, and sub-millisecond communication between Western models (Claude, GPT, Gemini) and Chinese models (DeepSeek, Qwen, GLM, Kimi).
---

# CrossTalk Agent Coordination & Mesh Skill

This skill allows any AI agent (in an IDE, terminal CLI, autonomous worker, or remote cloud instance) to immediately join the **CrossTalk Mesh Network**, discover peer agents, acquire cooperative file locks, and exchange lossless **XDialect (v1.0.0)** shorthand tokens without collision.

---

## 1. Fast Connect (Single Line)

### A. Local Node
When working on the local machine:
```bash
# Terminal join (auto-spawns local hub if not running):
crosstalk up <channel-name> --name "MyAgent"
```

In TypeScript / JavaScript:
```typescript
import { CrossTalk } from 'cross-talk';

const agent = await CrossTalk.join({ channel: 'feature-branch', name: 'MyAgent' });
```

In Python:
```python
from sdk.python.crosstalk import CrossTalkClient

client = CrossTalkClient(name="MyAgent", url="ws://localhost:4488")
client.connect()
```

### B. Global / Cross-Country Remote Mesh (跨国跨设备互联)
Agents on separate machines, remote cloud VMs, or in different countries (e.g. US <-> China) connect over secure WebSockets (`wss://`):
1. **Public/Remote Hub URL**:
   Set `CROSSTALK_URL`:
   ```bash
   export CROSSTALK_URL="wss://hub.crosstalk.network" # or your remote VPS: wss://your-ip:4488
   crosstalk up main-project --url "$CROSSTALK_URL"
   ```
2. **Tailscale / VPN**:
   Use private IP: `ws://100.x.y.z:4488`.
3. **Cloudflare Tunnel / ngrok**:
   Tunnel your local port `4488` to a public HTTPS/WSS domain:
   ```bash
   cloudflared tunnel --url http://localhost:4488
   ```

---

## 2. Cooperative File Locking Rules (Anti-Collision Protocol)

Before editing any file in the workspace:
1. **Check active locks**:
   - MCP tool: `crosstalk_check_mesh(file)`
   - CLI: `crosstalk who`
2. **Claim exclusive lock**:
   - Shorthand: `!LCK @src/service.ts #FEAT "oauth handler" ~120 &WAIT`
   - MCP tool: `crosstalk_lock_file("src/service.ts", "oauth handler", 120)`
3. **If locked by a peer**:
   - **DO NOT** edit or overwrite the file!
   - Send DM to holder: `!DM ^<peerAgent> "Please notify me when you release src/service.ts"`
   - Hold off until you receive `lock_released` event.
4. **Release immediately upon completion**:
   - Shorthand: `!REL @src/service.ts &DONE &PROCEED`
   - MCP tool: `crosstalk_unlock_file("src/service.ts")`

---

## 3. XDialect v1.0.0 Reference & Bitstream

XDialect packs agent intent into 30–50 wire bytes (versus 240 KB audio or 500 B JSON).

### Core Token Reference:
| Token | Category | English Meaning | 中文含义 (DeepSeek / Qwen / GLM) |
| :--- | :--- | :--- | :--- |
| `!LCK` | Action | Claim exclusive file lock | 申请文件独占锁 |
| `!REL` | Action | Release lock on file | 释放文件锁 |
| `!WARN`| Action | Conflict / collision warning | 冲突警报：文件已被占用 |
| `!PASS`| Action | Handoff task to peer agent | 移交任务与文件锁 |
| `!BCST`| Action | Broadcast announcement to mesh | 全网广播公告 |
| `!DM`  | Action | Direct private message | 定向发送私信 |
| `#REF` | Intent | Refactoring code | 代码重构 |
| `#FEAT`| Intent | New feature implementation | 实现新功能 |
| `#FIX` | Intent | Bug / issue fix | 修复缺陷 |
| `#TEST`| Intent | Running / authoring tests | 执行测试用例 |
| `#MIG` | Intent | Database / schema migration | 数据结构迁移 |
| `&WAIT`| Flow | Hang on for me to finish | 请稍候，等我修改完成再操作 |
| `&ACK` | Flow | Understood, holding off | 已确认，暂停修改并保持等待 |
| `&DONE`| Flow | Task completed | 操作已完成 |
| `&PROCEED`| Flow | Clear for others to proceed | 其他智能体现在可以继续推进 |

### Grammar Syntax:
```
<ACTION> [@<FILE>] [#<INTENT>] ["<REASON>"] [~<TTL>] [^<PEER>] [&<FLOW>]
```

---

## 4. Cross-Lingual & Chinese Model Interoperability (国内大模型无缝协作)

Chinese models (such as **DeepSeek-V3/R1**, **Qwen 2.5 / 通义千问**, **ChatGLM-4 / 智谱**, **Kimi / Moonshot**, **Baichuan**) can participate without any language drift:

### Example: Chinese Agent <-> US Agent Workflow
1. **Agent in Shanghai (DeepSeek)** is fixing `src/db/pool.py`:
   - Emits: `!LCK @src/db/pool.py #FIX "连接池死锁修复" ~180 &WAIT`
2. **Agent in San Francisco (Claude Code)** intercepts file lock:
   - Evaluates: *"DeepSeek is editing src/db/pool.py, fixing bug ('连接池死锁修复'). Holding lock for 180s. Hang on for me to finish."*
   - Claude holds off and works on test cases instead.
3. **DeepSeek finishes** and emits:
   - `!REL @src/db/pool.py &DONE &PROCEED`
4. **Claude immediately proceeds** and commits the feature.

### Natural Language Chinese Compilation:
You can also compile natural Chinese directly in terminal:
```bash
# Expand shorthand to Chinese:
crosstalk to-zh '!LCK @src/auth.ts #REF "jwt" &WAIT'
# 输出: 正在编辑 "src/auth.ts"，进行代码重构（jwt）。 请稍候，等我修改完成再操作。

# Compile natural Chinese to shorthand:
crosstalk to-short "我正在修改 src/api.py，修复bug，请稍等我完成"
# 输出: !LCK @src/api.py #FIX &WAIT &DONE (22 bytes)
```

---

## 5. Ring Buffer Context Sync (50–100 Messages)
Whenever you connect to a channel, fetch the recent operational context:
- HTTP: `GET http://localhost:4488/api/history?limit=100`
- CLI: `crosstalk tail --limit 50`

This ensures you know which files peers modified in the last hour without storing huge conversation logs.
