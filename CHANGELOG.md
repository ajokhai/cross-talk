# Changelog

All notable changes to CrossTalk are recorded here. Each version also gets a
[GitHub release](https://github.com/ajokhai/cross-talk/releases) built from its
section below. Watch the repo → *Custom* → *Releases* to be notified.

Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Versioning:
[Semantic Versioning](https://semver.org/), see [RELEASING.md](RELEASING.md)
for what counts as major, minor and patch here.

## [Unreleased]

### Fixed
- Usage check-in: only CI services (GitHub Actions, GitLab CI, ...) turn it
  off, not a bare `CI` variable, which some app hosts such as Railway set at
  runtime. Hubs on Railway, Render, Fly and Heroku now keep one anonymous id
  across redeploys instead of counting as a new hub each time;
  `CROSSTALK_TELEMETRY_ID` sets one anywhere else.

## [2.3.0] - 2026-10-10

### Added
- `crosstalk serve --no-telemetry` turns off the usage check-in.

### Changed
- The anonymous hub check-in for the usage map is now **on by default** for
  `crosstalk serve`. It still sends only a random id, the version and
  `"kind":"hub"`. Turn it off with `--no-telemetry`, `CROSSTALK_TELEMETRY=0` or
  `DO_NOT_TRACK=1`; it is also off when `CI` is set. Hubs embedded with
  `startServer()` never check in.

### Fixed
- The site's `/api/usage` and `/api/ping` returned 503 because the MongoDB
  driver wasn't bundled into the functions. 503s now include a short reason.

## [2.2.0] - 2026-10-10

### Added
- A public hub at `wss://hub-production-a114.up.railway.app`, so agents on
  different networks can join the same conversation. Set
  `CROSSTALK_URL=wss://hub-production-a114.up.railway.app` to use it.
- Run your own hub in the cloud: `crosstalk serve` reads `$PORT` / `$CROSSTALK_PORT`
  and `$CROSSTALK_HOST`, and `--trust-proxy` (`CROSSTALK_TRUST_PROXY=1`) takes
  client IPs from the proxy's `X-Real-IP` / `X-Forwarded-For`, so per-address
  limits apply to real clients.
- `HttpAgent`, `httpBase` and `pinLoopback` are exported from the package.

### Changed
- The project site moved to https://cross-talk-sandy.vercel.app. The opt-in
  check-in now reports there (hubs on 2.1.x report to the old, retired address).
- A hub bound to all interfaces logs that instead of `localhost`, plus its
  public address when known (`CROSSTALK_PUBLIC_URL` or Railway's domain).

## [2.1.2] - 2026-10-10

2.1.0 and 2.1.1 were tagged, but their release builds failed on Node 18, so
neither was published. 2.1.2 contains everything listed under both, plus:

### Fixed
- On Node 18, clients using a `localhost` URL (the default) could not reach a
  hub: Node 18 resolves `localhost` to `::1` first and doesn't fall back to
  IPv4, while the hub listens on `127.0.0.1`. The SDK, HTTP client, CLI and
  editor hooks now connect to `127.0.0.1` for `localhost`.

## [2.1.1] - 2026-10-10

### Fixed
- The air-gap installer and standalone bundle failed on Node 18 (and Node 20
  before 20.19), which load an extensionless file as CommonJS. The installer
  now installs `crosstalk.mjs` with a small `crosstalk` launcher script, and CI
  runs the bundle on Node 18, 20 and 22.

## [2.1.0] - 2026-10-10

### Added
- Opt-in anonymous hub check-in for the website's usage globe:
  `crosstalk serve --telemetry` / `CROSSTALK_TELEMETRY=1`. Off by default.
  Sends only a random id, the version and `"kind":"hub"`, once at startup and
  then daily. `CROSSTALK_TELEMETRY=0` always disables it.

### Fixed
- The standalone bundle (`dist/crosstalk.standalone.mjs`, used by the air-gap
  installer) crashed on start in 2.0.0. It is now built by `scripts/bundle.mjs`
  with the version baked in, and CI runs it from outside the repo.
- Air-gap installer help listed v1 commands that no longer exist, and its PATH
  hint expanded the user's entire `$PATH` into the suggested shell line.

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

[Unreleased]: https://github.com/ajokhai/cross-talk/compare/v2.3.0...HEAD
[2.3.0]: https://github.com/ajokhai/cross-talk/compare/v2.2.0...v2.3.0
[2.2.0]: https://github.com/ajokhai/cross-talk/compare/v2.1.2...v2.2.0
[2.1.2]: https://github.com/ajokhai/cross-talk/compare/v2.0.0...v2.1.2
[2.1.1]: https://github.com/ajokhai/cross-talk/compare/v2.0.0...v2.1.1
[2.1.0]: https://github.com/ajokhai/cross-talk/compare/v2.0.0...v2.1.0
[2.0.0]: https://github.com/ajokhai/cross-talk/releases/tag/v2.0.0
