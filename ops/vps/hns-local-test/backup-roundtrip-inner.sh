#!/usr/bin/env bash
set -euo pipefail

rm -rf -- /test/work /test/restore /test/download
mkdir -p /test/bin /test/work/spaces/subsd /test/work/runtime /test/work/dane /test/download

printf 'spaces-wallet-state\n' > /test/work/spaces/wallet.dat
printf 'subsd-issuance-state\n' > /test/work/spaces/subsd/state
printf 'gateway-state\n' > /test/work/runtime/caddy-ask.sqlite
printf 'dane-certificate\n' > /test/work/dane/cert.pem

cat > /test/bin/systemctl <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
case "$1" in
  is-active)
    exit 0
    ;;
  stop|start)
    printf '%s %s\n' "$1" "$2" >> /test/systemctl-events
    ;;
  *)
    exit 2
    ;;
esac
EOF
chmod +x /test/bin/systemctl

age-keygen -o /test/recovery.agekey >/dev/null
age_recipient="$(age-keygen -y /test/recovery.agekey)"

cat > /test/rclone.conf <<'EOF'
[local]
type = s3
provider = Minio
access_key_id = localminio
secret_access_key = localminio-secret
endpoint = http://minio:9000
region = us-east-1
acl = private
EOF
chmod 0600 /test/rclone.conf

dig @primary crew. DNSKEY +short +tries=1 +time=2 | sort > /test/original-dnskey
if [[ ! -s /test/original-dnskey ]]; then
  echo "primary returned no DNSKEY before backup" >&2
  exit 1
fi

{
  echo 'trust-anchors {'
  while read -r flags protocol algorithm public_key; do
    printf '  crew. static-key %s %s %s "%s";\n' \
      "$flags" "$protocol" "$algorithm" "$public_key"
  done < /test/original-dnskey
  echo '};'
} > /test/crew.keys

export PATH="/test/bin:$PATH"
export BACKUP_RCLONE_REMOTE="local:hns-backups/snapshots"
export BACKUP_AGE_RECIPIENT="$age_recipient"
export RCLONE_CONFIG=/test/rclone.conf
export BACKUP_STAGING_ROOT=/test/staging
export PDNS_SQLITE_DB=/source/pdns/pdns.sqlite3
export SPACES_DATA_DIR=/test/work/spaces
export HNS_RUNTIME_STATE_DIR=/test/work/runtime
export HNS_DANE_CERT_DIR=/test/work/dane
export BACKUP_QUIESCE_UNITS="subsd.service verifier.service spaced.service"

# Exercise the production post-upload retention verification against MinIO,
# whose test bucket enforces a 1-day default COMPLIANCE lock.
export BACKUP_RETENTION_VERIFY=true
export BACKUP_S3_ENDPOINT=http://minio:9000
export BACKUP_S3_REGION=us-east-1
export BACKUP_S3_ACCESS_KEY_ID=localminio
export BACKUP_S3_SECRET_ACCESS_KEY=localminio-secret
export BACKUP_MIN_RETENTION_DAYS=1

rm -f /test/systemctl-events
/workspace/ops/vps/hns-state-backup/hns-state-backup.sh

expected_events=$'stop subsd.service\nstop verifier.service\nstop spaced.service\nstart spaced.service\nstart verifier.service\nstart subsd.service'
if [[ "$(cat /test/systemctl-events)" != "$expected_events" ]]; then
  echo "unexpected backup quiesce/restart order" >&2
  exit 1
fi

archive_name="$(rclone lsf local:hns-backups/snapshots --include '*.tar.zst.age' --files-only)"
if [[ -z "$archive_name" || "$archive_name" == *$'\n'* ]]; then
  echo "expected exactly one encrypted remote archive" >&2
  exit 1
fi
printf '%s\n' "snapshots/$archive_name" > /test/archive-object-name

rclone copyto "local:hns-backups/snapshots/$archive_name" "/test/download/$archive_name"
rclone copyto "local:hns-backups/snapshots/$archive_name.sha256" "/test/download/$archive_name.sha256"

(
  cd /test/download
  sha256sum --check "$archive_name.sha256"
  age --decrypt --identity /test/recovery.agekey \
    --output hns-edge.tar.zst "$archive_name"
)

mkdir -p /test/restore
tar --zstd --extract --file /test/download/hns-edge.tar.zst --directory /test/restore

if [[ "$(sqlite3 /test/restore/powerdns/pdns.sqlite3 'PRAGMA integrity_check;')" != "ok" ]]; then
  echo "restored PowerDNS database failed integrity_check" >&2
  exit 1
fi
if [[ "$(sqlite3 /test/restore/powerdns/pdns.sqlite3 'SELECT COUNT(*) FROM cryptokeys;')" -lt 1 ]]; then
  echo "restored PowerDNS database has no DNSSEC keys" >&2
  exit 1
fi
if [[ "$(sqlite3 /test/restore/powerdns/pdns.sqlite3 "SELECT COUNT(*) FROM domains WHERE name = 'crew';")" != "1" ]]; then
  echo "restored PowerDNS database is missing crew zone" >&2
  exit 1
fi

test -f /test/restore/test/work/spaces/wallet.dat
test -f /test/restore/test/work/spaces/subsd/state
test -f /test/restore/test/work/runtime/caddy-ask.sqlite
test -f /test/restore/test/work/dane/cert.pem

# The online SQLite snapshot is intentionally root-owned and mode 0600 inside
# the encrypted archive. A restore operator must hand it back to the image uid.
chown -R 953:953 /test/restore/powerdns

# Negative retention test: the bucket's real 1-day lock must be rejected as
# weaker than an inflated policy, and the run must fail. Upload to a separate
# prefix so the positive path's single-archive assertion stays valid.
if BACKUP_RCLONE_REMOTE="local:hns-backups/weak-policy" BACKUP_MIN_RETENTION_DAYS=999 \
  /workspace/ops/vps/hns-state-backup/hns-state-backup.sh >/test/weak-policy.out 2>&1; then
  echo "backup succeeded despite retention weaker than policy" >&2
  exit 1
fi
if ! grep -q "weaker than the 999-day policy" /test/weak-policy.out; then
  echo "weak-policy run failed for an unexpected reason:" >&2
  cat /test/weak-policy.out >&2
  exit 1
fi

# Alert delivery test: the OnFailure hook must POST an ops-alerts-shaped
# {"text": ...} body to the webhook.
python3 - <<'EOF' &
from http.server import BaseHTTPRequestHandler, HTTPServer
class Handler(BaseHTTPRequestHandler):
    def do_POST(self):
        body = self.rfile.read(int(self.headers.get("content-length", "0")))
        with open("/test/alert-body.json", "wb") as f:
            f.write(body)
        self.send_response(200)
        self.end_headers()
    def log_message(self, *args):
        pass
HTTPServer(("127.0.0.1", 8925), Handler).handle_request()
EOF
stub_pid=$!
sleep 1
OPS_ALERT_WEBHOOK_URL=http://127.0.0.1:8925/ \
  /workspace/ops/vps/hns-state-backup/alert-on-failure.sh pirate-hns-state-backup.service
wait "$stub_pid"
python3 - <<'EOF'
import json
body = json.load(open("/test/alert-body.json"))
assert "pirate-hns-state-backup.service" in body["text"], body
assert "FAILED" in body["text"], body
EOF

echo "real age + rclone backup/decrypt/restore round-trip passed (incl. retention policy + alert hook)"
