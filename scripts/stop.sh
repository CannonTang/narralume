#!/usr/bin/env sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
PID_FILE="$ROOT/.runtime/server.pid"
SERVER_ENTRY="$ROOT/apps/server/dist/main.js"

if [ ! -f "$PID_FILE" ]; then
  echo "No launcher-managed NarraLume process is recorded."
  exit 0
fi
SERVER_PID=$(cat "$PID_FILE")
case "$SERVER_PID" in
  ''|*[!0-9]*) echo "The recorded NarraLume PID is invalid." >&2; rm -f "$PID_FILE"; exit 1 ;;
esac
if ! kill -0 "$SERVER_PID" 2>/dev/null; then
  echo "The recorded NarraLume process is no longer running."
  rm -f "$PID_FILE"
  exit 0
fi
COMMAND=$(ps -p "$SERVER_PID" -o command= 2>/dev/null || true)
case "$COMMAND" in
  *"$SERVER_ENTRY"*) ;;
  *) echo "PID $SERVER_PID does not belong to NarraLume and was not stopped." >&2; rm -f "$PID_FILE"; exit 1 ;;
esac
kill "$SERVER_PID"
attempt=0
while kill -0 "$SERVER_PID" 2>/dev/null && [ "$attempt" -lt 40 ]; do
  attempt=$((attempt + 1))
  sleep 0.25
done
if kill -0 "$SERVER_PID" 2>/dev/null; then
  echo "Graceful stop timed out; forcing NarraLume to stop." >&2
  kill -KILL "$SERVER_PID"
fi
rm -f "$PID_FILE"
echo "NarraLume has stopped."
