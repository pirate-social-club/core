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
  && -z "${PRIVY_JWT_VERIFICATION_KEY:-}" \
  && -z "${FILEBASE_S3_ACCESS_KEY:-}" \
  && -z "${FILEBASE_S3_SECRET_KEY:-}" \
  && -z "${OPENROUTER_API_KEY:-}" \
  && -z "${ACRCLOUD_ACCESS_KEY:-}" \
  && -z "${ACRCLOUD_ACCESS_SECRET:-}" \
  && -z "${ACRCLOUD_PERSONAL_ACCESS_TOKEN:-}" \
  && -z "${ELEVENLABS_API_KEY:-}" \
  && -z "${STORY_CONTRACT_OWNER_PRIVATE_KEY:-}" \
  && -z "${STORY_RUNTIME_PRIVATE_KEY:-}" \
  && -z "${STORY_OPERATOR_PRIVATE_KEY:-}" \
  && -z "${STORY_CDR_WRITER_PRIVATE_KEY:-}" \
  && -z "${STORY_ACCESS_CONTROLLER_PRIVATE_KEY:-}" \
  && -z "${MUSIC_PURCHASE_STORY_SETTLEMENT_PRIVATE_KEY:-}" ]]; then
  echo "provide at least one API runtime secret to bootstrap" >&2
  echo "supported vars: AUTH_UPSTREAM_JWT_SHARED_SECRET PIRATE_APP_JWT_PRIVATE_KEY PIRATE_APP_JWT_PUBLIC_KEY PRIVY_APP_SECRET PRIVY_JWT_VERIFICATION_KEY FILEBASE_S3_ACCESS_KEY FILEBASE_S3_SECRET_KEY OPENROUTER_API_KEY ACRCLOUD_ACCESS_KEY ACRCLOUD_ACCESS_SECRET ACRCLOUD_PERSONAL_ACCESS_TOKEN ELEVENLABS_API_KEY STORY_CONTRACT_OWNER_PRIVATE_KEY STORY_RUNTIME_PRIVATE_KEY STORY_OPERATOR_PRIVATE_KEY STORY_CDR_WRITER_PRIVATE_KEY STORY_ACCESS_CONTROLLER_PRIVATE_KEY MUSIC_PURCHASE_STORY_SETTLEMENT_PRIVATE_KEY" >&2
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
set_secret_if_present "/services/api" "FILEBASE_S3_ACCESS_KEY"
set_secret_if_present "/services/api" "FILEBASE_S3_SECRET_KEY"
set_secret_if_present "/services/api" "OPENROUTER_API_KEY"
set_secret_if_present "/services/api" "ACRCLOUD_ACCESS_KEY"
set_secret_if_present "/services/api" "ACRCLOUD_ACCESS_SECRET"
set_secret_if_present "/services/api" "ACRCLOUD_PERSONAL_ACCESS_TOKEN"
set_secret_if_present "/services/api" "ELEVENLABS_API_KEY"
set_secret_if_present "/services/api" "STORY_CONTRACT_OWNER_PRIVATE_KEY"
set_secret_if_present "/services/api" "STORY_RUNTIME_PRIVATE_KEY"
set_secret_if_present "/services/api" "STORY_OPERATOR_PRIVATE_KEY"
set_secret_if_present "/services/api" "STORY_CDR_WRITER_PRIVATE_KEY"
set_secret_if_present "/services/api" "STORY_ACCESS_CONTROLLER_PRIVATE_KEY"
set_secret_if_present "/services/api" "MUSIC_PURCHASE_STORY_SETTLEMENT_PRIVATE_KEY"

cat <<EOF
infisical API runtime bootstrap complete
env: $INFISICAL_ENV
created/updated in /services/api when provided:
- AUTH_UPSTREAM_JWT_SHARED_SECRET
- PIRATE_APP_JWT_PRIVATE_KEY
- PIRATE_APP_JWT_PUBLIC_KEY
- PRIVY_APP_SECRET
- PRIVY_JWT_VERIFICATION_KEY
- FILEBASE_S3_ACCESS_KEY
- FILEBASE_S3_SECRET_KEY
- OPENROUTER_API_KEY
- ACRCLOUD_ACCESS_KEY
- ACRCLOUD_ACCESS_SECRET
- ACRCLOUD_PERSONAL_ACCESS_TOKEN
- ELEVENLABS_API_KEY
- STORY_CONTRACT_OWNER_PRIVATE_KEY
- STORY_RUNTIME_PRIVATE_KEY
- STORY_OPERATOR_PRIVATE_KEY
- STORY_CDR_WRITER_PRIVATE_KEY
- STORY_ACCESS_CONTROLLER_PRIVATE_KEY
- MUSIC_PURCHASE_STORY_SETTLEMENT_PRIVATE_KEY
intentionally not stored here:
- AUTH_UPSTREAM_JWT_ISSUER
- AUTH_UPSTREAM_JWT_AUDIENCE
- PRIVY_APP_ID
- PRIVY_API_URL
- OPENROUTER_BASE_URL
- OPENROUTER_MODEL
- ACRCLOUD_HOST
- ACRCLOUD_IDENTIFY_PATH
- ACRCLOUD_BUCKET_ID
- ACRCLOUD_CONSOLE_BASE_URL
- ELEVENLABS_FORCE_ALIGNMENT_URL
- STORY_RPC_URL
- STORY_RPC_FALLBACK_URLS
- STORY_RUNTIME_SIGNER_MIN_BALANCE_WEI
- STORY_RUNTIME_SIGNER_TARGET_BALANCE_WEI
- IPFS_GATEWAY_URL
still handled outside this bootstrap:
- SPACES_VERIFIER_AUTH_TOKEN
- COMMUNITY_PROVISION_OPERATOR_AUTH_TOKEN

validate with:
  bun scripts/check-infisical-env.ts --env $INFISICAL_ENV
EOF
