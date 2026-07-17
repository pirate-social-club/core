#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${OPS_ALERT_WEBHOOK_URL:-}" ]]; then
  echo "OPS_ALERT_WEBHOOK_URL is not configured; cannot deliver deployment heartbeat" >&2
  exit 1
fi
if [[ -z "${OPS_ALERT_BEARER_TOKEN_FILE:-}" || ! -r "$OPS_ALERT_BEARER_TOKEN_FILE" ]]; then
  echo "OPS_ALERT_BEARER_TOKEN_FILE is not readable" >&2
  exit 1
fi
if [[ -z "${DEPLOY_ROOT:-}" || ! -r "$DEPLOY_ROOT/current/DEPLOYMENT" ]]; then
  echo "DEPLOY_ROOT/current/DEPLOYMENT is not readable" >&2
  exit 1
fi

token="$(tr -d '\r\n' < "$OPS_ALERT_BEARER_TOKEN_FILE")"
if [[ ${#token} -lt 32 ]]; then
  echo "ops alert bearer token must contain at least 32 characters" >&2
  exit 1
fi

role="$(sed -n 's/^ROLE=//p' "$DEPLOY_ROOT/current/DEPLOYMENT" | head -1 | tr -cd 'A-Za-z0-9._-')"
core_commit="$(sed -n 's/^CORE_COMMIT=//p' "$DEPLOY_ROOT/current/DEPLOYMENT" | head -1 | tr -cd 'a-f0-9')"
host="$(hostname -s | tr -cd 'A-Za-z0-9._-')"
verified_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
if [[ -z "$host" || -z "$role" || ! "$core_commit" =~ ^[a-f0-9]{40}$ ]]; then
  echo "deployment heartbeat identity is invalid" >&2
  exit 1
fi

payload="$(printf '{\"kind\":\"heartbeat\",\"host\":\"%s\",\"role\":\"%s\",\"core_commit\":\"%s\",\"verified_at\":\"%s\"}' \
  "$host" "$role" "$core_commit" "$verified_at")"

curl --fail --silent --show-error --max-time 10 \
  --header 'content-type: application/json' \
  --header "authorization: Bearer $token" \
  --data "$payload" \
  "$OPS_ALERT_WEBHOOK_URL" >/dev/null

echo "delivered deployment heartbeat for $host:$role"
