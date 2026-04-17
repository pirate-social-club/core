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
    rtk rg -q "\"folderName\"[[:space:]]*:[[:space:]]*\"$name\""; then
    return 0
  fi

  rtk infisical secrets folders create --env "$INFISICAL_ENV" --path "$parent" --name "$name" >/dev/null
}

set_secret() {
  local path="$1"
  local name="$2"
  local value="$3"
  local temp_file

  temp_file="$(mktemp)"
  printf '%s' "$value" >"$temp_file"
  rtk infisical secrets set --env "$INFISICAL_ENV" --path "$path" "${name}=@${temp_file}" >/dev/null
  rm -f "$temp_file"
}

echo "bootstrapping pirate-v2 Story runtime usage keys in Infisical env: $INFISICAL_ENV" >&2
echo "note: STORY_CONTRACT_OWNER_PRIVATE_KEY is intentionally not written to Infisical" >&2

if [[ -n "${LIT_CHIPOTLE_OPERATOR_API_KEY:-}" || -n "${LIT_CHIPOTLE_ACCESS_CONTROLLER_API_KEY:-}" || -n "${LIT_CHIPOTLE_STORY_SETTLEMENT_API_KEY:-}" ]]; then
  ensure_folder "/" "services"
  ensure_folder "/services" "api"

  if [[ -n "${LIT_CHIPOTLE_OPERATOR_API_KEY:-}" ]]; then
    set_secret "/services/api" "LIT_CHIPOTLE_OPERATOR_API_KEY" "$LIT_CHIPOTLE_OPERATOR_API_KEY"
  fi

  if [[ -n "${LIT_CHIPOTLE_ACCESS_CONTROLLER_API_KEY:-}" ]]; then
    set_secret "/services/api" "LIT_CHIPOTLE_ACCESS_CONTROLLER_API_KEY" "$LIT_CHIPOTLE_ACCESS_CONTROLLER_API_KEY"
  fi

  if [[ -n "${LIT_CHIPOTLE_STORY_SETTLEMENT_API_KEY:-}" ]]; then
    set_secret "/services/api" "LIT_CHIPOTLE_STORY_SETTLEMENT_API_KEY" "$LIT_CHIPOTLE_STORY_SETTLEMENT_API_KEY"
  fi
fi

cat <<EOF
infisical bootstrap complete
env: $INFISICAL_ENV
created/updated:
- /services/api: optional delivery runtime usage keys when provided

validate with:
  bun scripts/check-infisical-env.ts --env $INFISICAL_ENV
EOF
