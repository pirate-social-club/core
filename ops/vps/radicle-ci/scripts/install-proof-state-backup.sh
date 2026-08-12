#!/usr/bin/env bash
set -euo pipefail

[[ $(id -u) -eq 0 ]] || { echo 'run as root' >&2; exit 1; }
source_dir=${1:?usage: install-proof-state-backup.sh <tracked-role-directory>}
shared_dir="$source_dir/../lib"

for command in age rclone ssh-keygen; do
  command -v "$command" >/dev/null 2>&1 \
    || { echo "required command not found: $command" >&2; exit 1; }
done

install -d -o root -g root -m 0700 /var/lib/radicle-proof-backup
install -d -o root -g root -m 0755 \
  /etc/pirate-radicle /usr/local/libexec/pirate-radicle
install -o root -g root -m 0644 "$source_dir/config/repositories" \
  /etc/pirate-radicle/repositories
install -o root -g root -m 0755 "$source_dir/scripts/repository-allowlist.sh" \
  /usr/local/libexec/pirate-radicle/repository-allowlist.sh
install -o root -g root -m 0755 "$source_dir/scripts/backup-proof-state" \
  /usr/local/libexec/pirate-radicle/backup-proof-state
install -o root -g root -m 0755 "$source_dir/scripts/proof-state-backup-alert" \
  /usr/local/libexec/pirate-radicle/proof-state-backup-alert
install -o root -g root -m 0755 "$source_dir/scripts/verify-proof-state-backup" \
  /usr/local/libexec/pirate-radicle/verify-proof-state-backup
install -o root -g root -m 0644 "$shared_dir/immutable-backup.sh" \
  /usr/local/libexec/pirate-radicle/immutable-backup.sh
install -o root -g root -m 0644 "$shared_dir/backup-alert.sh" \
  /usr/local/libexec/pirate-radicle/backup-alert.sh

if [[ ! -f /etc/pirate-radicle/proof-backup-signing-key ]]; then
  ssh-keygen -q -t ed25519 -N '' -C radicle-proof-backup \
    -f /etc/pirate-radicle/proof-backup-signing-key
fi
chown root:root /etc/pirate-radicle/proof-backup-signing-key{,.pub}
chmod 0600 /etc/pirate-radicle/proof-backup-signing-key
chmod 0644 /etc/pirate-radicle/proof-backup-signing-key.pub

if [[ ! -f /etc/pirate-radicle/proof-state-backup.env ]]; then
  install -o root -g root -m 0600 \
    "$source_dir/config/proof-state-backup.env.example" \
    /etc/pirate-radicle/proof-state-backup.env
fi
for unit in radicle-proof-state-backup.service \
  radicle-proof-state-backup.timer \
  radicle-proof-state-backup-alert@.service; do
  install -o root -g root -m 0644 "$source_dir/systemd/$unit" \
    "/etc/systemd/system/$unit"
done
systemctl daemon-reload

echo "proof backup signer: $(ssh-keygen -lf /etc/pirate-radicle/proof-backup-signing-key.pub -E sha256 | awk '{ print $2 }')"
echo 'configure /etc/pirate-radicle/proof-state-backup.env, run one manual backup and restore drill, then enable the timer'
