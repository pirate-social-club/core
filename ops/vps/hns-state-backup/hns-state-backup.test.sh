#!/usr/bin/env bash
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
test_root="$(mktemp -d)"
trap 'rm -rf -- "$test_root"' EXIT

fake_bin="$test_root/bin"
remote_dir="$test_root/remote"
mkdir -p "$fake_bin" "$remote_dir" "$test_root/spaces/subsd" \
  "$test_root/runtime" "$test_root/dane"

printf 'spaces-state\n' > "$test_root/spaces/subsd/state"
printf 'runtime-state\n' > "$test_root/runtime/state"
printf 'certificate\n' > "$test_root/dane/cert.pem"
sqlite3 "$test_root/pdns.sqlite3" 'CREATE TABLE domains (id INTEGER PRIMARY KEY, name TEXT); INSERT INTO domains (name) VALUES ("pirate");'

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
output=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --recipient)
      shift 2
      ;;
    --output)
      output="$2"
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
[[ "$1" == "copyto" ]]
source_path="$2"
destination="$3"
printf 'rclone %s\n' "$(basename "$source_path")" >> "$TEST_EVENT_LOG"
cp "$source_path" "$TEST_REMOTE_DIR/$(basename "$destination")"
EOF

chmod +x "$fake_bin/systemctl" "$fake_bin/age" "$fake_bin/rclone"

export PATH="$fake_bin:$PATH"
export TEST_EVENT_LOG="$test_root/events"
export TEST_REMOTE_DIR="$remote_dir"
export BACKUP_RCLONE_REMOTE="test:hns"
export BACKUP_AGE_RECIPIENT="age1testrecipient"
export BACKUP_STAGING_ROOT="$test_root/staging"
export PDNS_SQLITE_DB="$test_root/pdns.sqlite3"
export SPACES_DATA_DIR="$test_root/spaces"
export HNS_RUNTIME_STATE_DIR="$test_root/runtime"
export HNS_DANE_CERT_DIR="$test_root/dane"
export BACKUP_QUIESCE_UNITS="subsd.service verifier.service spaced.service"
# This stub-based test has no real S3 endpoint; the integration harness
# (ops/vps/hns-local-test) covers BACKUP_RETENTION_VERIFY=true against MinIO.
export BACKUP_RETENTION_VERIFY=false

if ! "$here/hns-state-backup.sh" 2> "$test_root/stderr"; then
  cat "$test_root/stderr" >&2
  exit 1
fi
if ! grep -q "retention verification" "$test_root/stderr" && ! grep -q "BACKUP_RETENTION_VERIFY=false" "$test_root/stderr"; then
  echo "expected a loud warning when retention verification is disabled" >&2
  exit 1
fi

expected_events=$'stop subsd.service\nstop verifier.service\nstop spaced.service\nage\nstart spaced.service\nstart verifier.service\nstart subsd.service'
actual_before_upload="$(sed '/^rclone /d' "$TEST_EVENT_LOG")"
if [[ "$actual_before_upload" != "$expected_events" ]]; then
  echo "unexpected quiesce/restart order" >&2
  diff -u <(printf '%s\n' "$expected_events") <(printf '%s\n' "$actual_before_upload") || true
  exit 1
fi

archive="$(find "$remote_dir" -maxdepth 1 -name '*.tar.zst.age' -print -quit)"
checksum="$archive.sha256"
[[ -s "$archive" && -s "$checksum" ]]

(
  cd "$remote_dir"
  sha256sum --check "$(basename "$checksum")"
)

# A single captured listing avoids grep -q racing tar into SIGPIPE under
# pipefail.
archive_listing="$(tar --zstd --list --file "$archive")"
grep -Fxq 'powerdns/pdns.sqlite3' <<< "$archive_listing"
grep -Fq "${SPACES_DATA_DIR#/}/subsd/state" <<< "$archive_listing"
grep -Fq "${HNS_RUNTIME_STATE_DIR#/}/state" <<< "$archive_listing"
grep -Fq "${HNS_DANE_CERT_DIR#/}/cert.pem" <<< "$archive_listing"

if find "$BACKUP_STAGING_ROOT" -mindepth 1 -maxdepth 1 -type d | grep -q .; then
  echo "backup staging run directory was not cleaned" >&2
  exit 1
fi

echo "hns-state-backup test passed"
