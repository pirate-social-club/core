#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat >&2 <<'EOF'
Usage:
  ./scripts/infisical/sync-wrangler-api-secrets.sh [--api-dir PATH] [--env-file PATH] [--worker-name NAME] [--wrangler-env ENV] [--profile PROFILE]

If --api-dir is omitted, the script uses API_DIR or the first available API checkout.
If --env-file is omitted, the script reads from the current exported environment.
If --worker-name is omitted, the script syncs the worker named in wrangler.jsonc.
If --wrangler-env is omitted, the script targets Wrangler's top-level environment.
PROFILE can be:
  core        Core auth/control-plane/community-provisioning path
  happy-path  Core plus Privy, Very client id, HNS, and Spaces verification
  commerce    Happy path plus media/song/commerce runtime secrets

Required and optional secret names come from scripts/lib/infisical-env-contract.ts.

Examples:
  ./scripts/infisical/sync-wrangler-api-secrets.sh \
    --api-dir ../pirate-workspace/api/services/api \
    --env-file ../pirate-workspace/api/services/api/.env.remote

  rtk infisical run --env staging --path /services/api -- \
    ./scripts/infisical/sync-wrangler-api-secrets.sh

  ./scripts/infisical/sync-wrangler-api-secrets.sh \
    --api-dir ../pirate-workspace/api/services/api \
    --env-file ../pirate-workspace/api/services/api/.dev.vars \
    --worker-name pirate-api-staging \
    --wrangler-env staging
EOF
  exit 1
}

ENV_FILE=""
API_DIR="${API_DIR:-}"
WORKER_NAME="pirate-api-core"
WRANGLER_ENV=""
PROFILE="happy-path"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --api-dir)
      API_DIR="${2:-}"
      shift 2
      ;;
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
if [[ -z "$API_DIR" ]]; then
  for candidate in "$ROOT_DIR/../pirate-workspace/api/services/api" "$ROOT_DIR/pirate-api/services/api"; do
    if [[ -d "$candidate" ]]; then
      API_DIR="$candidate"
      break
    fi
  done
elif [[ "$API_DIR" != /* ]]; then
  API_DIR="$ROOT_DIR/$API_DIR"
fi

if [[ -z "$API_DIR" || ! -d "$API_DIR" ]]; then
  echo "API checkout not found. Set API_DIR or pass --api-dir." >&2
  exit 1
fi

API_DIR="$(cd "$API_DIR" && pwd)"
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

mapfile -t required_names < <(rtk bun "$ROOT_DIR/scripts/infisical/print-wrangler-api-secret-names.ts" --profile "$PROFILE" --kind required)
mapfile -t optional_names < <(rtk bun "$ROOT_DIR/scripts/infisical/print-wrangler-api-secret-names.ts" --profile "$PROFILE" --kind optional)
mapfile -t managed_config_names < <(rtk bun "$ROOT_DIR/scripts/infisical/print-wrangler-api-secret-names.ts" --profile "$PROFILE" --kind managed-config)

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
$(printf '%s\n' "${managed_config_names[@]}" | sed 's/^/- /')
EOF
