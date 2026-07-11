#!/usr/bin/env bash
set -euo pipefail
if [[ -z "${GROQ_API_KEY:-}" ]]; then
  echo "agent-runtime: disabled (set GROQ_API_KEY to enable)"
  exec sleep infinity
fi
exec node services/agent-runtime/dist/cli.js
