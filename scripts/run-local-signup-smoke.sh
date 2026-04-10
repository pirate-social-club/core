#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  ./scripts/run-local-signup-smoke.sh [options]

One-command local signup/onboarding smoke for the reference API slice.

What it does:
1. seeds one deterministic fixture user
2. runs the in-process Reddit onboarding smoke path

Important:
- no local API server is required
- this does not launch pirate-tui
- this is the fastest way to prove the auth/session exchange + onboarding path locally
- migrations are skipped by default so an existing dev DB does not fail on checksum drift

Options:
  --user-id ID               Default: usr_demo_01
  --subject SUB              Default: demo-subject-01
  --handle LABEL             Default: demo
  --namespace-label LABEL    Default: demo
  --reddit-username NAME     Default: technohippie
  --issuer ISS               Default: pirate-dev-upstream
  --with-migrations          Apply control-plane migrations before running
  -h, --help                 Show this help text
EOF
}

user_id="usr_demo_01"
subject="demo-subject-01"
handle="demo"
namespace_label="demo"
reddit_username="technohippie"
issuer="pirate-dev-upstream"
with_migrations="false"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --user-id)
      user_id="${2:-}"
      shift 2
      ;;
    --subject)
      subject="${2:-}"
      shift 2
      ;;
    --handle)
      handle="${2:-}"
      shift 2
      ;;
    --namespace-label)
      namespace_label="${2:-}"
      shift 2
      ;;
    --reddit-username)
      reddit_username="${2:-}"
      shift 2
      ;;
    --issuer)
      issuer="${2:-}"
      shift 2
      ;;
    --with-migrations)
      with_migrations="true"
      shift 1
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "unknown argument: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$script_dir/.." && pwd)"

if [[ "$with_migrations" == "true" ]]; then
  echo "== Applying control-plane migrations =="
  infisical run --env dev --path /services/control-plane -- \
    bun "$repo_root/scripts/apply-postgres-migrations.ts" \
      --database-url-env CONTROL_PLANE_MIGRATOR_DATABASE_URL \
      --migrations "$repo_root/db/control-plane/migrations" \
      --label control-plane
fi

echo "== Seeding fixture user =="
infisical run --env dev --path /services/api -- \
  bun "$repo_root/scripts/seed-control-plane-fixtures.ts" \
    --database-url-env CONTROL_PLANE_DATABASE_URL \
    --user-id "$user_id" \
    --issuer "$issuer" \
    --subject "$subject" \
    --handle "$handle" \
    --namespace-label "$namespace_label"

echo "== Running signup/onboarding smoke =="
infisical run --env dev --path /services/api -- \
  bun "$repo_root/scripts/reddit-onboarding-smoke.ts" \
    --subject "$subject" \
    --reddit-username "$reddit_username"
