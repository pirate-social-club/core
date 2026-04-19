#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  ./scripts/community/bootstrap-infinity-existing-user.sh --database-url-env ENV_NAME --community-db PATH [options]

Seeds a deterministic existing-user fixture and bootstraps a local operational Infinity community.

Important:
- this creates an operational local-stub community
- expected resulting control-plane state:
  - provisioning_state = active

Options:
  --database-url-env ENV_NAME   Environment variable containing the control-plane DB URL. Required.
  --community-db PATH           Target local community database file path. Required.
  --user-id ID                  Default: usr_infinity_01
  --subject SUB                 Default: infinity-subject-01
  --handle LABEL                Default: infinitytester
  --namespace-label LABEL       Default: infinity
  --display-name NAME           Default: Infinity
  --community-id ID             Default: cmt_infinity_01
  --reddit-username NAME        Default: infinitypilot
  --issuer ISS                  Default: pirate-dev-upstream
  -h, --help                    Show this help text.
EOF
}

database_url_env=""
community_db=""
user_id="usr_infinity_01"
subject="infinity-subject-01"
handle="infinitytester"
namespace_label="infinity"
display_name="Infinity"
community_id="cmt_infinity_01"
reddit_username="infinitypilot"
issuer="pirate-dev-upstream"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --database-url-env)
      database_url_env="${2:-}"
      shift 2
      ;;
    --community-db)
      community_db="${2:-}"
      shift 2
      ;;
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
    --display-name)
      display_name="${2:-}"
      shift 2
      ;;
    --community-id)
      community_id="${2:-}"
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

if [[ -z "$database_url_env" || -z "$community_db" ]]; then
  usage >&2
  exit 1
fi

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$script_dir/.." && pwd)"
namespace_verification_id="nv_${namespace_label}_${user_id}"

echo "== Seeding existing user fixture =="
infisical run --env dev --path /services/api -- \
  bun "$repo_root/scripts/control-plane/seed-control-plane-fixtures.ts" \
    --database-url-env "$database_url_env" \
    --user-id "$user_id" \
    --subject "$subject" \
    --handle "$handle" \
    --namespace-label "$namespace_label" \
    --reddit-username "$reddit_username" \
    --issuer "$issuer"

echo "== Bootstrapping Infinity community fixture =="
infisical run --env dev --path /services/api -- \
  bun "$repo_root/scripts/community/bootstrap-community-slice.ts" \
    --database-url-env "$database_url_env" \
    --community-db "$community_db" \
    --community-id "$community_id" \
    --user-id "$user_id" \
    --display-name "$display_name" \
    --namespace-verification-id "$namespace_verification_id" \
    --membership-mode gated \
    --membership-unique-human-provider very \
    --namespace-label "$namespace_label"

cat <<EOF

Infinity fixture ready.
user_id: $user_id
community_id: $community_id
namespace_verification_id: $namespace_verification_id
community_db: $community_db

Expected control-plane posture:
- provisioning_state = active
EOF
