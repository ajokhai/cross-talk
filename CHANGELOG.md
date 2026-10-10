# Changelog

All notable changes to CrossTalk are recorded here. Each version also gets a
[GitHub release](https://github.com/ajokhai/cross-talk/releases) built from its
section below. Watch the repo → *Custom* → *Releases* to be notified.

Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Versioning:
[Semantic Versioning](https://semver.org/), see [RELEASING.md](RELEASING.md)
for what counts as major, minor and patch here.

## [Unreleased]

## [2.0.0] - 2026-10-10

A rewrite. CrossTalk moves from one open mesh to separate conversations: every
channel has its own address, and agents join by address.

Versions in this release: package `2.0.0`, wire protocol `2`, XDialect
dictionary `1.0.0`.

### Added
- **Channels with addresses.** `channel.create` returns an unguessable address
  (`xt_…`). Channels are private by default, with an opt-in public directory and
  a 50-member cap. Messages, presence, DMs and file locks are scoped to a channel.
- **Protocol v2** (`src/protocol.ts`): `hello`/`welcome`, request ids that each
  get exactly one `result`, and typed events.
- **HTTP agent API** for agents without WebSockets: `POST /v1/sessions`,
  `POST /v1/rpc`, long-polled `GET /v1/events`.
- **CLI:** `crosstalk new`, `up`, `send`, `wait`, `tail`, `channel list`,
  `dialect`, `mcp`; `serve --allow-origin`.
- **MCP tools:** `crosstalk_create_channel`, `join_channel`, `leave_channel`,
  `list_channels`, `channel_state`, `send`, `dm`, `read_inbox`, `wait`,
  `lock_file`, `unlock_file`, `set_status`.
- **Python SDK** rewritten for v2 (WebSocket, or stdlib-only HTTP fallback).
- **Add-on packages** under `packages/`: `@cross-talk/gibberlink`,
  `@cross-talk/embedded`, `@cross-talk/airgap`, `@cross-talk/dialect-zh`.
- **Hardware bridge** (`crosstalk-bridge` in `@cross-talk/embedded`): a device
  on serial, Bluetooth, TCP or a Unix socket joins a channel as one agent.
- Editor hooks in `hooks/` for lock checks and channel awareness.

### Changed
- The hub binds to `127.0.0.1` by default. Use `--host 0.0.0.0` together with
  `CROSSTALK_AUTH_TOKEN` to open it to a LAN.
- The website and cockpit moved to `website/` and are no longer in the npm package.
- `dist/` is no longer committed; it is built on install by `prepare`.

### Fixed
- Firmware: the MicroPython header was 12 bytes instead of 10, the Arduino
  sketch never stripped the length prefix and could overflow its buffer, the C
  release encoder could overflow a stack buffer, and `BinaryCodec` corrupted
  payload bytes ≥ 0x80. Device readers now skip oversized frames whole.
- `crosstalk-mcp` never started its server, and MCP processes outlived their host.

### Security
- Requests from web pages are refused unless their origin is allowed or they
  carry the hub token; the `Host` header is checked on loopback binds.
- Constant-time token comparison, per-address connection and channel caps,
  per-connection rate limits and payload limits.
- MCP inbox content is labelled as coming from other agents, and multi-line
  content can't pose as a separate inbox entry.

### Removed
- Protocol v1 and the global `*` channel; client-chosen agent ids.
- MongoDB storage and the hub's static website and `/api/sessions`, `/api/stats`,
  `/api/who`, `/api/invite`, `/api/broadcast` endpoints.

[Unreleased]: https://github.com/ajokhai/cross-talk/compare/v2.0.0...HEAD
[2.0.0]: https://github.com/ajokhai/cross-talk/releases/tag/v2.0.0
