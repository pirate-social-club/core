#!/usr/bin/env bash

set -euo pipefail

rad_home=/var/lib/radicle
expected_node=z6MkeUhmbivWz5Uv87h9iT4tQk7xusZabMHCrjTKEGaCTUx4
expected_rids=(
  rad:z3qZx2qJDkjxfjBSPwRva4DutYJTh
  rad:z2g5M6jqfcwzJobizqRbNCakDsdpU
  rad:zWrB9TTk3sZ5SfSPv5Z8gbq5sbvb
  rad:z26RNpiPMzH8nyaca12meKeT2HMBy
)

run_rad() {
  sudo -u radicle env HOME="$rad_home" RAD_HOME="$rad_home" "$@"
}

test "$(systemctl is-active radicle-node.service)" = active
test "$(systemctl is-enabled radicle-node.service)" = enabled
test "$(systemctl is-active radicle-ci-broker.service)" = active
test "$(systemctl is-enabled radicle-ci-broker.service)" = enabled

actual_node="$(run_rad rad node status --only nid)"
test "$actual_node" = "$expected_node"

seed_output="$(run_rad rad seed)"
for rid in "${expected_rids[@]}"; do
  grep -Fq "$rid" <<<"$seed_output"
done

test "$(grep -Fc ' allow ' <<<"$seed_output")" -eq "${#expected_rids[@]}"

ss -lntH 'sport = :8776' | grep -Fq '0.0.0.0:8776'

broker_config="$(
  run_rad /var/lib/radicle/.cargo/bin/cib \
    --config "$rad_home/ci/ci-broker.yaml" config
)"
grep -Fq '"concurrent_adapters": 1' <<<"$broker_config"
grep -Fq '"max_run_time"' <<<"$broker_config"

test -r /dev/kvm
test -w /dev/kvm
test -s "$rad_home/ambient/ambient.qcow2"
qemu-img check -q "$rad_home/ambient/ambient.qcow2"

echo "Radicle seed and isolated CI host verification passed."
