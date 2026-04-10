#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$script_dir/.." && pwd)"

infisical run --env dev --path /services/api -- \
  bun "$repo_root/scripts/local-new-account-flow.ts" "$@"
