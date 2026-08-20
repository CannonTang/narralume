#!/usr/bin/env sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
RUNTIME="$ROOT/.runtime"
LOGS="$RUNTIME/logs"
PID_FILE="$RUNTIME/server.pid"
LOCK_FILE="$ROOT/package-lock.json"
INSTALL_MARKER="$RUNTIME/package-lock.sha256"
PORT=${NARRALUME_PORT:-4317}
URL="http://127.0.0.1:$PORT"
DATA_DIRECTORY=${NARRALUME_DATA_DIR:-${NARRATIVE_DATA_DIR:-"$ROOT/data"}}
BACKUP_DIRECTORY=${NARRATIVE_BACKUP_DIR:-"$DATA_DIRECTORY/backups"}
PORTABLE_NODE_VERSION=${NARRALUME_NODE_VERSION:-24.19.0}

mkdir -p "$LOGS" "$DATA_DIRECTORY" "$BACKUP_DIRECTORY"
command -v curl >/dev/null 2>&1 || { echo "curl is required by the NarraLume launcher." >&2; exit 1; }

node_is_supported() {
  "$1" -e 'const major=Number(process.versions.node.split(".")[0]);process.exit(major >= 24 ? 0 : 1)' >/dev/null 2>&1
}

install_portable_node() {
  case "$(uname -s)" in
    Darwin) node_os=darwin ;;
    Linux) node_os=linux ;;
    *) echo "NarraLume supports macOS and Linux on this launcher." >&2; exit 1 ;;
  esac
  case "$(uname -m)" in
    x86_64|amd64) node_arch=x64 ;;
    arm64|aarch64) node_arch=arm64 ;;
    *) echo "Unsupported CPU architecture: $(uname -m)" >&2; exit 1 ;;
  esac

  folder="node-v$PORTABLE_NODE_VERSION-$node_os-$node_arch"
  node_home="$RUNTIME/$folder"
  node_bin="$node_home/bin/node"
  if [ -x "$node_bin" ] && node_is_supported "$node_bin"; then
    printf '%s\n' "$node_home"
    return
  fi

  command -v tar >/dev/null 2>&1 || { echo "tar is required to unpack Node.js." >&2; exit 1; }
  archive="$folder.tar.gz"
  archive_path="$RUNTIME/$archive"
  base_url="https://nodejs.org/dist/v$PORTABLE_NODE_VERSION"
  echo "Downloading the official Node.js $PORTABLE_NODE_VERSION runtime..." >&2
  curl --fail --location --silent --show-error "$base_url/$archive" --output "$archive_path"
  expected=$(curl --fail --location --silent --show-error "$base_url/SHASUMS256.txt" | awk -v file="$archive" '$2 == file { print $1; exit }')
  [ -n "$expected" ] || { echo "The official checksum list does not contain $archive." >&2; exit 1; }
  if command -v sha256sum >/dev/null 2>&1; then
    actual=$(sha256sum "$archive_path" | awk '{print $1}')
  elif command -v shasum >/dev/null 2>&1; then
    actual=$(shasum -a 256 "$archive_path" | awk '{print $1}')
  else
    echo "sha256sum or shasum is required to verify Node.js." >&2
    exit 1
  fi
  [ "$actual" = "$expected" ] || { echo "The Node.js runtime checksum is invalid." >&2; exit 1; }
  tar -xzf "$archive_path" -C "$RUNTIME"
  rm -f "$archive_path"
  node_is_supported "$node_bin" || { echo "The Node.js runtime installation failed." >&2; exit 1; }
  printf '%s\n' "$node_home"
}

if [ "${NARRALUME_FORCE_PORTABLE_NODE:-0}" != "1" ] && command -v node >/dev/null 2>&1 && node_is_supported "$(command -v node)"; then
  NODE_BIN=$(command -v node)
  NODE_HOME=$(dirname -- "$NODE_BIN")
else
  NODE_HOME=$(install_portable_node)
  NODE_BIN="$NODE_HOME/bin/node"
fi
PATH="$NODE_HOME/bin:$PATH"
export PATH
NPM_BIN=$(command -v npm || true)
[ -n "$NPM_BIN" ] || { echo "npm was not found next to Node.js or on PATH." >&2; exit 1; }
NPM_MAJOR=$($NPM_BIN --version | awk -F. '{print $1}')
case "$NPM_MAJOR" in
  ''|*[!0-9]*) echo "Unable to determine npm version." >&2; exit 1 ;;
esac
[ "$NPM_MAJOR" -ge 11 ] || { echo "NarraLume requires npm 11 or newer." >&2; exit 1; }

LOCK_HASH=$($NODE_BIN -e 'const fs=require("fs"),c=require("crypto");process.stdout.write(c.createHash("sha256").update(fs.readFileSync(process.argv[1])).digest("hex"))' "$LOCK_FILE")
INSTALLED_HASH=$([ -f "$INSTALL_MARKER" ] && cat "$INSTALL_MARKER" || true)
if [ ! -d "$ROOT/node_modules" ] || [ "$INSTALLED_HASH" != "$LOCK_HASH" ]; then
  echo "Installing dependencies from package-lock.json..."
  (cd "$ROOT" && "$NPM_BIN" ci)
  printf '%s\n' "$LOCK_HASH" > "$INSTALL_MARKER"
fi

SERVER_ENTRY="$ROOT/apps/server/dist/main.js"
WEB_INDEX="$ROOT/apps/web/dist/index.html"
if [ "${NARRALUME_FORCE_BUILD:-0}" = "1" ] || [ ! -f "$SERVER_ENTRY" ] || [ ! -f "$WEB_INDEX" ]; then
  echo "Building NarraLume..."
  (cd "$ROOT" && VITE_TRIAL_MODE=0 "$NPM_BIN" run build)
fi

if curl --fail --silent "$URL/api/health" >/dev/null 2>&1; then
  echo "NarraLume is already running at $URL"
else
  NODE_ENV=production \
    NARRATIVE_SERVER_HOST=127.0.0.1 \
    NARRATIVE_SERVER_PORT="$PORT" \
    NARRATIVE_STATIC_DIR="$ROOT/apps/web/dist" \
    NARRATIVE_DATA_DIR="$DATA_DIRECTORY" \
    NARRATIVE_BACKUP_DIR="$BACKUP_DIRECTORY" \
    nohup "$NODE_BIN" "$SERVER_ENTRY" >"$LOGS/server.log" 2>"$LOGS/server-error.log" &
  SERVER_PID=$!
  printf '%s\n' "$SERVER_PID" > "$PID_FILE"
  attempt=0
  until curl --fail --silent "$URL/api/health" >/dev/null 2>&1; do
    if ! kill -0 "$SERVER_PID" 2>/dev/null; then break; fi
    attempt=$((attempt + 1))
    [ "$attempt" -lt 60 ] || break
    sleep 0.5
  done
  if ! curl --fail --silent "$URL/api/health" >/dev/null 2>&1; then
    echo "NarraLume failed to start. See $LOGS/server-error.log." >&2
    exit 1
  fi
fi

echo "NarraLume is running at $URL"
echo "Data: $DATA_DIRECTORY"
echo "Logs: $LOGS"
if [ "${NARRALUME_NO_BROWSER:-0}" != "1" ]; then
  if command -v open >/dev/null 2>&1; then
    open "$URL"
  elif command -v xdg-open >/dev/null 2>&1; then
    xdg-open "$URL" >/dev/null 2>&1 || true
  fi
fi
