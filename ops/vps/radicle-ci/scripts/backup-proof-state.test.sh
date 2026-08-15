#!/usr/bin/env bash
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
test_root=$(mktemp -d)
trap 'rm -rf -- "$test_root"' EXIT

fake_bin="$test_root/bin"
remote_dir="$test_root/remote"
rad_storage="$test_root/radicle/storage"
promotion_state="$test_root/promotion"
staging="$test_root/staging"
rid=rad:zK3mrwKm8bG7w9iiRuZAAX9eQyWw
rid_path=${rid#rad:}
producer=z6MkeUhmbivWz5Uv87h9iT4tQk7xusZabMHCrjTKEGaCTUx4
repo="$rad_storage/$rid_path"
job_id=1111111111111111111111111111111111111111

mkdir -p "$fake_bin" "$remote_dir" "$rad_storage" \
  "$promotion_state/queue"/{pending,processing,done,failed}
printf '{"event_type":"advisory_validation"}\n' \
  > "$promotion_state/advisory-events.ndjson"
printf '{"action":"validated"}\n' \
  > "$promotion_state/controller-audit.ndjson"
printf '{"request_id":"request-one"}\n' \
  > "$promotion_state/queue/done/request-one.json"
mkdir -p "$promotion_state/keys"
printf 'must-not-be-archived\n' > "$promotion_state/keys/radicle"

git init --bare -q "$repo"
job_blob=$(printf '{"Request":{"oid":"2222222222222222222222222222222222222222"}}\n' \
  | git --git-dir="$repo" hash-object -w --stdin)
job_tree=$(printf '100644 blob %s\t0\n' "$job_blob" \
  | git --git-dir="$repo" mktree)
job_tip=$(printf 'job request\n' \
  | env GIT_AUTHOR_NAME=ci-producer GIT_AUTHOR_EMAIL=ci-producer@localhost \
    GIT_COMMITTER_NAME=ci-producer GIT_COMMITTER_EMAIL=ci-producer@localhost \
    git --git-dir="$repo" commit-tree "$job_tree")
job_ref="refs/namespaces/$producer/refs/cobs/xyz.radworks.job/$job_id"
git --git-dir="$repo" update-ref "$job_ref" "$job_tip"

logical_job_ref="refs/cobs/xyz.radworks.job/$job_id"
sigrefs_blob=$(printf '%s %s\n' "$job_tip" "$logical_job_ref" \
  | git --git-dir="$repo" hash-object -w --stdin)
sigrefs_tree=$(printf '100644 blob %s\trefs\n' "$sigrefs_blob" \
  | git --git-dir="$repo" mktree)
sigrefs_tip=$(printf 'signed refs\n' \
  | env GIT_AUTHOR_NAME=ci-producer GIT_AUTHOR_EMAIL=ci-producer@localhost \
    GIT_COMMITTER_NAME=ci-producer GIT_COMMITTER_EMAIL=ci-producer@localhost \
    git --git-dir="$repo" commit-tree "$sigrefs_tree")
sigrefs_ref="refs/namespaces/$producer/refs/rad/sigrefs"
git --git-dir="$repo" update-ref "$sigrefs_ref" "$sigrefs_tip"
git --git-dir="$repo" update-ref refs/rad/id "$sigrefs_tip"

cat > "$fake_bin/systemctl" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
case "$1" in
  is-active)
    exit 0
    ;;
  stop|start)
    printf '%s %s\n' "$1" "$2" >> "$TEST_EVENT_LOG"
    ;;
  *)
    exit 2
    ;;
esac
EOF

cat > "$fake_bin/age" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
output=''
while (( $# > 0 )); do
  case "$1" in
    --recipient)
      shift 2
      ;;
    --output)
      output=$2
      shift 2
      ;;
    *)
      exit 2
      ;;
  esac
done
printf 'age\n' >> "$TEST_EVENT_LOG"
cp /dev/stdin "$output"
EOF

cat > "$fake_bin/rclone" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
[[ "$1" == copyto && "$4" == --immutable ]]
source_path=$2
destination=$3
printf 'rclone %s\n' "$(basename "$source_path")" >> "$TEST_EVENT_LOG"
cp "$source_path" "$TEST_REMOTE_DIR/$(basename "$destination")"
EOF
chmod +x "$fake_bin/systemctl" "$fake_bin/age" "$fake_bin/rclone"

signing_key="$test_root/proof-backup-signing-key"
ssh-keygen -q -t ed25519 -N '' -C proof-backup-test -f "$signing_key"
chmod 0600 "$signing_key"

export PATH="$fake_bin:$PATH"
export TEST_EVENT_LOG="$test_root/events"
export TEST_REMOTE_DIR="$remote_dir"
export IMMUTABLE_BACKUP_LIBRARY="$here/../../lib/immutable-backup.sh"
export RADICLE_CI_ALLOWLIST_LIBRARY="$here/repository-allowlist.sh"
export RADICLE_CI_REPOSITORIES_FILE="$test_root/repositories"
printf '%s pirate-core\n' "$rid" > "$RADICLE_CI_REPOSITORIES_FILE"
export BACKUP_RCLONE_REMOTE=test:proof-state
export BACKUP_AGE_RECIPIENT=age1testrecipient
export BACKUP_RETENTION_VERIFY=false
export CI_PRODUCER_NID="$producer"
export PROOF_BACKUP_STAGING_ROOT="$staging"
export RAD_STORAGE="$rad_storage"
export PROMOTION_STATE_DIR="$promotion_state"
export PROOF_BACKUP_SIGNING_KEY="$signing_key"
export PROOF_BACKUP_SIGNING_PUBLIC_KEY="$signing_key.pub"

if ! "$here/backup-proof-state" 2> "$test_root/stderr"; then
  cat "$test_root/stderr" >&2
  exit 1
fi
grep -Fq 'BACKUP_RETENTION_VERIFY=false' "$test_root/stderr"
mapfile -t archives < <(find "$remote_dir" -maxdepth 1 \
  -type f -name '*.tar.zst.age' -print)
[[ ${#archives[@]} -eq 1 ]]
archive=${archives[0]}
manifest="$archive.manifest.json"
signature="$manifest.sig"
public_key="$archive.manifest.pub"
checksum="$archive.sha256"
for artifact in "$archive" "$manifest" "$signature" "$public_key" "$checksum"; do
  [[ -s "$artifact" ]]
done
(
  cd "$remote_dir"
  sha256sum --check "$(basename "$checksum")"
)

allowed_signers="$test_root/allowed-signers"
printf 'proof-backup@pirate %s\n' "$(cat "$public_key")" > "$allowed_signers"
ssh-keygen -Y verify -f "$allowed_signers" -I proof-backup@pirate \
  -n pirate-radicle-proof-backup -s "$signature" < "$manifest"

restore="$test_root/restore"
mkdir "$restore"
tar --zstd --extract --file "$archive" -C "$restore"
(
  cd "$restore"
  sha256sum --check promotion-files.sha256
)
jq -e --arg rid "$rid" --arg producer "$producer" \
  '.producer_nid == $producer and .repositories[0].rid == $rid and
   .repositories[0].job_ref_count == 1 and
   .excluded == ["controller_private_key","seed_private_key","derived_proof_cache"]' \
  "$restore/payload-manifest.json" >/dev/null
[[ ! -e "$restore/promotion/keys" ]]
grep -Fq 'request-one' "$restore/promotion/queue/done/request-one.json"

restored_repo="$test_root/restored.git"
git clone --mirror -q "$restore/repositories/$rid_path.bundle" "$restored_repo"
git --git-dir="$restored_repo" fsck --full --no-dangling
[[ $(git --git-dir="$restored_repo" for-each-ref --format='%(refname)' | wc -l) -eq 3 ]]
[[ $(git --git-dir="$restored_repo" rev-parse "$job_ref") == "$job_tip" ]]
[[ $(git --git-dir="$restored_repo" rev-parse "$sigrefs_ref") == "$sigrefs_tip" ]]

expected_prefix=$'stop promotion-controller.service\nstart promotion-controller.service\nage'
actual_prefix=$(head -n 3 "$TEST_EVENT_LOG")
[[ "$actual_prefix" == "$expected_prefix" ]]
[[ $(grep -c '^rclone ' "$TEST_EVENT_LOG") -eq 5 ]]
if find "$staging" -mindepth 1 -maxdepth 1 -type d | grep -q .; then
  echo 'backup staging run directory was not cleaned' >&2
  exit 1
fi

# An unsigned local job ref must fail closed, restart the controller, and
# upload nothing.
unsigned_job=3333333333333333333333333333333333333333
git --git-dir="$repo" update-ref \
  "refs/namespaces/$producer/refs/cobs/xyz.radworks.job/$unsigned_job" "$job_tip"
: > "$TEST_EVENT_LOG"
second_remote="$test_root/remote-unsigned"
mkdir "$second_remote"
export TEST_REMOTE_DIR="$second_remote"
if "$here/backup-proof-state" > "$test_root/unsigned.stdout" \
  2> "$test_root/unsigned.stderr"; then
  echo 'backup unexpectedly accepted an unsigned producer job ref' >&2
  exit 1
fi
grep -Fq 'producer job ref is not signed at its local tip' \
  "$test_root/unsigned.stderr"
expected_failure_events=$'stop promotion-controller.service\nstart promotion-controller.service'
[[ $(cat "$TEST_EVENT_LOG") == "$expected_failure_events" ]]
[[ -z $(find "$second_remote" -mindepth 1 -maxdepth 1 -type f -print -quit) ]]

echo 'backup-proof-state test passed'
