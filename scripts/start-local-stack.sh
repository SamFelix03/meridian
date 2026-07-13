#!/usr/bin/env bash
# Start the full Meridian local dev stack (run from repo root in a dedicated terminal/tmux tab).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

echo "Starting Meridian stack (Ctrl+C to stop all)..."
echo "  Portal UI:  http://localhost:5173"
echo "  Portal API: http://localhost:4000/health"
echo ""

pnpm portal:api &
pnpm --filter @meridian/portal dev &
pnpm indexer:supplier &
pnpm indexer:buyer &
pnpm indexer:financier-a &
pnpm indexer:financier-b &
pnpm indexer:regulator &
pnpm indexer:platform &
pnpm notifications &
pnpm registry-api &
pnpm oracle-relay &

wait
