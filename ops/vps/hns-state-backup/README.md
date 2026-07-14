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

## Design

The script:

1. takes an online SQLite backup and runs `PRAGMA integrity_check`
2. briefly stops only currently-active Spaces units so their multi-file state
   is captured consistently
3. creates a compressed archive as root, preserving numeric ownership, ACLs,
   and extended attributes
4. encrypts it to an `age` public recipient whose private identity is kept
   offline
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
- an offline `age` recovery identity, with at least two separately secured
  copies

Create the age identity on an offline operator machine, not on the VPS:

```bash
age-keygen -o pirate-hns-recovery.agekey
age-keygen -y pirate-hns-recovery.agekey
```

Only the printed public recipient belongs in the VPS environment file. Never
copy `pirate-hns-recovery.agekey` to the edge.

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
```

Configure rclone and the environment file, then perform a manual run before
enabling the timer:

```bash
systemctl start pirate-hns-state-backup.service
systemctl status pirate-hns-state-backup.service
journalctl -u pirate-hns-state-backup.service --since today
systemctl enable --now pirate-hns-state-backup.timer
```

With `BACKUP_RETENTION_VERIFY=true` every run proves the provider applied
COMPLIANCE retention at least `BACKUP_MIN_RETENTION_DAYS` long to the objects
it just uploaded, and fails otherwise — catching a bucket whose default
retention was later removed or weakened. Additionally attempt to delete or
overwrite a test snapshot with the production application credential once
after install; that must fail.

Failed runs fire `pirate-hns-state-backup-alert@%n.service`, which posts to
`OPS_ALERT_WEBHOOK_URL` (the same webhook the API's ops-alerts sink uses).
Note this only alerts on runs that *fail* — if the timer stops firing
entirely, nothing alerts. Pair it with external dead-man monitoring on the
newest object age in the backup bucket.

## Restore drill

Run this on an isolated recovery host at least quarterly and after any state
layout change:

1. download one archive and its SHA-256 sidecar
2. verify `sha256sum --check`
3. decrypt with the offline identity:

   ```bash
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
8. record the snapshot name, elapsed restore time, and verification results

An uploaded object is not considered a backup until this drill succeeds.
