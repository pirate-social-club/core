#!/usr/bin/env bash
set -euo pipefail

controller=${1:-./ops/vps/radicle-ci/scripts/promotion-controller}
exporter=${2:-./ops/vps/radicle-ci/scripts/promotion-proof-exporter}
tmp=$(mktemp -d)
trap 'rm -rf -- "$tmp"' EXIT

rid=rad:zK3mrwKm8bG7w9iiRuZAAX9eQyWw
repo="$tmp/storage/${rid#rad:}"
nid=z6MkeUhmbivWz5Uv87h9iT4tQk7xusZabMHCrjTKEGaCTUx4
job=1111111111111111111111111111111111111111
run=22222222-2222-4222-8222-222222222222

git init --bare -q "$repo"
export GIT_AUTHOR_NAME=controller_test
export GIT_AUTHOR_EMAIL=controller_test@invalid
export GIT_COMMITTER_NAME=controller_test
export GIT_COMMITTER_EMAIL=controller_test@invalid
commit=$(printf 'tree content\n' | git --git-dir="$repo" hash-object -w --stdin)
tree=$(printf '100644 blob %s\tfile\n' "$commit" | git --git-dir="$repo" mktree)
commit=$(git --git-dir="$repo" commit-tree "$tree" -m source)

operation_commit() {
  local payload=$1 parent=$2 message=$3 blob op_tree
  blob=$(printf '%s' "$payload" | git --git-dir="$repo" hash-object -w --stdin)
  op_tree=$(printf '100644 blob %s\t0\n' "$blob" | git --git-dir="$repo" mktree)
  git --git-dir="$repo" commit-tree "$op_tree" -p "$parent" -m "$message"
}

request=$(operation_commit "{\"Request\":{\"oid\":\"$commit\"}}" "$commit" Request)
started=$(operation_commit "{\"Run\":{\"log\":\"file:///report\",\"uuid\":\"$run\"}}" "$request" Run)
finished=$(operation_commit "{\"Finished\":{\"reason\":\"Succeeded\",\"uuid\":\"$run\"}}" "$started" Finished)
job_ref="refs/namespaces/$nid/refs/cobs/xyz.radworks.job/$job"
git --git-dir="$repo" update-ref "$job_ref" "$finished"
refs_blob=$(printf '%s refs/cobs/xyz.radworks.job/%s\n' "$finished" "$job" \
  | git --git-dir="$repo" hash-object -w --stdin)
sig_blob=$(printf 'test-signature\n' | git --git-dir="$repo" hash-object -w --stdin)
sig_tree=$(printf '100644 blob %s\trefs\n100644 blob %s\tsignature\n' "$refs_blob" "$sig_blob" \
  | git --git-dir="$repo" mktree)
sig_commit=$(git --git-dir="$repo" commit-tree "$sig_tree" -m 'Signed refs')
git --git-dir="$repo" update-ref "refs/namespaces/$nid/refs/rad/sigrefs" "$sig_commit"

export PROMOTION_CONFIG=/dev/null
export PROMOTION_MODE=advisory
export PROMOTION_STATE_DIR="$tmp/state"
export PROMOTION_PROOF_DIR="$tmp/proofs"
export RAD_STORAGE="$tmp/storage"
export CI_PRODUCER_NID="$nid"
export PROMOTION_UNKNOWN_RETRIES=1
export PROMOTION_UNKNOWN_DELAY_SECONDS=0
mkdir -p "$PROMOTION_PROOF_DIR"
$exporter

request_id=$($controller enqueue "$rid" "$commit" "$job" 1)
$controller process-one
jq -e --arg id "$request_id" \
  'select(.request_id == $id and .result == "eligible" and .authority == false)' \
  "$PROMOTION_STATE_DIR/advisory-events.ndjson" >/dev/null
test -f "$PROMOTION_STATE_DIR/queue/done/$request_id.json"
duplicate_id=$($controller enqueue "$rid" "$commit" "$job" 1)
test "$duplicate_id" = "$request_id"

bad_job=3333333333333333333333333333333333333333
bad_id=$($controller enqueue "$rid" "$commit" "$bad_job" 2)
if $controller process-one; then
  echo 'missing proof unexpectedly passed' >&2
  exit 1
fi
test -f "$PROMOTION_STATE_DIR/queue/failed/$bad_id.json"

echo 'promotion controller tests passed'
