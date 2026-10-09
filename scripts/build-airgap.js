import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const jsBundlePath = path.join(rootDir, 'dist', 'crosstalk.standalone.mjs');
const pyBundlePath = path.join(rootDir, 'sdk', 'python', 'crosstalk.py');
const cHeaderPath = path.join(rootDir, 'embedded', 'crosstalk_micro.h');

if (!fs.existsSync(jsBundlePath)) {
  console.error(`Error: ${jsBundlePath} not found. Run npm run bundle first.`);
  process.exit(1);
}

const jsBase64 = fs.readFileSync(jsBundlePath).toString('base64');
const pyBase64 = fs.existsSync(pyBundlePath) ? fs.readFileSync(pyBundlePath).toString('base64') : '';
const cBase64 = fs.existsSync(cHeaderPath) ? fs.readFileSync(cHeaderPath).toString('base64') : '';

const shellScript = `#!/usr/bin/env sh
# ==============================================================================
# CrossTalk Single-File Air-Gapped Installer & Standalone Runner
# Real-time WebSocket Mesh & XDialect Multi-Agent Protocol
#
# This file is 100% SELF-CONTAINED.
# You can copy this single file onto ANY computer or device with NO INTERNET
# and run or install CrossTalk immediately.
#
# Usage:
#   sh crosstalk-airgap.sh install       # Install to /usr/local/bin or ~/.local/bin
#   sh crosstalk-airgap.sh who           # Run command directly without installing
#   sh crosstalk-airgap.sh up            # Join/spawn local socket mesh directly
#   sh crosstalk-airgap.sh serve         # Start full WebSocket hub and cockpit
#   sh crosstalk-airgap.sh extract       # Unpack all files (JS, Python, C header)
# ==============================================================================
set -e

# Detect available runtimes
HAS_NODE=0
HAS_PYTHON=0

if command -v node >/dev/null 2>&1; then
  HAS_NODE=1
fi
if command -v python3 >/dev/null 2>&1; then
  HAS_PYTHON=1
fi

TMP_DIR="\${TMPDIR:-/tmp}/crosstalk-airgap-\$\$"

cleanup() {
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT INT TERM

decode_payload() {
  target="$1"
  data="$2"
  if command -v base64 >/dev/null 2>&1; then
    printf '%s' "$data" | base64 -d 2>/dev/null || printf '%s' "$data" | base64 -D 2>/dev/null
  elif command -v openssl >/dev/null 2>&1; then
    printf '%s' "$data" | openssl base64 -d
  elif [ "$HAS_PYTHON" = "1" ]; then
    python3 -c "import base64, sys; sys.stdout.buffer.write(base64.b64decode('$data'))"
  else
    echo "Error: Need base64, openssl, or python3 to decode payload." >&2
    exit 1
  fi > "$target"
}

# Embedded Base64 Payloads
JS_PAYLOAD="${jsBase64}"
PY_PAYLOAD="${pyBase64}"
C_PAYLOAD="${cBase64}"

CMD="\${1:-install}"

if [ "$CMD" = "extract" ]; then
  echo "📦 Extracting all CrossTalk offline components to current directory..."
  decode_payload "crosstalk.standalone.mjs" "$JS_PAYLOAD"
  chmod +x crosstalk.standalone.mjs
  decode_payload "crosstalk.py" "$PY_PAYLOAD"
  chmod +x crosstalk.py
  if [ -n "$C_PAYLOAD" ]; then
    decode_payload "crosstalk_micro.h" "$C_PAYLOAD"
  fi
  echo "✔ Extracted: crosstalk.standalone.mjs, crosstalk.py, crosstalk_micro.h"
  exit 0
fi

if [ "$CMD" = "install" ]; then
  echo "⚡ Installing CrossTalk offline from single file..."

  # Determine destination directory
  DEST_DIR="\${CROSSTALK_INSTALL_DIR:-}"
  if [ -z "$DEST_DIR" ]; then
    if [ "$(id -u 2>/dev/null || echo 1)" = "0" ]; then
      DEST_DIR="/usr/local/bin"
    elif [ -w "/usr/local/bin" ]; then
      DEST_DIR="/usr/local/bin"
    else
      DEST_DIR="$HOME/.local/bin"
    fi
  fi

  mkdir -p "$DEST_DIR"
  DEST_FILE="$DEST_DIR/crosstalk"

  if [ "$HAS_NODE" = "1" ]; then
    echo "  → Detected Node.js (\$(node -v)). Installing full WebSocket hub & CLI bundle..."
    decode_payload "$DEST_FILE" "$JS_PAYLOAD"
    chmod +x "$DEST_FILE"
  elif [ "$HAS_PYTHON" = "1" ]; then
    echo "  → Detected Python 3 (\$(python3 --version | cut -d' ' -f2)). Installing Python stdlib CLI..."
    decode_payload "$DEST_FILE" "$PY_PAYLOAD"
    chmod +x "$DEST_FILE"
  else
    echo "  ⚠️ Neither node nor python3 detected in PATH."
    echo "  Extracting standalone JS and Python scripts to $DEST_DIR..."
    decode_payload "$DEST_FILE" "$JS_PAYLOAD"
    chmod +x "$DEST_FILE"
  fi

  echo ""
  echo "✔ CrossTalk successfully installed to: $DEST_FILE"
  echo "✔ Offline installation completed without internet connection."

  case ":$PATH:" in
    *":$DEST_DIR:"*)
      echo "✔ Directory is in PATH. Try running:"
      echo "    crosstalk who"
      echo "    crosstalk up"
      echo "    crosstalk dict"
      ;;
    *)
      echo "⚠️  $DEST_DIR is not in your current PATH."
      echo "Add it with:"
      echo "    echo 'export PATH=\"$DEST_DIR:\$PATH\"' >> ~/.bashrc (or ~/.zshrc)"
      echo "    source ~/.bashrc"
      ;;
  esac
  echo ""
  exit 0
fi

# Direct Execution Mode: Run command on the fly without installing
mkdir -p "$TMP_DIR"
if [ "$HAS_NODE" = "1" ]; then
  decode_payload "$TMP_DIR/crosstalk.mjs" "$JS_PAYLOAD"
  chmod +x "$TMP_DIR/crosstalk.mjs"
  node "$TMP_DIR/crosstalk.mjs" "$@"
elif [ "$HAS_PYTHON" = "1" ]; then
  decode_payload "$TMP_DIR/crosstalk.py" "$PY_PAYLOAD"
  chmod +x "$TMP_DIR/crosstalk.py"
  python3 "$TMP_DIR/crosstalk.py" "$@"
else
  echo "Error: Need either 'node' or 'python3' to execute CrossTalk commands directly." >&2
  echo "Run 'sh $0 install' or 'sh $0 extract' to inspect bundled files." >&2
  exit 1
fi
`;

const outPath = path.join(rootDir, 'dist', 'crosstalk-airgap.sh');
fs.writeFileSync(outPath, shellScript, { mode: 0o755 });

// Also write copy to src/server/web and dist/server/web for direct browser download
const webOutSrc = path.join(rootDir, 'src', 'server', 'web', 'crosstalk-airgap.sh');
const webOutDist = path.join(rootDir, 'dist', 'server', 'web', 'crosstalk-airgap.sh');
fs.copyFileSync(outPath, webOutSrc);
fs.mkdirSync(path.dirname(webOutDist), { recursive: true });
fs.copyFileSync(outPath, webOutDist);

console.log(`✔ Generated self-extracting single-file airgap script: ${outPath} (${(shellScript.length / 1024).toFixed(1)} KB)`);
console.log(`✔ Web download asset ready: ${webOutSrc}`);
