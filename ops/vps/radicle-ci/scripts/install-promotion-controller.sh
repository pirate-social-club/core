#!/usr/bin/env bash
set -euo pipefail

[[ $(id -u) -eq 0 ]] || { echo 'run as root' >&2; exit 1; }
source_dir=${1:?usage: install-promotion-controller.sh <tracked-role-directory>}

if ! getent passwd promotion >/dev/null; then
  useradd --system --home-dir /var/lib/promotion --create-home --shell /usr/sbin/nologin promotion
fi
install -d -o promotion -g promotion -m 0700 /var/lib/promotion
# The controller may inspect replicated Git objects, but it cannot traverse the
# sibling key/config directories. Default ACLs make future storage objects
# readable without granting write access.
setfacl -m u:promotion:--x /var/lib/radicle
setfacl -R -m u:promotion:r-X /var/lib/radicle/storage
find /var/lib/radicle/storage -type d -exec setfacl -m d:u:promotion:r-X {} +
install -d -o root -g root -m 0755 /etc/pirate-radicle /usr/local/libexec/pirate-radicle
install -o root -g root -m 0755 "$source_dir/scripts/promotion-controller" \
  /usr/local/libexec/pirate-radicle/promotion-controller
install -o root -g root -m 0755 "$source_dir/scripts/initialize-promotion-identity.sh" \
  /usr/local/libexec/pirate-radicle/initialize-promotion-identity.sh
install -o root -g root -m 0644 "$source_dir/config/promotion-controller.env" \
  /etc/pirate-radicle/promotion-controller.env
install -o root -g root -m 0644 "$source_dir/systemd/promotion-controller.service" \
  /etc/systemd/system/promotion-controller.service
systemctl daemon-reload
/usr/local/libexec/pirate-radicle/initialize-promotion-identity.sh
systemctl enable --now promotion-controller.service
