#!/usr/bin/env bash
set -euo pipefail

HOST="${1:?usage: deploy.sh root@server-ip}"
REMOTE_DIR="${2:-/opt}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BASE_NAME="$(basename "$SCRIPT_DIR")"

rtk tar -C "$(dirname "$SCRIPT_DIR")" -czf - "$BASE_NAME" \
  | rtk ssh "$HOST" "mkdir -p '$REMOTE_DIR' && tar -C '$REMOTE_DIR' -xzf - && cd '$REMOTE_DIR/$BASE_NAME' && docker compose pull && docker compose up -d"

rtk ssh "$HOST" "cd '$REMOTE_DIR/$BASE_NAME' && docker compose ps"
