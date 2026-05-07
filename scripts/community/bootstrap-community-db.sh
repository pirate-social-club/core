#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  ./scripts/community/bootstrap-community-db.sh --db PATH --community-id ID --user-id ID --display-name NAME --namespace-verification-id ID [options]

Creates or updates a local community SQLite/libSQL database by applying the community template
schema and seeding the minimum bootstrap rows for the public-v0 community create stub.

Options:
  --db PATH                          Target community database file path. Required.
  --community-id ID                  Community ID. Required.
  --user-id ID                       Creator / owner user ID. Required.
  --display-name NAME                Community display name. Required.
  --namespace-verification-id ID     Accepted namespace verification ID. Required.
  --description TEXT                 Optional community description.
  --membership-mode MODE             Default: open
  --default-age-gate-policy POLICY   Default: none
  --membership-unique-human-provider P Optional. Seed a membership-scope unique-human gate restricted to this provider.
  --posting-unique-human-provider P  Optional. Seed a posting-scope unique-human gate restricted to this provider.
  --handle-policy-template TEMPLATE  Default: standard
  --handle-pricing-model MODEL       Optional.
  --namespace-label LABEL            Default: community ID lowercased
  -h, --help                         Show this help text.
EOF
}

sql_quote() {
  local value="$1"
  value="${value//\'/\'\'}"
  printf "'%s'" "$value"
}

db_path=""
community_id=""
user_id=""
display_name=""
namespace_verification_id=""
description=""
membership_mode="open"
default_age_gate_policy="none"
handle_policy_template="premium"
handle_pricing_model=""
namespace_label=""
membership_unique_human_provider=""
posting_unique_human_provider=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --db)
      db_path="${2:-}"
      shift 2
      ;;
    --community-id)
      community_id="${2:-}"
      shift 2
      ;;
    --user-id)
      user_id="${2:-}"
      shift 2
      ;;
    --display-name)
      display_name="${2:-}"
      shift 2
      ;;
    --namespace-verification-id)
      namespace_verification_id="${2:-}"
      shift 2
      ;;
    --description)
      description="${2:-}"
      shift 2
      ;;
    --membership-mode)
      membership_mode="${2:-}"
      shift 2
      ;;
    --default-age-gate-policy)
      default_age_gate_policy="${2:-}"
      shift 2
      ;;
    --membership-unique-human-provider)
      membership_unique_human_provider="${2:-}"
      shift 2
      ;;
    --posting-unique-human-provider)
      posting_unique_human_provider="${2:-}"
      shift 2
      ;;
    --handle-policy-template)
      handle_policy_template="${2:-}"
      shift 2
      ;;
    --handle-pricing-model)
      handle_pricing_model="${2:-}"
      shift 2
      ;;
    --namespace-label)
      namespace_label="${2:-}"
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

if [[ -z "$db_path" || -z "$community_id" || -z "$user_id" || -z "$display_name" || -z "$namespace_verification_id" ]]; then
  echo "--db, --community-id, --user-id, --display-name, and --namespace-verification-id are required" >&2
  usage >&2
  exit 1
fi

case "$membership_mode" in
  open|request|gated) ;;
  *)
    echo "invalid --membership-mode: $membership_mode" >&2
    exit 1
    ;;
esac

case "$default_age_gate_policy" in
  none|18_plus) ;;
  *)
    echo "invalid --default-age-gate-policy: $default_age_gate_policy" >&2
    exit 1
    ;;
esac

case "$handle_policy_template" in
  standard|premium|membership_gated|custom) ;;
  *)
    echo "invalid --handle-policy-template: $handle_policy_template" >&2
    exit 1
    ;;
esac

case "$membership_unique_human_provider" in
  ""|self|very) ;;
  *)
    echo "invalid --membership-unique-human-provider: $membership_unique_human_provider" >&2
    exit 1
    ;;
esac

case "$posting_unique_human_provider" in
  ""|self|very) ;;
  *)
    echo "invalid --posting-unique-human-provider: $posting_unique_human_provider" >&2
    exit 1
    ;;
esac

if [[ -z "$namespace_label" ]]; then
  namespace_label="$(printf '%s' "$community_id" | tr '[:upper:]' '[:lower:]')"
fi

now="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
community_status="active"
governance_mode="centralized"
artist_governance_state="fan_run"
donation_policy_mode="none"
donation_partner_status="unconfigured"
namespace_id="ns_${community_id}"
namespace_handle_policy_id="nhp_${community_id}"
membership_id="mbr_${community_id}_${user_id}"
role_assignment_id="role_${community_id}_${user_id}_owner"
membership_gate_rule_id="gate_${community_id}_membership_unique_human"
posting_gate_rule_id="gate_${community_id}_posting_unique_human"

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$script_dir/.." && pwd)"

bash "$repo_root/scripts/community/apply-sqlite-migrations.sh" \
  --db "$db_path" \
  --migrations "$repo_root/db/community-template/migrations" \
  --label community-template >/dev/null

description_sql="NULL"
if [[ -n "$description" ]]; then
  description_sql="$(sql_quote "$description")"
fi

pricing_model_sql="'flat_by_length'"
if [[ -n "$handle_pricing_model" ]]; then
  pricing_model_sql="$(sql_quote "$handle_pricing_model")"
fi

membership_gate_proof_requirements_sql="NULL"
if [[ -n "$membership_unique_human_provider" ]]; then
  membership_gate_proof_requirements_sql="$(sql_quote "[{\"proof_type\":\"unique_human\",\"accepted_providers\":[\"$membership_unique_human_provider\"]}]")"
fi

posting_gate_proof_requirements_sql="NULL"
posting_gate_config_sql="NULL"
if [[ -n "$posting_unique_human_provider" ]]; then
  posting_gate_proof_requirements_sql="$(sql_quote "[{\"proof_type\":\"unique_human\",\"accepted_providers\":[\"$posting_unique_human_provider\"]}]")"
  posting_gate_config_sql="$(sql_quote '{"post_types":["text"],"first_post_only":true}')"
fi

sqlite3 "$db_path" <<SQL
.bail on
BEGIN;

INSERT INTO communities (
    community_id,
    display_name,
    description,
    status,
    artist_identity_id,
    artist_governance_state,
    membership_mode,
    default_age_gate_policy,
    allow_anonymous_identity,
    anonymous_identity_scope,
    donation_partner_id,
    donation_policy_mode,
    donation_partner_status,
    governance_mode,
    settings_json,
    created_by_user_id,
    created_at,
    updated_at
) VALUES (
    $(sql_quote "$community_id"),
    $(sql_quote "$display_name"),
    $description_sql,
    $(sql_quote "$community_status"),
    NULL,
    $(sql_quote "$artist_governance_state"),
    $(sql_quote "$membership_mode"),
    $(sql_quote "$default_age_gate_policy"),
    0,
    NULL,
    NULL,
    $(sql_quote "$donation_policy_mode"),
    $(sql_quote "$donation_partner_status"),
    $(sql_quote "$governance_mode"),
    NULL,
    $(sql_quote "$user_id"),
    $(sql_quote "$now"),
    $(sql_quote "$now")
)
ON CONFLICT(community_id) DO UPDATE SET
    display_name = excluded.display_name,
    description = excluded.description,
    status = excluded.status,
    membership_mode = excluded.membership_mode,
    default_age_gate_policy = excluded.default_age_gate_policy,
    donation_policy_mode = excluded.donation_policy_mode,
    donation_partner_status = excluded.donation_partner_status,
    updated_at = excluded.updated_at;

INSERT INTO community_memberships (
    membership_id,
    community_id,
    user_id,
    status,
    joined_at,
    left_at,
    banned_at,
    created_at,
    updated_at
) VALUES (
    $(sql_quote "$membership_id"),
    $(sql_quote "$community_id"),
    $(sql_quote "$user_id"),
    'member',
    $(sql_quote "$now"),
    NULL,
    NULL,
    $(sql_quote "$now"),
    $(sql_quote "$now")
)
ON CONFLICT(membership_id) DO UPDATE SET
    status = excluded.status,
    joined_at = excluded.joined_at,
    left_at = excluded.left_at,
    banned_at = excluded.banned_at,
    updated_at = excluded.updated_at;

INSERT INTO community_roles (
    role_assignment_id,
    community_id,
    user_id,
    role,
    status,
    granted_by_user_id,
    granted_at,
    revoked_at,
    created_at,
    updated_at
) VALUES (
    $(sql_quote "$role_assignment_id"),
    $(sql_quote "$community_id"),
    $(sql_quote "$user_id"),
    'owner',
    'active',
    $(sql_quote "$user_id"),
    $(sql_quote "$now"),
    NULL,
    $(sql_quote "$now"),
    $(sql_quote "$now")
)
ON CONFLICT(role_assignment_id) DO UPDATE SET
    status = excluded.status,
    granted_at = excluded.granted_at,
    revoked_at = excluded.revoked_at,
    updated_at = excluded.updated_at;

INSERT INTO namespace_bindings (
    namespace_id,
    community_id,
    namespace_verification_id,
    display_label,
    normalized_label,
    resolver_label,
    route_family,
    status,
    created_at,
    updated_at
) VALUES (
    $(sql_quote "$namespace_id"),
    $(sql_quote "$community_id"),
    $(sql_quote "$namespace_verification_id"),
    $(sql_quote "$namespace_label"),
    $(sql_quote "$namespace_label"),
    NULL,
    NULL,
    'active',
    $(sql_quote "$now"),
    $(sql_quote "$now")
)
ON CONFLICT(namespace_id) DO UPDATE SET
    namespace_verification_id = excluded.namespace_verification_id,
    display_label = excluded.display_label,
    normalized_label = excluded.normalized_label,
    status = excluded.status,
    updated_at = excluded.updated_at;

INSERT INTO namespace_handle_policies (
    namespace_handle_policy_id,
    community_id,
    namespace_id,
    policy_template,
    pricing_model,
    membership_required_for_claim,
    claims_enabled,
    settings_json,
    created_at,
    updated_at
) VALUES (
    $(sql_quote "$namespace_handle_policy_id"),
    $(sql_quote "$community_id"),
    $(sql_quote "$namespace_id"),
    $(sql_quote "$handle_policy_template"),
    $pricing_model_sql,
    1,
    1,
    '{"flat_price_cents":500,"premium_price_cents":2500,"premium_max_length":4,"min_length":3,"max_length":32,"non_member_claims_enabled":false,"non_member_price_multiplier":5,"special_price_cents_by_label":{"crown":100000,"xn--2p8h":100000,"prince":50000,"xn--tq9h":50000,"princess":50000,"xn--6q8h":50000,"diamond":75000,"xn--tr8h":75000,"ring":50000,"xn--sr8h":50000,"xn--cs8h":50000,"xn--cz8h":25000}}',
    $(sql_quote "$now"),
    $(sql_quote "$now")
)
ON CONFLICT(namespace_handle_policy_id) DO UPDATE SET
    policy_template = excluded.policy_template,
    pricing_model = excluded.pricing_model,
    membership_required_for_claim = excluded.membership_required_for_claim,
    updated_at = excluded.updated_at;

DELETE FROM community_gate_rules
WHERE gate_rule_id = $(sql_quote "$membership_gate_rule_id")
  AND $(sql_quote "$membership_unique_human_provider") = '';

INSERT INTO community_gate_rules (
    gate_rule_id,
    community_id,
    scope,
    gate_family,
    gate_type,
    proof_requirements_json,
    chain_namespace,
    gate_config_json,
    status,
    created_at,
    updated_at
) SELECT
    $(sql_quote "$membership_gate_rule_id"),
    $(sql_quote "$community_id"),
    'membership',
    'identity_proof',
    'unique_human',
    $membership_gate_proof_requirements_sql,
    NULL,
    NULL,
    'active',
    $(sql_quote "$now"),
    $(sql_quote "$now")
WHERE $(sql_quote "$membership_unique_human_provider") <> ''
ON CONFLICT(gate_rule_id) DO UPDATE SET
    community_id = excluded.community_id,
    scope = excluded.scope,
    gate_family = excluded.gate_family,
    gate_type = excluded.gate_type,
    proof_requirements_json = excluded.proof_requirements_json,
    chain_namespace = excluded.chain_namespace,
    gate_config_json = excluded.gate_config_json,
    status = excluded.status,
    updated_at = excluded.updated_at;

DELETE FROM community_gate_rules
WHERE gate_rule_id = $(sql_quote "$posting_gate_rule_id")
  AND $(sql_quote "$posting_unique_human_provider") = '';

INSERT INTO community_gate_rules (
    gate_rule_id,
    community_id,
    scope,
    gate_family,
    gate_type,
    proof_requirements_json,
    chain_namespace,
    gate_config_json,
    status,
    created_at,
    updated_at
) SELECT
    $(sql_quote "$posting_gate_rule_id"),
    $(sql_quote "$community_id"),
    'posting',
    'identity_proof',
    'unique_human',
    $posting_gate_proof_requirements_sql,
    NULL,
    $posting_gate_config_sql,
    'active',
    $(sql_quote "$now"),
    $(sql_quote "$now")
WHERE $(sql_quote "$posting_unique_human_provider") <> ''
ON CONFLICT(gate_rule_id) DO UPDATE SET
    community_id = excluded.community_id,
    scope = excluded.scope,
    gate_family = excluded.gate_family,
    gate_type = excluded.gate_type,
    proof_requirements_json = excluded.proof_requirements_json,
    chain_namespace = excluded.chain_namespace,
    gate_config_json = excluded.gate_config_json,
    status = excluded.status,
    updated_at = excluded.updated_at;

COMMIT;
SQL

cat <<EOF
community bootstrap complete
db: $db_path
community_id: $community_id
created_by_user_id: $user_id
namespace_id: $namespace_id
namespace_verification_id: $namespace_verification_id
membership_mode: $membership_mode
handle_policy_template: $handle_policy_template
EOF
