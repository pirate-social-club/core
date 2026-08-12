# HNS and Spaces State Backup

This role backs up the edge state that cannot be recreated from Git or by
resynchronizing a chain node:

- a consistent online snapshot of the primary PowerDNS SQLite database,
  including zone metadata and DNSSEC private keys
- Spaces wallet/protocol and `subsd` state under `/srv/pirate-spaces/data`
- gateway issuance/TLSA state under `/var/lib/pirate-hns`
- the static DANE certificate and private key lifecycle under
  `/etc/caddy/hns-dane`

The keyless `hsd` chain database and the secondary PowerDNS database are not
canonical backup inputs; both are reconstructible.

`/srv/pirate-hns` belongs exclusively to this backup role. Its `app` symlink
must not be reused by the HNS verifier, which deploys independently under
`/srv/pirate-hns-verifier`.

## Design

The script:

1. takes an online SQLite backup and runs `PRAGMA integrity_check`
2. briefly stops only currently-active Spaces units so their multi-file state
   is captured consistently
3. creates a compressed archive as root, preserving numeric ownership, ACLs,
   and extended attributes
4. encrypts it to an `age` public recipient whose private identity exists only
   as a passphrase-wrapped blob in human-only recovery escrow
5. uploads the uniquely named ciphertext and its SHA-256 sidecar through
   `rclone --immutable`
6. restarts every unit it stopped, including after failure

`--immutable` prevents accidental overwrites by the script. Actual retention
must also be enforced by the destination provider (for example, bucket-level
Backblaze B2 Object Lock). The production host must not possess credentials
that can shorten retention. The script deliberately contains no prune/delete
operation.

## Prerequisites

- GNU tar with zstd support
- `age`
- `rclone`
- `sqlite3`
- a provider bucket with immutable retention enabled and tested
- an rclone application credential scoped to this one bucket, with only the
  list/read/write capabilities needed for upload verification; exclude object
  deletion and bucket-retention mutation
- a dedicated human-only recovery organization with audit logs, hardware MFA,
  verified versioning, no machine identities, and no daily-operator membership
- a passphrase-wrapped age identity blob in that organization, with its
  wrapping passphrase held only in the separate human password manager

Generate and wrap the age identity in a disposable human-controlled environment,
not on the VPS or normal workstation:

```bash
age-keygen -o pirate-hns-recovery.agekey
age-keygen -y pirate-hns-recovery.agekey
age --passphrase --output pirate-hns-recovery.agekey.wrapped.age \
  pirate-hns-recovery.agekey
```

Upload only the wrapped ciphertext to
`recovery:/backup-age/NS1_BACKUP_AGE_IDENTITY_CURRENT_WRAPPED`; store its
wrapping passphrase only in the human password manager. Only the printed public
recipient belongs in the VPS environment file. Never copy either private form
to the edge. The full account, audit, rotation, and hard-stop policy is in
`../radicle-ci/recovery-escrow.md`.

## Install

```bash
install -d -o root -g root -m 0700 /var/lib/pirate-hns-backup
install -d -o root -g root -m 0750 /srv/pirate-hns/config
install -o root -g root -m 0600 \
  ops/vps/hns-state-backup/env/hns-state-backup.env.example \
  /srv/pirate-hns/config/hns-state-backup.env
install -o root -g root -m 0644 \
  ops/vps/hns-state-backup/systemd/pirate-hns-state-backup.service \
  /etc/systemd/system/pirate-hns-state-backup.service
install -o root -g root -m 0644 \
  ops/vps/hns-state-backup/systemd/pirate-hns-state-backup.timer \
  /etc/systemd/system/pirate-hns-state-backup.timer
install -o root -g root -m 0644 \
  ops/vps/hns-state-backup/systemd/pirate-hns-state-backup-alert@.service \
  /etc/systemd/system/pirate-hns-state-backup-alert@.service
systemctl daemon-reload

/srv/pirate-hns/current/bin/record-installed-files.sh \
  --deploy-root /srv/pirate-hns \
  /etc/systemd/system/pirate-hns-state-backup.service \
  /etc/systemd/system/pirate-hns-state-backup.timer \
  /etc/systemd/system/pirate-hns-state-backup-alert@.service
```

Configure rclone and the environment file, then perform a manual run before
enabling the timer:

```bash
systemctl start pirate-hns-state-backup.service
systemctl status pirate-hns-state-backup.service
journalctl -u pirate-hns-state-backup.service --since today
systemctl enable --now pirate-hns-state-backup.timer
```

## Realign the app after the verifier cutover

The dedicated HNS verifier cutover does not modify this role's app symlink. If
the verifier previously repointed the shared `/srv/pirate-hns/app`, repair that
known drift before enabling the backup deployment-drift timer. Run this only
after the verifier is healthy under `/srv/pirate-hns-verifier` and while the
backup service is inactive:

```bash
(
set -euo pipefail

backup_root=/srv/pirate-hns
if sudo systemctl is-active --quiet pirate-hns-state-backup.service; then
  echo "backup service is active; wait for it to finish" >&2
  exit 1
fi

backup_app_commit="$(sudo sed -n 's/^APP_COMMIT=//p' \
  "$backup_root/current/DEPLOYMENT" | head -1)"
if [[ ! "$backup_app_commit" =~ ^[0-9a-f]{40}$ ]]; then
  echo "backup role does not declare a valid APP_COMMIT" >&2
  exit 1
fi

backup_app_release="$backup_root/app-releases/$backup_app_commit"
sudo grep -Fxq "APP_COMMIT=$backup_app_commit" \
  "$backup_app_release/.pirate-deployment/DEPLOYMENT" || {
  echo "declared backup app metadata does not match" >&2
  exit 1
}
sudo bash -c 'cd "$1" && sha256sum --check --quiet .pirate-deployment/SHA256SUMS' \
  _ "$backup_app_release" || {
  echo "declared backup app checksums failed" >&2
  exit 1
}

if sudo test -e "$backup_root/app.next" || sudo test -L "$backup_root/app.next"; then
  echo "$backup_root/app.next already exists; inspect it before continuing" >&2
  exit 1
fi
sudo ln -s "app-releases/$backup_app_commit" "$backup_root/app.next"
sudo mv -T "$backup_root/app.next" "$backup_root/app"

sudo "$backup_root/current/bin/deployment-status.sh" \
  --deploy-root "$backup_root" --verify
)
```

If the declared app is no longer the intended backup implementation, stop and
build a new matched role/app release instead of repointing ad hoc. Do not enable
`pirate-deployment-verify@backup.timer` until the final `--verify` reports no
drift.

Backup execution monitoring and deployment-drift monitoring are separate.
Also create `/etc/pirate-deployment-verify/backup.env` with
`DEPLOY_ROOT=/srv/pirate-hns` and the shared alert settings, run
`pirate-deployment-verify@backup.service` once, then enable
`pirate-deployment-verify@backup.timer`.

With `BACKUP_RETENTION_VERIFY=true` every run proves the provider applied
COMPLIANCE retention at least `BACKUP_MIN_RETENTION_DAYS` long to the objects
it just uploaded, and fails otherwise — catching a bucket whose default
retention was later removed or weakened. Additionally attempt to delete or
overwrite a test snapshot with the production application credential once
after install; that must fail.

Failed runs fire `pirate-hns-state-backup-alert@%n.service`, which posts to
`OPS_ALERT_WEBHOOK_URL` (the same webhook the API's ops-alerts sink uses).
For Pirate's authenticated edge-alert ingress, set
`OPS_ALERT_BEARER_TOKEN_FILE` to a root-owned mode-`0600` token file rather
than storing the bearer value directly in this env file.
Successful runs emit the `hns-state-backup` deployment heartbeat only after
both objects upload and pass provider-retention verification. The API's
36-hour heartbeat dead-man therefore detects a dead timer, a dead host, and
repeated backup failures; explicit failures still alert immediately through
the unit's `OnFailure` handler.

## Restore drill

Run this on an isolated recovery host at least quarterly and after any state
layout change:

1. download one archive and its SHA-256 sidecar
2. verify `sha256sum --check`
3. from a disposable isolated environment, have the human recovery operator
   retrieve only `NS1_BACKUP_AGE_IDENTITY_CURRENT_WRAPPED` into a mode-`0600`
   file, obtain the wrapping passphrase from the separate password manager,
   unwrap the identity, and decrypt:

   ```bash
   infisical secrets get NS1_BACKUP_AGE_IDENTITY_CURRENT_WRAPPED \
     --env recovery --path /backup-age --plain --expand=false \
     --include-imports=false > pirate-hns-recovery.agekey.wrapped.age
   age --decrypt --output pirate-hns-recovery.agekey \
     pirate-hns-recovery.agekey.wrapped.age
   age --decrypt --identity pirate-hns-recovery.agekey \
     --output hns-edge.tar.zst hns-edge-<host>-<timestamp>.tar.zst.age
   ```

4. list and extract into a disposable directory, never directly over a running
   production host
5. run `sqlite3 powerdns/pdns.sqlite3 'PRAGMA integrity_check;'`
6. start the pinned PowerDNS image against a copy of the restored database and
   prove DNSKEY, RRSIG, zone metadata, and expected DS output
7. start disposable Spaces services against copied data and prove wallet/state
   discovery without publishing or issuing anything
8. reset the Infisical session, remove the unwrapped identity, destroy the
   disposable environment, and verify the recovery audit log contains exactly
   the expected retrieval
9. record the snapshot name, elapsed restore time, and verification results

An uploaded object is not considered a backup until this drill succeeds.
