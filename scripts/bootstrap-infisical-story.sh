#!/usr/bin/env bash
set -euo pipefail

INFISICAL_ENV="${INFISICAL_ENV:-dev}"

require_env() {
  local name="$1"
  if [[ -z "${!name:-}" ]]; then
    echo "missing required env: $name" >&2
    exit 1
  fi
}

ensure_folder() {
  local parent="$1"
  local name="$2"

  if rtk infisical secrets folders get --env "$INFISICAL_ENV" --path "$parent" -o json |
    rtk rg -q "\"name\"[[:space:]]*:[[:space:]]*\"$name\""; then
    return 0
  fi

  rtk infisical secrets folders create --env "$INFISICAL_ENV" --path "$parent" --name "$name" >/dev/null
}

set_secret() {
  local path="$1"
  local assignment="$2"
  rtk infisical secrets set --env "$INFISICAL_ENV" --path "$path" "$assignment" >/dev/null
}

require_env STORY_CONTRACT_OWNER_PRIVATE_KEY

echo "bootstrapping pirate-v2 Story secrets in Infisical env: $INFISICAL_ENV" >&2

ensure_folder "/" "contracts"
ensure_folder "/contracts" "story"
set_secret "/contracts/story" "STORY_CONTRACT_OWNER_PRIVATE_KEY=$STORY_CONTRACT_OWNER_PRIVATE_KEY"

if [[ -n "${LIT_CHIPOTLE_OPERATOR_API_KEY:-}" || -n "${LIT_CHIPOTLE_ACCESS_CONTROLLER_API_KEY:-}" || -n "${LIT_CHIPOTLE_STORY_SETTLEMENT_API_KEY:-}" ]]; then
  ensure_folder "/" "services"
  ensure_folder "/services" "api"

  if [[ -n "${LIT_CHIPOTLE_OPERATOR_API_KEY:-}" ]]; then
    set_secret "/services/api" "LIT_CHIPOTLE_OPERATOR_API_KEY=$LIT_CHIPOTLE_OPERATOR_API_KEY"
  fi

  if [[ -n "${LIT_CHIPOTLE_ACCESS_CONTROLLER_API_KEY:-}" ]]; then
    set_secret "/services/api" "LIT_CHIPOTLE_ACCESS_CONTROLLER_API_KEY=$LIT_CHIPOTLE_ACCESS_CONTROLLER_API_KEY"
  fi

  if [[ -n "${LIT_CHIPOTLE_STORY_SETTLEMENT_API_KEY:-}" ]]; then
    set_secret "/services/api" "LIT_CHIPOTLE_STORY_SETTLEMENT_API_KEY=$LIT_CHIPOTLE_STORY_SETTLEMENT_API_KEY"
  fi
fi

cat <<EOF
infisical bootstrap complete
env: $INFISICAL_ENV
created/updated:
- /contracts/story: STORY_CONTRACT_OWNER_PRIVATE_KEY
- /services/api: optional delivery runtime usage keys when provided
EOF
