# @cross-talk/airgap

Builds `dist/crosstalk-airgap.sh`, a single self-extracting shell script that installs or runs CrossTalk on a machine with no internet. It embeds the standalone CLI bundle, the Python SDK and the embedded C header as base64.

```sh
npm run bundle                          # at the repo root: builds dist/crosstalk.standalone.mjs
node packages/airgap/scripts/build-airgap.js

sh crosstalk-airgap.sh install          # install `crosstalk` to /usr/local/bin or ~/.local/bin
sh crosstalk-airgap.sh extract          # unpack the JS, Python and C files
sh crosstalk-airgap.sh serve            # or run any command without installing
```

What you get depends on the target machine:

- **Node.js 18+**: the full CLI (`serve`, `new`, `up`, `send`, `wait`, `tail`, `channel`, `dialect`, `mcp`), including the hub.
- **Python 3 only**: the Python client CLI (`create`, `send`, `history`, …). It cannot run a hub, so point it at one running elsewhere with `--url`.

Not included: the hardware bridge (`crosstalk-bridge`). For an offline hardware setup, also copy over `@cross-talk/embedded`.

Inputs, relative to the repo root: `dist/crosstalk.standalone.mjs` (required), `sdk/python/crosstalk.py`, `packages/embedded/firmware/crosstalk_micro.h`.
