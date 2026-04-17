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

if [[ -z "${CONTROL_PLANE_DATABASE_URL:-}" && -z "${CONTROL_PLANE_MIGRATOR_DATABASE_URL:-}" ]]; then
  echo "provide at least one control-plane env var to bootstrap" >&2
  echo "supported vars: CONTROL_PLANE_DATABASE_URL CONTROL_PLANE_MIGRATOR_DATABASE_URL" >&2
  exit 1
fi

echo "bootstrapping pirate-v2 control-plane secrets in Infisical env: $INFISICAL_ENV" >&2

ensure_folder "/" "services"

if [[ -n "${CONTROL_PLANE_DATABASE_URL:-}" ]]; then
  ensure_folder "/services" "api"
  set_secret_if_present "/services/api" "CONTROL_PLANE_DATABASE_URL"
fi

if [[ -n "${CONTROL_PLANE_MIGRATOR_DATABASE_URL:-}" ]]; then
  ensure_folder "/services" "control-plane"
  set_secret_if_present "/services/control-plane" "CONTROL_PLANE_MIGRATOR_DATABASE_URL"
fi

if [[ -n "${CONTROL_PLANE_DATABASE_URL:-}" && -z "${CONTROL_PLANE_MIGRATOR_DATABASE_URL:-}" ]]; then
  echo "warning: CONTROL_PLANE_DATABASE_URL was bootstrapped without CONTROL_PLANE_MIGRATOR_DATABASE_URL" >&2
  echo "warning: /services/control-plane migrations remain unconfigured until the migrator URL is written" >&2
fi

cat <<EOF
infisical control-plane bootstrap complete
env: $INFISICAL_ENV
created/updated:
- /services/api: CONTROL_PLANE_DATABASE_URL when provided
- /services/control-plane: CONTROL_PLANE_MIGRATOR_DATABASE_URL when provided

validate with:
  bun scripts/check-infisical-env.ts --env $INFISICAL_ENV
EOF
