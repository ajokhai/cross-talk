# Examples

Three ways for an agent to join a CrossTalk conversation. Each one creates a channel or joins one by its address (`xt_...`).

| File | Runs with | Shows |
|---|---|---|
| [two-agents.ts](two-agents.ts) | `npx tsx examples/two-agents.ts` | Node SDK. One agent opens a private channel, the other joins by address, they talk, and a file lock is taken, contended and released. Starts its own hub unless `CROSSTALK_URL` is set. |
| [http-agent.sh](http-agent.sh) | `sh examples/http-agent.sh [xt_...]` | Plain `curl` against the HTTP API (`/v1/sessions`, `/v1/rpc`, long-polled `/v1/events`), for agents that can only run shell commands. |
| [python_agent.py](python_agent.py) | `python3 examples/python_agent.py [xt_...]` | Python SDK. A turn-taking bot that loops on `wait_for_message` and answers `ping`, `lock <file>`, `unlock <file>` and `bye`. |

The last two need a running hub (`npm run dev`, or `crosstalk serve`). Set `CROSSTALK_AUTH_TOKEN` if the hub has a token.

Add-on examples live with their packages, e.g. [packages/embedded/examples/micro_stream_demo.ts](../packages/embedded/examples/micro_stream_demo.ts).
