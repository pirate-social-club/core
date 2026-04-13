#!/usr/bin/env bash
set -euo pipefail

INFISICAL_ENV="${INFISICAL_ENV:-dev}"

ensure_folder() {
  local parent="$1"
  local name="$2"

  if rtk infisical secrets folders get --env "$INFISICAL_ENV" --path "$parent" -o json |
    rtk rg -q "\"folderName\"[[:space:]]*:[[:space:]]*\"$name\""; then
    return 0
  fi

  rtk infisical secrets folders create --env "$INFISICAL_ENV" --path "$parent" --name "$name" >/dev/null
}

set_secret_if_present() {
  local path="$1"
  local name="$2"
  local value="${!name:-}"
  local temp_file

  if [[ -z "$value" ]]; then
    return 0
  fi

  temp_file="$(mktemp)"
  printf '%s' "$value" >"$temp_file"
  rtk infisical secrets set --env "$INFISICAL_ENV" --path "$path" "${name}=@${temp_file}" >/dev/null
  rm -f "$temp_file"
}

if [[ -z "${AUTH_UPSTREAM_JWT_SHARED_SECRET:-}" \
  && -z "${PIRATE_APP_JWT_PRIVATE_KEY:-}" \
  && -z "${PIRATE_APP_JWT_PUBLIC_KEY:-}" \
  && -z "${PRIVY_APP_SECRET:-}" \
  && -z "${PRIVY_JWT_VERIFICATION_KEY:-}" ]]; then
  echo "provide at least one API runtime secret to bootstrap" >&2
  echo "supported vars: AUTH_UPSTREAM_JWT_SHARED_SECRET PIRATE_APP_JWT_PRIVATE_KEY PIRATE_APP_JWT_PUBLIC_KEY PRIVY_APP_SECRET PRIVY_JWT_VERIFICATION_KEY" >&2
  exit 1
fi

echo "bootstrapping pirate-v2 API runtime secrets in Infisical env: $INFISICAL_ENV" >&2

ensure_folder "/" "services"
ensure_folder "/services" "api"

set_secret_if_present "/services/api" "AUTH_UPSTREAM_JWT_SHARED_SECRET"
set_secret_if_present "/services/api" "PIRATE_APP_JWT_PRIVATE_KEY"
set_secret_if_present "/services/api" "PIRATE_APP_JWT_PUBLIC_KEY"
set_secret_if_present "/services/api" "PRIVY_APP_SECRET"
set_secret_if_present "/services/api" "PRIVY_JWT_VERIFICATION_KEY"

cat <<EOF
infisical API runtime bootstrap complete
env: $INFISICAL_ENV
created/updated in /services/api when provided:
- AUTH_UPSTREAM_JWT_SHARED_SECRET
- PIRATE_APP_JWT_PRIVATE_KEY
- PIRATE_APP_JWT_PUBLIC_KEY
- PRIVY_APP_SECRET
- PRIVY_JWT_VERIFICATION_KEY
intentionally not stored here:
- AUTH_UPSTREAM_JWT_ISSUER
- AUTH_UPSTREAM_JWT_AUDIENCE
- PRIVY_APP_ID
- PRIVY_API_URL
not API runtime secrets (use operator bootstrap instead):
- SPACES_VERIFIER_AUTH_TOKEN
- FILEBASE_S3_ACCESS_KEY
- FILEBASE_S3_SECRET_KEY
- COMMUNITY_PROVISION_OPERATOR_AUTH_TOKEN
EOF
