#!/usr/bin/env bash
set -euo pipefail

# Posts a failure notification to the ops-alerts webhook. Invoked by the
# templated OnFailure unit with the failing unit's name as $1. The payload
# shape matches the API's ops-alerts sink: POST {"text": ...}.

failed_unit="${1:-unknown-unit}"
# Systemd unit names are constrained, but %i arrives escaped — keep only
# characters that are safe to embed verbatim in a JSON string.
failed_unit="$(tr -cd 'A-Za-z0-9@._:-' <<< "$failed_unit")"

if [[ -z "${OPS_ALERT_WEBHOOK_URL:-}" ]]; then
  echo "OPS_ALERT_WEBHOOK_URL is not configured; cannot deliver failure alert for $failed_unit" >&2
  exit 1
fi

host="$(hostname -s | tr -cd 'A-Za-z0-9._-')"
timestamp="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
text="[hns-edge] ${failed_unit} FAILED on ${host:-unknown} at ${timestamp}. Check: journalctl -u ${failed_unit}"

curl --fail --silent --show-error --max-time 10 \
  --header 'content-type: application/json' \
  --data "{\"text\":\"${text}\"}" \
  "$OPS_ALERT_WEBHOOK_URL" >/dev/null

echo "delivered failure alert for $failed_unit"
