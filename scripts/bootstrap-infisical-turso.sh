#!/usr/bin/env bash
set -euo pipefail

INFISICAL_ENV="${INFISICAL_ENV:-dev}"

ensure_folder() {
  local parent="$1"
  local name="$2"

  if rtk infisical secrets folders get --env "$INFISICAL_ENV" --path "$parent" -o json |
    rtk rg -q "\"name\"[[:space:]]*:[[:space:]]*\"$name\""; then
    return 0
  fi

  rtk infisical secrets folders create --env "$INFISICAL_ENV" --path "$parent" --name "$name" >/dev/null
}

set_secret_if_present() {
  local path="$1"
  local name="$2"
  local value="${!name:-}"

  if [[ -z "$value" ]]; then
    return 0
  fi

  rtk infisical secrets set --env "$INFISICAL_ENV" --path "$path" "$name=$value" >/dev/null
}

if [[ -z "${TURSO_PLATFORM_API_TOKEN:-}" && -z "${TURSO_COMMUNITY_DB_WRAP_KEY:-}" ]]; then
  echo "provide at least one Turso env var to bootstrap" >&2
  echo "supported vars: TURSO_PLATFORM_API_TOKEN TURSO_COMMUNITY_DB_WRAP_KEY" >&2
  exit 1
fi

echo "bootstrapping pirate-v2 Turso secrets in Infisical env: $INFISICAL_ENV" >&2

ensure_folder "/" "services"

if [[ -n "${TURSO_PLATFORM_API_TOKEN:-}" ]]; then
  ensure_folder "/services" "control-plane"
  set_secret_if_present "/services/control-plane" "TURSO_PLATFORM_API_TOKEN"
fi

if [[ -n "${TURSO_COMMUNITY_DB_WRAP_KEY:-}" ]]; then
  ensure_folder "/services" "api"
  set_secret_if_present "/services/api" "TURSO_COMMUNITY_DB_WRAP_KEY"
fi

cat <<EOF
infisical Turso bootstrap complete
env: $INFISICAL_ENV
created/updated:
- /services/control-plane: TURSO_PLATFORM_API_TOKEN when provided
- /services/api: TURSO_COMMUNITY_DB_WRAP_KEY when provided
EOF
