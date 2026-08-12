#!/usr/bin/env bash
set -euo pipefail

[[ $(id -u) -eq 0 ]] || { echo 'run as root' >&2; exit 1; }
source_dir=${1:?usage: install-promotion-controller.sh <tracked-role-directory>}

if ! getent passwd promotion >/dev/null; then
  useradd --system --home-dir /var/lib/promotion --create-home --shell /usr/sbin/nologin promotion
fi
install -d -o promotion -g promotion -m 0700 /var/lib/promotion
# The controller can traverse only to the minimal exported-proof directory.
# It has no ACL on repository storage or the seed key/config directories.
setfacl -m u:promotion:--x /var/lib/radicle
setfacl -m u:promotion:--x /var/lib/radicle/ci
install -d -o radicle -g promotion -m 0750 /var/lib/radicle/ci/promotion-proofs
# Remove ACLs used by the superseded direct-storage prototype, if present.
setfacl -R -x u:promotion /var/lib/radicle/storage 2>/dev/null || true
find /var/lib/radicle/storage -type d -exec setfacl -x d:u:promotion {} + \
  2>/dev/null || true
install -d -o root -g root -m 0755 /etc/pirate-radicle /usr/local/libexec/pirate-radicle
install -o root -g root -m 0644 "$source_dir/config/repositories" \
  /etc/pirate-radicle/repositories
install -o root -g root -m 0755 "$source_dir/scripts/repository-allowlist.sh" \
  /usr/local/libexec/pirate-radicle/repository-allowlist.sh
install -o root -g root -m 0755 "$source_dir/scripts/render-ci-broker-config" \
  /usr/local/libexec/pirate-radicle/render-ci-broker-config
install -o root -g root -m 0755 "$source_dir/scripts/install-ambient-npm-retry" \
  /usr/local/libexec/pirate-radicle/install-ambient-npm-retry
/usr/local/libexec/pirate-radicle/install-ambient-npm-retry "$source_dir"
install -d -o radicle -g radicle -m 0700 /var/lib/radicle/.config/ambient
install -o radicle -g radicle -m 0600 "$source_dir/config/ambient.yaml" \
  /var/lib/radicle/.config/ambient/config.yaml
install -o radicle -g radicle -m 0600 "$source_dir/config/ci-broker.yaml.template" \
  /var/lib/radicle/ci/ci-broker.yaml.template
install -o root -g root -m 0755 "$source_dir/scripts/promotion-controller" \
  /usr/local/libexec/pirate-radicle/promotion-controller
install -o root -g root -m 0755 "$source_dir/scripts/initialize-promotion-identity.sh" \
  /usr/local/libexec/pirate-radicle/initialize-promotion-identity.sh
install -o root -g root -m 0755 "$source_dir/scripts/promotion-proof-exporter" \
  /usr/local/libexec/pirate-radicle/promotion-proof-exporter
install -o root -g root -m 0755 "$source_dir/scripts/announce-ci-proofs" \
  /usr/local/libexec/pirate-radicle/announce-ci-proofs
install -o root -g root -m 0644 "$source_dir/config/promotion-controller.env" \
  /etc/pirate-radicle/promotion-controller.env
install -o root -g root -m 0644 "$source_dir/systemd/promotion-controller.service" \
  /etc/systemd/system/promotion-controller.service
install -o root -g root -m 0644 "$source_dir/systemd/promotion-proof-exporter.service" \
  /etc/systemd/system/promotion-proof-exporter.service
install -o root -g root -m 0644 "$source_dir/systemd/promotion-proof-exporter.timer" \
  /etc/systemd/system/promotion-proof-exporter.timer
install -o root -g root -m 0644 "$source_dir/systemd/radicle-ci-proof-announcer.service" \
  /etc/systemd/system/radicle-ci-proof-announcer.service
install -o root -g root -m 0644 "$source_dir/systemd/radicle-ci-proof-announcer.timer" \
  /etc/systemd/system/radicle-ci-proof-announcer.timer
install -o root -g root -m 0644 "$source_dir/tmpfiles/radicle-ci.conf" \
  /etc/tmpfiles.d/radicle-ci.conf
RADICLE_CI_REPOSITORIES_FILE=/etc/pirate-radicle/repositories \
  RADICLE_CI_ALLOWLIST_LIBRARY=/usr/local/libexec/pirate-radicle/repository-allowlist.sh \
  /usr/local/libexec/pirate-radicle/render-ci-broker-config \
  /var/lib/radicle/ci/ci-broker.yaml.template \
  /var/lib/radicle/ci/ci-broker.yaml
chown radicle:radicle /var/lib/radicle/ci/ci-broker.yaml
systemd-tmpfiles --create /etc/tmpfiles.d/radicle-ci.conf
systemctl daemon-reload
/usr/local/libexec/pirate-radicle/initialize-promotion-identity.sh
systemctl enable --now promotion-proof-exporter.timer
systemctl start promotion-proof-exporter.service
systemctl enable --now radicle-ci-proof-announcer.timer
systemctl start radicle-ci-proof-announcer.service
systemctl restart radicle-ci-broker.service
systemctl enable promotion-controller.service
systemctl restart promotion-controller.service
