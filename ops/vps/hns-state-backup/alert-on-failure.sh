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

auth_args=()
if [[ -n "${OPS_ALERT_BEARER_TOKEN_FILE:-}" ]]; then
  if [[ ! -r "$OPS_ALERT_BEARER_TOKEN_FILE" ]]; then
    echo "OPS_ALERT_BEARER_TOKEN_FILE is not readable" >&2
    exit 1
  fi
  token="$(tr -d '\r\n' < "$OPS_ALERT_BEARER_TOKEN_FILE")"
  if [[ ${#token} -lt 32 ]]; then
    echo "ops alert bearer token must contain at least 32 characters" >&2
    exit 1
  fi
  auth_args=(--header "authorization: Bearer $token")
fi

curl --fail --silent --show-error --max-time 10 \
  --header 'content-type: application/json' \
  "${auth_args[@]}" \
  --data "{\"text\":\"${text}\"}" \
  "$OPS_ALERT_WEBHOOK_URL" >/dev/null

echo "delivered failure alert for $failed_unit"
