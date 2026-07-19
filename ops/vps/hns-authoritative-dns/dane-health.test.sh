#!/usr/bin/env bash
set -euo pipefail

role_dir="$(cd "$(dirname "$0")" && pwd)"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
fail() { echo "FAIL: $1" >&2; exit 1; }
digest=5c8ddd3dbf63dbab698c726708b06177adda4a21416c675197f97e3b27ab20d8

cat > "$work/probe" <<EOF
#!/usr/bin/env bash
printf '%s\n' '$digest'
EOF
cat > "$work/dig" <<EOF
#!/usr/bin/env bash
if [[ "\${DIG_MODE:-healthy}" == mismatch ]]; then
  printf '%s\n' '_443._tcp.app.pirate. 300 IN TLSA 3 1 1 aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
elif [[ "\${DIG_MODE:-healthy}" == missing ]]; then
  exit 0
else
  printf '%s\n' '_443._tcp.app.pirate. 300 IN TLSA 3 1 1 $digest'
fi
EOF
chmod +x "$work/probe" "$work/dig"

common=(
  HNS_DANE_PROBE_ADDRESS=192.0.2.1
  HNS_DANE_PROBE_HOST=app.pirate
  HNS_DANE_SERVERS=192.0.2.53
  HNS_DANE_TLSA_OWNERS=_443._tcp.app.pirate.
  HNS_DANE_SPKI_PROBE_BIN="$work/probe"
  HNS_DANE_DIG_BIN="$work/dig"
)

env "${common[@]}" bash "$role_dir/bin/check-dane-spki.sh" >/dev/null \
  || fail "matching SPKI failed"
if env "${common[@]}" DIG_MODE=mismatch bash "$role_dir/bin/check-dane-spki.sh" >/dev/null 2>&1; then
  fail "mismatched SPKI passed"
fi
if env "${common[@]}" DIG_MODE=missing bash "$role_dir/bin/check-dane-spki.sh" >/dev/null 2>&1; then
  fail "missing TLSA passed"
fi

grep -Fq 'OnFailure=pirate-hns-dane-health-alert.service' \
  "$role_dir/systemd/pirate-hns-dane-health.service" || fail "health unit lacks alert hook"
grep -Fq 'OnUnitActiveSec=1h' "$role_dir/systemd/pirate-hns-dane-health.timer" \
  || fail "health timer is not hourly"
grep -Fq 'alert-on-failure.sh' "$role_dir/systemd/pirate-hns-dane-health-alert.service" \
  || fail "alert unit does not use authenticated alert path"

echo "DANE SPKI health checks passed"
