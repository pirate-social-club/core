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

audience="${INFISICAL_GITHUB_AUDIENCE:-https://github.com/pirate-social-club}"
encoded_audience="$(
  AUDIENCE="$audience" node -e 'process.stdout.write(encodeURIComponent(process.env.AUDIENCE));'
)"

oidc_response="$(
  curl -fsS \
    -H "Authorization: bearer $ACTIONS_ID_TOKEN_REQUEST_TOKEN" \
    "${ACTIONS_ID_TOKEN_REQUEST_URL}&audience=${encoded_audience}"
)"
oidc_token="$(
  OIDC_RESPONSE="$oidc_response" node -e 'const response = JSON.parse(process.env.OIDC_RESPONSE); if (!response.value) process.exit(1); process.stdout.write(response.value);'
)"
login_payload="$(
  INFISICAL_IDENTITY_ID="$INFISICAL_IDENTITY_ID" OIDC_TOKEN="$oidc_token" node -e 'process.stdout.write(JSON.stringify({ identityId: process.env.INFISICAL_IDENTITY_ID, jwt: process.env.OIDC_TOKEN }));'
)"
infisical_token="$(
  curl -fsS \
    -X POST "https://app.infisical.com/api/v1/auth/oidc-auth/login" \
    -H "Content-Type: application/json" \
    --data "$login_payload" \
    | node -e 'let input = ""; process.stdin.on("data", (chunk) => input += chunk); process.stdin.on("end", () => { const response = JSON.parse(input); if (!response.accessToken) process.exit(1); process.stdout.write(response.accessToken); });'
)"

fetch_secret() {
  local name="$1"
  local response
  local curl_status=0
  response="$(curl -sS --get "https://app.infisical.com/api/v4/secrets/$name" \
    -H "Authorization: Bearer $infisical_token" \
    --data-urlencode "projectId=$INFISICAL_PROJECT_ID" \
    --data-urlencode "environment=$INFISICAL_ENV" \
    --data-urlencode "secretPath=$INFISICAL_SECRET_PATH" \
    --data-urlencode "type=shared" \
    --data-urlencode "viewSecretValue=true" \
    --data-urlencode "expandSecretReferences=true" \
    --data-urlencode "includeImports=false" \
    --write-out $'\n%{http_code}')" || curl_status=$?
  local http_status="${response##*$'\n'}"
  local body="${response%$'\n'*}"
  if [ "$curl_status" -ne 0 ] || ! [[ "$http_status" =~ ^[0-9][0-9][0-9]$ ]] || [ "$http_status" -lt 200 ] || [ "$http_status" -ge 300 ]; then
    echo "::error::Infisical secret fetch failed for ${INFISICAL_ENV}:${INFISICAL_SECRET_PATH}/${name} (HTTP ${http_status:-unknown}, curl exit ${curl_status}). Check identity ${INFISICAL_IDENTITY_ID} can read this secret." >&2
    return 1
  fi
  RESPONSE="$body" SECRET_NAME="$name" node -e 'const response = JSON.parse(process.env.RESPONSE || "{}"); const value = response.secret && response.secret.secretValue; if (!value) { console.error(`Infisical returned no value for ${process.env.SECRET_NAME}`); process.exit(1); } process.stdout.write(value);'
}

for name in $SECRET_NAMES; do
  value="$(fetch_secret "$name")"
  echo "::add-mask::$value"
  printf '%s=%s\n' "$name" "$value" >> "$GITHUB_ENV"
done
