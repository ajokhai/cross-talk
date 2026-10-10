# Versioning and releases

`main` is the single source of truth. Every release is a `vX.Y.Z` tag on `main`
plus a GitHub release with notes from [CHANGELOG.md](CHANGELOG.md).

## Three version numbers

They move independently, and each is visible to clients.

| What | Where | Seen by clients as |
| :-- | :-- | :-- |
| **Package** (`2.0.0`) | `package.json` (also `__version__` in `sdk/python/crosstalk.py`) | `crosstalk --version`, `GET /health` → `version`, `welcome.serverVersion` |
| **Wire protocol** (`2`) | `PROTOCOL_VERSION` in `src/protocol.ts` | `hello.protocol` / `welcome.protocol`; the hub rejects other values |
| **XDialect dictionary** (`1.0.0`) | `DIALECT_V1.version` in `src/dialect/dictionary.ts` | `GET /api/dialect` → `version` |

### Package: semver

- **Major**: anything that breaks existing users: a protocol bump, removed or
  renamed CLI commands, MCP tools, SDK methods or HTTP routes.
- **Minor**: new features that old clients can ignore: new request types or
  events, new tools, flags or dictionary tokens.
- **Patch**: bug and security fixes with no API change.

### Protocol

Bump `PROTOCOL_VERSION` only for changes old clients can't survive, such as a
changed frame shape or semantics. Adding an optional field, a new request type
or a new event doesn't need a bump, because clients ignore what they don't know.
A protocol bump always means a major package release.

### XDialect dictionary

The vocabulary is expected to grow. To keep every agent and every
microcontroller decoding the same bits:

- **Add tokens → minor dictionary bump** (`1.0.0` → `1.1.0`). Give each new
  token an unused `numericId` in its category's range.
- **Never reuse or renumber a `numericId`.** Firmware decodes packed bits by
  these ids, so a reused id silently changes meaning on deployed devices. A
  retired token keeps its id, marked deprecated.
- **Changing what an existing token means → major dictionary bump** (`2.0.0`),
  and ship it in a major package release.
- Update `updatedAt` and add an XDialect line to the changelog. If a new action
  token can start a packed device frame, also add its id to `PACKED_ACTION_IDS`
  in `packages/embedded/src/bridge.ts` and to the firmware.

## Cutting a release

1. Under `## [Unreleased]` in `CHANGELOG.md`, rename the heading to the new
   version and date, add a fresh empty `## [Unreleased]` above it, and update
   the compare links at the bottom.
2. Bump the version. This updates `package.json` and `package-lock.json`, then
   commits and tags:
   ```sh
   npm version minor -m "release: v%s"     # or major / patch
   ```
   Set `__version__` in `sdk/python/crosstalk.py` to the same number first;
   the release workflow refuses mismatches.
3. Push the commit and the tag:
   ```sh
   git push origin main --follow-tags
   ```
4. The **Release** workflow runs the full test suite. It then checks that the
   tag, `package.json` and the Python SDK agree, and publishes a GitHub release
   whose notes come from that version's changelog section.

Add-on packages under `packages/` keep their own `0.x` versions. Bump them in
their own `package.json` when they change; they ride along in the same release.
