#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat >&2 <<'EOF'
Usage:
  ./scripts/sync-wrangler-api-secrets.sh [--env-file PATH] [--worker-name NAME]

If --env-file is omitted, the script reads from the current exported environment.
If --worker-name is omitted, the script syncs the worker named in wrangler.jsonc.

Examples:
  ./scripts/sync-wrangler-api-secrets.sh \
    --env-file pirate-api/services/api/.env.remote

  rtk infisical run --env staging --path /services/api -- \
    ./scripts/sync-wrangler-api-secrets.sh

  ./scripts/sync-wrangler-api-secrets.sh \
    --env-file pirate-api/services/api/.dev.vars \
    --worker-name pirate-api-staging
EOF
  exit 1
}

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
API_DIR="$ROOT_DIR/pirate-api/services/api"
WRANGLER="$API_DIR/node_modules/.bin/wrangler"
ENV_FILE=""
WORKER_NAME="pirate-api-core"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --env-file)
      ENV_FILE="${2:-}"
      shift 2
      ;;
    --worker-name)
      WORKER_NAME="${2:-}"
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

if [[ -z "${TURSO_CONTROL_PLANE_DATABASE_URL:-}" && -n "${CONTROL_PLANE_DATABASE_URL:-}" ]]; then
  TURSO_CONTROL_PLANE_DATABASE_URL="$CONTROL_PLANE_DATABASE_URL"
  export TURSO_CONTROL_PLANE_DATABASE_URL
fi

required_names=(
  AUTH_UPSTREAM_JWT_SHARED_SECRET
  CONTROL_PLANE_DATABASE_URL
  TURSO_CONTROL_PLANE_DATABASE_URL
  FILEBASE_S3_ACCESS_KEY
  FILEBASE_S3_SECRET_KEY
  OPENROUTER_API_KEY
  ACRCLOUD_ACCESS_KEY
  ACRCLOUD_ACCESS_SECRET
  ACRCLOUD_PERSONAL_ACCESS_TOKEN
  ELEVENLABS_API_KEY
  PIRATE_APP_JWT_PRIVATE_KEY
  PIRATE_APP_JWT_PUBLIC_KEY
  PRIVY_APP_SECRET
)

optional_names=(
  COMMUNITY_PROVISION_OPERATOR_AUTH_TOKEN
  CONTROL_PLANE_AUTH_TOKEN
  HNS_VERIFIER_AUTH_TOKEN
  HNS_VERIFIER_BASE_URL
  PRIVY_JWT_VERIFICATION_KEY
  REGISTRY_PUBLISHER_AUTH_TOKEN
  SPACES_VERIFIER_BASE_URL
  SPACES_VERIFIER_AUTH_TOKEN
  SPACES_VERIFIER_CHALLENGE_DOMAIN
  TURSO_COMMUNITY_DB_WRAP_KEY
  TURSO_CONTROL_PLANE_AUTH_TOKEN
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
  printf '%s' "$value" | (
    cd "$API_DIR"
    "$WRANGLER" secret put "$name" --name "$WORKER_NAME" >/dev/null
  )
}

echo "syncing API worker secrets to Cloudflare worker: $WORKER_NAME" >&2

for name in "${required_names[@]}"; do
  put_secret "$name"
done

for name in "${optional_names[@]}"; do
  put_secret "$name"
done

cat <<EOF
wrangler API secret sync complete
worker_name: $WORKER_NAME
required:
$(printf '%s\n' "${required_names[@]}" | sed 's/^/- /')
optional when present:
$(printf '%s\n' "${optional_names[@]}" | sed 's/^/- /')
managed outside secret sync:
- AUTH_UPSTREAM_JWT_ENABLED
- AUTH_UPSTREAM_JWT_ISSUER
- AUTH_UPSTREAM_JWT_AUDIENCE
- PIRATE_APP_JWT_ISSUER
- PIRATE_APP_JWT_AUDIENCE
- PIRATE_APP_JWT_TTL_SECONDS
- PRIVY_APP_ID
- PRIVY_API_URL
- FILEBASE_MEDIA_BUCKET
- FILEBASE_S3_ENDPOINT
- FILEBASE_S3_REGION
- OPENROUTER_BASE_URL
- OPENROUTER_MODEL
- ACRCLOUD_HOST
- ACRCLOUD_IDENTIFY_PATH
- ACRCLOUD_BUCKET_ID
- ACRCLOUD_CONSOLE_BASE_URL
- ELEVENLABS_FORCE_ALIGNMENT_URL
- REGISTRY_PUBLISHER_URL
- REGISTRY_PUBLISHER_TIMEOUT_MS
- DEV_MEMORY_STORE_ENABLED
- ENVIRONMENT
EOF
