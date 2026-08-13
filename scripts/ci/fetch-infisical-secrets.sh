#!/usr/bin/env bash
set -euo pipefail

required_env=(
  ACTIONS_ID_TOKEN_REQUEST_TOKEN
  ACTIONS_ID_TOKEN_REQUEST_URL
  GITHUB_ENV
  INFISICAL_IDENTITY_ID
  INFISICAL_PROJECT_ID
  INFISICAL_ENV
  INFISICAL_SECRET_PATH
  SECRET_NAMES
)

for name in "${required_env[@]}"; do
  if [ -z "${!name:-}" ]; then
    echo "Missing required environment variable: $name" >&2
    exit 1
  fi
done

curl_retry=(
  --retry 4
  --retry-delay 2
  --retry-max-time 90
  --retry-connrefused
  --connect-timeout 10
  --max-time 60
)

# Overridable only so the failure-classification tests can point the script at a
# local stub. Production callers never set it.
infisical_base_url="${INFISICAL_API_BASE_URL:-https://app.infisical.com}"
audience="${INFISICAL_GITHUB_AUDIENCE:-https://github.com/pirate-social-club}"
encoded_audience="$(
  AUDIENCE="$audience" node -e 'process.stdout.write(encodeURIComponent(process.env.AUDIENCE));'
)"

oidc_response="$(
  curl -fsS \
    "${curl_retry[@]}" \
    -H "Authorization: bearer $ACTIONS_ID_TOKEN_REQUEST_TOKEN" \
    "${ACTIONS_ID_TOKEN_REQUEST_URL}&audience=${encoded_audience}"
)"
oidc_token="$(
  OIDC_RESPONSE="$oidc_response" node -e 'const response = JSON.parse(process.env.OIDC_RESPONSE); if (!response.value) process.exit(1); process.stdout.write(response.value);'
)"
login_payload="$(
  INFISICAL_IDENTITY_ID="$INFISICAL_IDENTITY_ID" OIDC_TOKEN="$oidc_token" node -e 'process.stdout.write(JSON.stringify({ identityId: process.env.INFISICAL_IDENTITY_ID, jwt: process.env.OIDC_TOKEN }));'
)"
# Both Infisical calls below can return 403 for completely different reasons, and
# piping a failed response straight into node collapses them into an identical
# `curl: (22)` + `SyntaxError: Unexpected end of JSON input`. That ambiguity has
# repeatedly cost whole sessions, so each call captures its status separately and
# names which stage rejected it. `-f` is intentionally dropped so the body is
# still readable on error; --retry continues to cover transient 5xx/429.
response_body="$(mktemp)"
trap 'rm -f "$response_body"' EXIT

# Claims only — never the token itself. These are exactly what Infisical pins the
# identity's Subject/Audience/Issuer against, so printing them turns a blind 403
# into a direct comparison.
oidc_claims="$(
  OIDC_TOKEN="$oidc_token" node -e 'const [, part] = process.env.OIDC_TOKEN.split("."); const claims = JSON.parse(Buffer.from(part, "base64url").toString("utf8")); process.stdout.write(["iss", "aud", "sub"].map((key) => `${key}=${claims[key]}`).join("\n  "));'
)"

login_status="$(
  curl -sS \
    "${curl_retry[@]}" \
    -o "$response_body" \
    -w '%{http_code}' \
    -X POST "$infisical_base_url/api/v1/auth/oidc-auth/login" \
    -H "Content-Type: application/json" \
    --data "$login_payload"
)"
if [ "$login_status" != "200" ]; then
  echo "Infisical OIDC AUTHENTICATION failed (HTTP $login_status)." >&2
  echo "  stage: /auth/oidc-auth/login — the identity's trust policy rejected these claims." >&2
  echo "  This is NOT a project-permission problem; no secret was requested yet." >&2
  echo "  identity: $INFISICAL_IDENTITY_ID" >&2
  echo "  presented claims:" >&2
  echo "  $oidc_claims" >&2
  echo "  Infisical must pin this identity to exactly the sub and aud above." >&2
  echo "  Note: declaring \`environment:\` on the job CHANGES sub to the environment form." >&2
  cat "$response_body" >&2
  exit 1
fi
infisical_token="$(
  node -e 'let input = ""; process.stdin.on("data", (chunk) => input += chunk); process.stdin.on("end", () => { const response = JSON.parse(input); if (!response.accessToken) process.exit(1); process.stdout.write(response.accessToken); });' < "$response_body"
)"

fetch_secret() {
  local name="$1"
  local status
  status="$(
    curl -sS "${curl_retry[@]}" --get "$infisical_base_url/api/v4/secrets/$name" \
      -o "$response_body" \
      -w '%{http_code}' \
      -H "Authorization: Bearer $infisical_token" \
      --data-urlencode "projectId=$INFISICAL_PROJECT_ID" \
      --data-urlencode "environment=$INFISICAL_ENV" \
      --data-urlencode "secretPath=$INFISICAL_SECRET_PATH" \
      --data-urlencode "type=shared" \
      --data-urlencode "viewSecretValue=true" \
      --data-urlencode "expandSecretReferences=true" \
      --data-urlencode "includeImports=false"
  )"
  if [ "$status" != "200" ]; then
    echo "Infisical SECRET READ failed (HTTP $status) for $name." >&2
    echo "  stage: /secrets/$name — the identity authenticated, then was refused this secret." >&2
    echo "  requested: env=$INFISICAL_ENV path=$INFISICAL_SECRET_PATH" >&2
    echo "  identity: $INFISICAL_IDENTITY_ID" >&2
    echo "  Needs both describeSecret AND readValue (this call sets viewSecretValue=true)." >&2
    echo "  Check Project Roles AND Project Additional Privileges; the body below lists" >&2
    echo "  the rules this identity actually has." >&2
    cat "$response_body" >&2
    return 1
  fi
  local value
  value="$(
    node -e 'let input = ""; process.stdin.on("data", (chunk) => input += chunk); process.stdin.on("end", () => { const response = JSON.parse(input); const secretValue = response.secret && response.secret.secretValue; if (!secretValue) process.exit(1); process.stdout.write(secretValue); });' < "$response_body"
  )"
  # The response carried the plaintext secret. Clear it as soon as it is parsed so
  # it does not sit in a runner temp file for the rest of the job.
  : > "$response_body"
  printf '%s' "$value"
}

for name in $SECRET_NAMES; do
  value="$(fetch_secret "$name")"
  echo "::add-mask::$value"
  printf '%s=%s\n' "$name" "$value" >> "$GITHUB_ENV"
done
