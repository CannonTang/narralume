#!/usr/bin/env sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
if [ -d "$ROOT/.git" ]; then
  command -v git >/dev/null 2>&1 || { echo "Updating a source checkout requires Git." >&2; exit 1; }
  [ -z "$(git -C "$ROOT" status --porcelain)" ] || { echo "The checkout has local changes; update stopped." >&2; exit 1; }
  git -C "$ROOT" pull --ff-only
  NARRALUME_FORCE_BUILD=1 exec "$ROOT/scripts/start.sh"
else
  echo "This is a prebuilt release. Download the latest Release and preserve the data directory."
  exec "$ROOT/scripts/start.sh"
fi
