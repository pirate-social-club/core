#!/usr/bin/env bash

set -euo pipefail

rad_home=/var/lib/radicle
expected_node=z6MkeUhmbivWz5Uv87h9iT4tQk7xusZabMHCrjTKEGaCTUx4
expected_rids=(
  rad:z3qZx2qJDkjxfjBSPwRva4DutYJTh
  rad:z2g5M6jqfcwzJobizqRbNCakDsdpU
  rad:zWrB9TTk3sZ5SfSPv5Z8gbq5sbvb
  rad:z26RNpiPMzH8nyaca12meKeT2HMBy
  rad:zK3mrwKm8bG7w9iiRuZAAX9eQyWw
)

run_rad() {
  sudo -u radicle env HOME="$rad_home" RAD_HOME="$rad_home" "$@"
}

test "$(systemctl is-active radicle-node.service)" = active
test "$(systemctl is-enabled radicle-node.service)" = enabled
test "$(systemctl is-active radicle-ci-broker.service)" = active
test "$(systemctl is-enabled radicle-ci-broker.service)" = enabled
test "$(systemctl is-active promotion-controller.service)" = active
test "$(systemctl is-enabled promotion-controller.service)" = enabled
test "$(systemctl is-active promotion-proof-exporter.timer)" = active
test "$(systemctl is-enabled promotion-proof-exporter.timer)" = enabled
test "$(systemctl is-active radicle-ci-proof-announcer.timer)" = active
test "$(systemctl is-enabled radicle-ci-proof-announcer.timer)" = enabled

actual_node="$(run_rad rad node status --only nid)"
test "$actual_node" = "$expected_node"

seed_output="$(run_rad rad seed)"
for rid in "${expected_rids[@]}"; do
  grep -Fq "$rid" <<<"$seed_output"
done

test "$(grep -Fc ' allow ' <<<"$seed_output")" -eq "${#expected_rids[@]}"

ss -lntH 'sport = :8776' | grep -Fq '0.0.0.0:8776'

# Do not invoke `cib config` against the live report directory here. Version
# 0.30.0 rewrites status.json as a side effect, destroying useful run status.
grep -Eq '^concurrent_adapters:[[:space:]]*1$' "$rad_home/ci/ci-broker.yaml"
grep -Eq '^max_run_time:[[:space:]]*30min$' "$rad_home/ci/ci-broker.yaml"

test -r /dev/kvm
test -w /dev/kvm
test -s "$rad_home/ambient/ambient.qcow2"
qemu-img check -q "$rad_home/ambient/ambient.qcow2"

controller_status="$(
  cd /
  sudo -u promotion \
    /usr/local/libexec/pirate-radicle/promotion-controller status
)"
grep -Fq '"mode":"advisory"' <<<"$controller_status"
grep -Fq '"authority":false' <<<"$controller_status"
test -d "$rad_home/ci/promotion-proofs"
test "$(stat -c '%U:%G:%a' "$rad_home/ci/promotion-proofs")" = radicle:promotion:750
test "$(stat -c '%U:%G:%a' "$rad_home/storage")" = radicle:radicle:700
if sudo -u promotion test -r "$rad_home/storage"; then
  echo 'promotion user can read Radicle storage' >&2
  exit 1
fi
grep -Fq '"log": "WARN"' "$rad_home/config.json"
test "$(systemd-analyze cat-config systemd/journald.conf \
  | awk -F= '/^SystemMaxUse=/ { value=$2 } END { print value }')" = 256M

# The proof backup is installed only after its dedicated age recipient and
# immutable remote exist. Once its root-only config exists, it becomes part of
# every host verification; a successful timer is not a substitute for the
# separate off-host restore drill.
if [[ -f /etc/pirate-radicle/proof-state-backup.env ]]; then
  /usr/local/libexec/pirate-radicle/verify-proof-state-backup
fi

echo "Radicle seed and isolated CI host verification passed."
