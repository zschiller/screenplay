#!/usr/bin/env bash
# PROTOTYPE (issue #992), throwaway. Runs the Seatbelt dev-server spike on a Mac.
#   bash apps/app/lib/sandbox/local/seatbelt-prototype/run.sh [--probes-only] [--skip-next]
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
[ "$(uname)" = "Darwin" ] || { echo "Run this on the Mac."; exit 1; }
node -e 'process.exit(+process.versions.node.split(".")[0] >= 22 ? 0 : 1)' \
  || { echo "Needs Node 22 or newer (for the built-in WebSocket)."; exit 1; }
node "$here/spike.mjs" "$@"
echo
echo "To post the report on the ticket:"
echo "  gh issue comment 992 --repo zschiller/screenplay --body-file ~/.screenplay/seatbelt-992/report.md"
