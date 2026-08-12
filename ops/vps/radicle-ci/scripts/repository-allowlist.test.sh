#!/usr/bin/env bash
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
role="$(cd "$here/.." && pwd)"
tmp=$(mktemp -d)
trap 'rm -rf -- "$tmp"' EXIT

export RADICLE_CI_ALLOWLIST_LIBRARY="$here/repository-allowlist.sh"
export RADICLE_CI_REPOSITORIES_FILE="$role/config/repositories"

# The rendered broker configuration must contain exactly the canonical set.
"$here/render-ci-broker-config" "$role/config/ci-broker.yaml.template" \
  "$tmp/ci-broker.yaml"
mapfile -t expected < <(awk '!/^#/ && NF { print $1 }' \
  "$RADICLE_CI_REPOSITORIES_FILE" | sort)
mapfile -t actual < <(sed -nE \
  's/^[[:space:]]+- !Repository "([^"]+)"$/\1/p' \
  "$tmp/ci-broker.yaml" | sort)
[[ ${#expected[@]} -gt 0 && "${expected[*]}" == "${actual[*]}" ]]

# Every production consumer must load the shared allowlist. A future inline
# RID array would reintroduce the silent backup/reconciliation omission risk.
for consumer in announce-ci-proofs promotion-proof-exporter \
  promotion-controller backup-proof-state verify-host.sh; do
  grep -Fq 'repository-allowlist.sh' "$here/$consumer"
  if grep -Eq '^[[:space:]]+rad:z[1-9A-HJ-NP-Za-km-z]+' "$here/$consumer"; then
    echo "inline repository RID found in $consumer" >&2
    exit 1
  fi
done

# Invalid and duplicate entries fail closed before any consumer acts.
printf 'not-a-rid repo\n' > "$tmp/invalid"
if RADICLE_CI_REPOSITORIES_FILE="$tmp/invalid" \
  "$here/render-ci-broker-config" "$role/config/ci-broker.yaml.template" \
  "$tmp/invalid.yaml" 2>/dev/null; then
  echo 'invalid allowlist unexpectedly rendered' >&2
  exit 1
fi
printf '%s\n%s\n' "${expected[0]} repo-one" "${expected[0]} repo-two" \
  > "$tmp/duplicate"
if RADICLE_CI_REPOSITORIES_FILE="$tmp/duplicate" \
  "$here/render-ci-broker-config" "$role/config/ci-broker.yaml.template" \
  "$tmp/duplicate.yaml" 2>/dev/null; then
  echo 'duplicate allowlist unexpectedly rendered' >&2
  exit 1
fi

# The proof-backup alert resolves its tracked shared library from any cwd.
if "$here/proof-state-backup-alert" test.service \
  > "$tmp/alert.stdout" 2> "$tmp/alert.stderr"; then
  echo 'unconfigured alert unexpectedly succeeded' >&2
  exit 1
fi
grep -Fq 'OPS_ALERT_WEBHOOK_URL is not configured' "$tmp/alert.stderr"

echo 'repository allowlist tests passed'
