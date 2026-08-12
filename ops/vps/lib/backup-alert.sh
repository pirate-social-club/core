#!/usr/bin/env bash

send_backup_failure_alert() {
  local label=$1 failed_unit=${2:-unknown-unit}
  local host timestamp text token
  local -a auth_args=()

  failed_unit=$(tr -cd 'A-Za-z0-9@._:-' <<< "$failed_unit")
  label=$(tr -cd 'A-Za-z0-9._:-' <<< "$label")
  if [[ -z "${OPS_ALERT_WEBHOOK_URL:-}" ]]; then
    echo "OPS_ALERT_WEBHOOK_URL is not configured; cannot deliver failure alert for $failed_unit" >&2
    return 1
  fi

  host=$(hostname -s | tr -cd 'A-Za-z0-9._-')
  timestamp=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  text="[${label:-backup}] ${failed_unit} FAILED on ${host:-unknown} at ${timestamp}. Check: journalctl -u ${failed_unit}"

  if [[ -n "${OPS_ALERT_BEARER_TOKEN_FILE:-}" ]]; then
    if [[ ! -r "$OPS_ALERT_BEARER_TOKEN_FILE" ]]; then
      echo "OPS_ALERT_BEARER_TOKEN_FILE is not readable" >&2
      return 1
    fi
    token=$(tr -d '\r\n' < "$OPS_ALERT_BEARER_TOKEN_FILE")
    if (( ${#token} < 32 )); then
      echo "ops alert bearer token must contain at least 32 characters" >&2
      return 1
    fi
    auth_args=(--header "authorization: Bearer $token")
  fi

  curl --fail --silent --show-error --max-time 10 \
    --header 'content-type: application/json' \
    "${auth_args[@]}" \
    --data "{\"text\":\"${text}\"}" \
    "$OPS_ALERT_WEBHOOK_URL" >/dev/null
  echo "delivered failure alert for $failed_unit"
}
