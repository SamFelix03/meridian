#!/usr/bin/env bash
set -euo pipefail

export PORT="${PORT:-8080}"

mkdir -p /data/indexer /data/kyb /data/provisioner
mkdir -p /app/data
rm -rf /app/data/indexer
ln -sfn /data/indexer /app/data/indexer

envsubst '${PORT}' < /app/docker/nginx.conf.template > /etc/nginx/conf.d/default.conf

echo "Meridian stack starting (PORT=${PORT}, agent=$([[ -n "${GROQ_API_KEY:-}" ]] && echo on || echo off))"
exec supervisord -c /app/docker/supervisord.conf
