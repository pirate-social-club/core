#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat >&2 <<'EOF'
Usage:
  ./scripts/sync-wrangler-api-secrets.sh --wrangler-env staging|production [--env-file PATH]

If --env-file is omitted, the script reads from the current exported environment.

Examples:
  ./scripts/sync-wrangler-api-secrets.sh \
    --env-file pirate-api/services/api/.env.staging \
    --wrangler-env staging

  ./scripts/sync-wrangler-api-secrets.sh \
    --env-file pirate-api/services/api/.env.production \
    --wrangler-env production

  rtk infisical run --env staging --path /services/api -- \
    ./scripts/sync-wrangler-api-secrets.sh --wrangler-env staging
EOF
  exit 1
}

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
API_DIR="$ROOT_DIR/pirate-api/services/api"
WRANGLER="$API_DIR/node_modules/.bin/wrangler"
ENV_FILE=""
WRANGLER_ENV=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --env-file)
      ENV_FILE="${2:-}"
      shift 2
      ;;
    --wrangler-env)
      WRANGLER_ENV="${2:-}"
      shift 2
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

if [[ -z "$WRANGLER_ENV" ]]; then
  usage
fi

if [[ "$WRANGLER_ENV" != "staging" && "$WRANGLER_ENV" != "production" ]]; then
  echo "unsupported wrangler env: $WRANGLER_ENV" >&2
  usage
fi

if [[ ! -x "$WRANGLER" ]]; then
  echo "wrangler executable not found: $WRANGLER" >&2
  exit 1
fi

if [[ -n "$ENV_FILE" ]]; then
  if [[ ! -f "$ENV_FILE" ]]; then
    echo "env file not found: $ENV_FILE" >&2
    exit 1
  fi
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi

required_names=(
  ALLOW_LOCAL_STUB_REGISTRY_PUBLICATION
  AUTH_UPSTREAM_JWT_SHARED_SECRET
  CONTROL_PLANE_DATABASE_URL
  PIRATE_API_PUBLIC_ORIGIN
  PIRATE_APP_JWT_PRIVATE_KEY
  PIRATE_APP_JWT_PUBLIC_KEY
  PRIVY_APP_ID
  PRIVY_APP_SECRET
  SPACES_VERIFIER_BASE_URL
  TURSO_COMMUNITY_DB_WRAP_KEY
)

optional_names=(
  COMMUNITY_PROVISION_OPERATOR_AUTH_TOKEN
  PRIVY_JWT_VERIFICATION_KEY
  SPACES_VERIFIER_AUTH_TOKEN
  FILEBASE_S3_ACCESS_KEY
  FILEBASE_S3_SECRET_KEY
)

for name in "${required_names[@]}"; do
  if [[ -z "${!name:-}" ]]; then
    echo "missing required env var for wrangler secret sync: $name" >&2
    exit 1
  fi
done

put_secret() {
  local name="$1"
  local value="${!name:-}"
  if [[ -z "$value" ]]; then
    return 0
  fi
  if [[ "$WRANGLER_ENV" == "production" ]]; then
    printf '%s' "$value" | (
      cd "$API_DIR"
      "$WRANGLER" secret put "$name" --env="" >/dev/null
    )
    return 0
  fi

  printf '%s' "$value" | (
    cd "$API_DIR"
    "$WRANGLER" secret put "$name" --env "$WRANGLER_ENV" >/dev/null
  )
}

echo "syncing API worker secrets to Cloudflare env: $WRANGLER_ENV" >&2

for name in "${required_names[@]}"; do
  put_secret "$name"
done

for name in "${optional_names[@]}"; do
  put_secret "$name"
done

cat <<EOF
wrangler API secret sync complete
worker_env: $WRANGLER_ENV
required:
$(printf '%s\n' "${required_names[@]}" | sed 's/^/- /')
optional when present:
$(printf '%s\n' "${optional_names[@]}" | sed 's/^/- /')
EOF
