#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat >&2 <<'EOF'
Usage:
  ./scripts/infisical/operator-env-run.sh --env-file PATH [--profile NAME] [--require VAR ...] -- command [args...]

Profiles:
  control-plane-seed
  story-delivery-owner
  turso-provision
  turso-rotate
  turso-doctor
  turso-operator-server

Examples:
  ./scripts/infisical/operator-env-run.sh --env-file scripts/.env.operator-staging --profile turso-doctor -- \
    rtk bun scripts/turso/turso-control-plane.ts doctor --community-id cmt_infinity_01

  ./scripts/infisical/operator-env-run.sh --env-file scripts/.env.operator-staging --profile control-plane-seed -- \
    rtk bun scripts/control-plane/seed-control-plane-fixtures.ts --database-url-env CONTROL_PLANE_DATABASE_URL ...
EOF
  exit 1
}

ENV_FILE=""
PROFILE=""
declare -a REQUIRED_VARS=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --env-file)
      ENV_FILE="${2:-}"
      shift 2
      ;;
    --profile)
      PROFILE="${2:-}"
      shift 2
      ;;
    --require)
      REQUIRED_VARS+=("${2:-}")
      shift 2
      ;;
    --)
      shift
      break
      ;;
    -h|--help)
      usage
      ;;
    *)
      echo "unknown argument: $1" >&2
      usage
      ;;
  esac
done

if [[ -z "$ENV_FILE" || $# -eq 0 ]]; then
  usage
fi

if [[ ! -f "$ENV_FILE" ]]; then
  echo "operator env file not found: $ENV_FILE" >&2
  exit 1
fi

case "$PROFILE" in
  "")
    ;;
  control-plane-seed)
    REQUIRED_VARS+=("CONTROL_PLANE_DATABASE_URL")
    ;;
  story-delivery-owner)
    REQUIRED_VARS+=(
      "STORY_CONTRACT_OWNER_PRIVATE_KEY"
    )
    ;;
  turso-provision)
    REQUIRED_VARS+=(
      "CONTROL_PLANE_DATABASE_URL"
      "TURSO_PLATFORM_API_TOKEN"
      "TURSO_ORGANIZATION_SLUG"
      "TURSO_COMMUNITY_DB_WRAP_KEY"
      "TURSO_COMMUNITY_DB_WRAP_KEY_VERSION"
    )
    ;;
  turso-rotate)
    REQUIRED_VARS+=(
      "CONTROL_PLANE_DATABASE_URL"
      "TURSO_PLATFORM_API_TOKEN"
      "TURSO_COMMUNITY_DB_WRAP_KEY"
      "TURSO_COMMUNITY_DB_WRAP_KEY_VERSION"
    )
    ;;
  turso-doctor)
    REQUIRED_VARS+=(
      "CONTROL_PLANE_DATABASE_URL"
      "TURSO_COMMUNITY_DB_WRAP_KEY"
    )
    ;;
  turso-operator-server)
    REQUIRED_VARS+=(
      "CONTROL_PLANE_DATABASE_URL"
      "TURSO_PLATFORM_API_TOKEN"
      "TURSO_ORGANIZATION_SLUG"
      "TURSO_COMMUNITY_DB_WRAP_KEY"
      "TURSO_COMMUNITY_DB_WRAP_KEY_VERSION"
      "COMMUNITY_PROVISION_OPERATOR_AUTH_TOKEN"
    )
    ;;
  *)
    echo "unknown profile: $PROFILE" >&2
    usage
    ;;
esac

set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

declare -A SEEN=()
for name in "${REQUIRED_VARS[@]}"; do
  if [[ -n "${SEEN[$name]:-}" ]]; then
    continue
  fi
  SEEN[$name]=1
  if [[ -z "${!name:-}" ]]; then
    echo "missing required env var after sourcing $ENV_FILE: $name" >&2
    exit 1
  fi
done

if [[ -n "${EXPECTED_TURSO_ORGANIZATION_SLUG:-}" && -n "${TURSO_ORGANIZATION_SLUG:-}" && "$TURSO_ORGANIZATION_SLUG" != "$EXPECTED_TURSO_ORGANIZATION_SLUG" ]]; then
  echo "TURSO_ORGANIZATION_SLUG mismatch after sourcing $ENV_FILE: expected $EXPECTED_TURSO_ORGANIZATION_SLUG, received $TURSO_ORGANIZATION_SLUG" >&2
  exit 1
fi

exec "$@"
