#!/usr/bin/env bash
# Stop Meridian local stack processes started by start-local-stack.sh
LOG_DIR="${MERIDIAN_LOG_DIR:-/tmp/meridian-stack}"
if [[ ! -d "$LOG_DIR" ]]; then
  echo "No log dir at $LOG_DIR"
  exit 0
fi
for pidfile in "$LOG_DIR"/*.pid; do
  [[ -f "$pidfile" ]] || continue
  pid=$(cat "$pidfile")
  name=$(basename "$pidfile" .pid)
  if kill -0 "$pid" 2>/dev/null; then
    kill "$pid" 2>/dev/null && echo "stopped $name (pid $pid)"
  fi
  rm -f "$pidfile"
done
