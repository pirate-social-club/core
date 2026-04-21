#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat >&2 <<'EOF'
Usage:
  ./scripts/infisical/sync-wrangler-api-secrets.sh [--env-file PATH] [--worker-name NAME] [--wrangler-env ENV] [--profile PROFILE]

If --env-file is omitted, the script reads from the current exported environment.
If --worker-name is omitted, the script syncs the worker named in wrangler.jsonc.
If --wrangler-env is omitted, the script targets Wrangler's top-level environment.
PROFILE can be:
  core        Core auth/control-plane/community-provisioning path
  happy-path  Core plus Privy, Very client id, HNS, and Spaces verification
  commerce    Happy path plus media/song/commerce runtime secrets

Examples:
  ./scripts/infisical/sync-wrangler-api-secrets.sh \
    --env-file pirate-api/services/api/.env.remote

  rtk infisical run --env staging --path /services/api -- \
    ./scripts/infisical/sync-wrangler-api-secrets.sh

  ./scripts/infisical/sync-wrangler-api-secrets.sh \
    --env-file pirate-api/services/api/.dev.vars \
    --worker-name pirate-api-staging \
    --wrangler-env staging
EOF
  exit 1
}

ENV_FILE=""
WORKER_NAME="pirate-api-core"
WRANGLER_ENV=""
PROFILE="happy-path"

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
    --wrangler-env)
      WRANGLER_ENV="${2:-}"
      shift 2
      ;;
    --profile)
      PROFILE="${2:-}"
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

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
API_DIR="$ROOT_DIR/pirate-api/services/api"
WRANGLER="$API_DIR/node_modules/.bin/wrangler"

case "$PROFILE" in
  core|happy-path|commerce)
    ;;
  *)
    echo "unknown profile: $PROFILE" >&2
    usage
    ;;
esac

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

core_required_names=(
  AUTH_UPSTREAM_JWT_SHARED_SECRET
  CONTROL_PLANE_DATABASE_URL
  COMMUNITY_PROVISION_OPERATOR_AUTH_TOKEN
  PIRATE_APP_JWT_PRIVATE_KEY
  PIRATE_APP_JWT_PUBLIC_KEY
  PRIVY_APP_SECRET
  TURSO_COMMUNITY_DB_WRAP_KEY
)

happy_path_required_names=(
  HNS_VERIFIER_AUTH_TOKEN
  SPACES_VERIFIER_AUTH_TOKEN
  VERY_APP_ID
)

commerce_required_names=(
  ACRCLOUD_ACCESS_KEY
  ACRCLOUD_ACCESS_SECRET
  ACRCLOUD_PERSONAL_ACCESS_TOKEN
  ELEVENLABS_API_KEY
  FILEBASE_S3_ACCESS_KEY
  FILEBASE_S3_SECRET_KEY
  MUSIC_PURCHASE_STORY_SETTLEMENT_PRIVATE_KEY
  OPENROUTER_API_KEY
  PIRATE_CHECKOUT_OPERATOR_PRIVATE_KEY
  PIRATE_CHECKOUT_RPC_URL
  PIRATE_CHECKOUT_SOURCE_CHAIN_ID
  PIRATE_CHECKOUT_USDC_TOKEN_ADDRESS
  STORY_RUNTIME_PRIVATE_KEY
)

optional_names=(
  BASE_MAINNET_RPC_URL
  BASE_SEPOLIA_RPC_URL
  CONTROL_PLANE_AUTH_TOKEN
  ENDAOMENT_CHAIN_ID
  ENDAOMENT_PAYOUT_PRIVATE_KEY
  ENDAOMENT_REGISTRY_ADDRESS
  ENDAOMENT_RPC_URL
  ENDAOMENT_TX_WAIT_TIMEOUT_MS
  ENDAOMENT_USDC_TOKEN_ADDRESS
  HNS_VERIFIER_AUTH_TOKEN
  HNS_VERIFIER_BASE_URL
  PIRATE_CHECKOUT_OPERATOR_ADDRESS
  PIRATE_CHECKOUT_TX_WAIT_TIMEOUT_MS
  PRIVY_JWT_VERIFICATION_KEY
  REGISTRY_PUBLISHER_AUTH_TOKEN
  SPACES_VERIFIER_BASE_URL
  SPACES_VERIFIER_AUTH_TOKEN
  SPACES_VERIFIER_CHALLENGE_DOMAIN
  TURSO_CONTROL_PLANE_AUTH_TOKEN
  VERY_API_KEY
  VERY_API_URL
  VERY_CALLBACK_SHARED_SECRET
  VERY_SESSIONS_URL
  VERY_VERIFY_URL
)

required_names=("${core_required_names[@]}")
if [[ "$PROFILE" == "happy-path" || "$PROFILE" == "commerce" ]]; then
  required_names+=("${happy_path_required_names[@]}")
fi
if [[ "$PROFILE" == "commerce" ]]; then
  required_names+=("${commerce_required_names[@]}")
fi

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
    "$WRANGLER" secret put "$name" --name "$WORKER_NAME" --env "$WRANGLER_ENV" >/dev/null
  )
}

echo "syncing API worker secrets to Cloudflare worker: $WORKER_NAME" >&2
echo "profile: $PROFILE" >&2

for name in "${required_names[@]}"; do
  put_secret "$name"
done

for name in "${optional_names[@]}"; do
  put_secret "$name"
done

cat <<EOF
wrangler API secret sync complete
worker_name: $WORKER_NAME
wrangler_env: ${WRANGLER_ENV:-<top-level>}
profile: $PROFILE
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
- STORY_RPC_URL
- STORY_RPC_FALLBACK_URLS
- STORY_RUNTIME_SIGNER_MIN_BALANCE_WEI
- STORY_RUNTIME_SIGNER_TARGET_BALANCE_WEI
- IPFS_GATEWAY_URL
- REGISTRY_PUBLISHER_URL
- REGISTRY_PUBLISHER_TIMEOUT_MS
- DEV_MEMORY_STORE_ENABLED
- ENVIRONMENT
EOF
