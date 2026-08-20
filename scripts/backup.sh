#!/usr/bin/env sh
set -eu

PORT=${NARRALUME_PORT:-4317}
LABEL=${1:-launcher}
ESCAPED_LABEL=$(printf '%s' "$LABEL" | sed 's/\\/\\\\/g; s/"/\\"/g')
RESPONSE=$(curl --fail --silent --show-error \
  --request POST \
  --header 'Content-Type: application/json' \
  --data "{\"label\":\"$ESCAPED_LABEL\"}" \
  "http://127.0.0.1:$PORT/api/system/backups") || {
    echo "Could not create a consistent backup. Start NarraLume first." >&2
    exit 1
  }
echo "Backup completed: $RESPONSE"
