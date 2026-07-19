#!/usr/bin/env bash
set -euo pipefail

role_dir="$(cd "$(dirname "$0")" && pwd)"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

fail() { echo "FAIL: $1" >&2; exit 1; }

cat > "$work/dig" <<'EOF'
#!/usr/bin/env bash
if [[ "${DIG_MODE:-healthy}" == "missing" ]]; then
  printf 'app.pirate. 300 IN A 94.103.168.161\n'
elif [[ "${DIG_MODE:-healthy}" == "expiring" ]]; then
  printf 'app.pirate. 300 IN RRSIG A 13 2 300 20260720000000 20260701000000 12345 pirate. signature\n'
else
  printf 'app.pirate. 300 IN RRSIG A 13 2 300 20260820000000 20260701000000 12345 pirate. signature\n'
fi
EOF
chmod +x "$work/dig"

common=(
  HNS_RRSIG_SERVERS=192.0.2.1
  HNS_RRSIG_CHECKS=app.pirate.:A
  HNS_RRSIG_MIN_REMAINING_SECONDS=604800
  HNS_RRSIG_NOW_EPOCH=1784419200
  HNS_RRSIG_DIG_BIN="$work/dig"
)

env "${common[@]}" bash "$role_dir/bin/check-rrsig-expiry.sh" >/dev/null \
  || fail "healthy signature failed"
if env "${common[@]}" DIG_MODE=missing bash "$role_dir/bin/check-rrsig-expiry.sh" >/dev/null 2>&1; then
  fail "missing RRSIG passed"
fi
if env "${common[@]}" DIG_MODE=expiring bash "$role_dir/bin/check-rrsig-expiry.sh" >/dev/null 2>&1; then
  fail "expiring RRSIG passed"
fi

grep -Fq 'OnFailure=pirate-hns-rrsig-health-alert.service' \
  "$role_dir/systemd/pirate-hns-rrsig-health.service" || fail "health unit lacks alert hook"
grep -Fq 'Environment=DEPLOY_ROOT=/srv/pirate-hns-authdns' \
  "$role_dir/systemd/pirate-hns-rrsig-health.service" || fail "health unit lacks deploy root"
grep -Fq 'OnUnitActiveSec=1h' "$role_dir/systemd/pirate-hns-rrsig-health.timer" \
  || fail "health timer is not hourly"
grep -Fq 'alert-on-failure.sh' "$role_dir/systemd/pirate-hns-rrsig-health-alert.service" \
  || fail "alert unit does not use authenticated alert path"

echo "RRSIG health checks passed"
