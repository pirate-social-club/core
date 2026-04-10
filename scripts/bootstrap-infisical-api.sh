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

set_secret() {
  local path="$1"
  local assignment="$2"
  rtk infisical secrets set --env "$INFISICAL_ENV" --path "$path" "$assignment" >/dev/null
}

echo "bootstrapping pirate-v2 API secrets in Infisical env: $INFISICAL_ENV" >&2

if [[ -z "${OPENROUTER_API_KEY:-}" && -z "${JINA_API_KEY:-}" && -z "${PREDICT_FUN_API_KEY:-}" && -z "${FIRECRAWL_API_KEY:-}" ]]; then
  echo "no API secrets provided; set OPENROUTER_API_KEY and/or JINA_API_KEY and/or PREDICT_FUN_API_KEY and/or FIRECRAWL_API_KEY" >&2
  exit 1
fi

ensure_folder "/" "services"
ensure_folder "/services" "api"

if [[ -n "${OPENROUTER_API_KEY:-}" ]]; then
  set_secret "/services/api" "OPENROUTER_API_KEY=$OPENROUTER_API_KEY"
fi

if [[ -n "${JINA_API_KEY:-}" ]]; then
  set_secret "/services/api" "JINA_API_KEY=$JINA_API_KEY"
fi

if [[ -n "${PREDICT_FUN_API_KEY:-}" ]]; then
  set_secret "/services/api" "PREDICT_FUN_API_KEY=$PREDICT_FUN_API_KEY"
fi

if [[ -n "${FIRECRAWL_API_KEY:-}" ]]; then
  set_secret "/services/api" "FIRECRAWL_API_KEY=$FIRECRAWL_API_KEY"
fi

cat <<EOF
infisical bootstrap complete
env: $INFISICAL_ENV
created/updated:
- /services/api: OPENROUTER_API_KEY when provided
- /services/api: JINA_API_KEY when provided
- /services/api: PREDICT_FUN_API_KEY when provided
- /services/api: FIRECRAWL_API_KEY when provided
EOF
