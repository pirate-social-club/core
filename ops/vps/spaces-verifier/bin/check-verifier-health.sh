#!/usr/bin/env bash
set -euo pipefail

readonly HEALTH_URL="${SPACES_VERIFIER_HEALTH_URL:-http://127.0.0.1:4047/health}"
body="$(curl --fail --silent --show-error --max-time 15 "$HEALTH_URL")"

if ! grep -Eq '"fabric_record_reader_ready"[[:space:]]*:[[:space:]]*true' <<< "$body"; then
  echo "Spaces verifier Fabric record reader is not ready" >&2
  exit 1
fi

echo "Spaces verifier Fabric record reader is ready"
