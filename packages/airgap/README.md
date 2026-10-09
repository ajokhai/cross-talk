# @cross-talk/airgap

Builds `dist/crosstalk-airgap.sh`, a single self-extracting shell script that installs or runs CrossTalk on a machine with no internet. It embeds the standalone CLI bundle, the Python SDK and the embedded C header as base64.

```sh
npm run bundle                          # at the repo root: builds dist/crosstalk.standalone.mjs
node packages/airgap/scripts/build-airgap.js

sh crosstalk-airgap.sh install          # to /usr/local/bin or ~/.local/bin
sh crosstalk-airgap.sh who              # run a command without installing
sh crosstalk-airgap.sh extract          # unpack the JS, Python and C files
```

Inputs, relative to the repo root: `dist/crosstalk.standalone.mjs` (required), `sdk/python/crosstalk.py`, `packages/embedded/firmware/crosstalk_micro.h`.
