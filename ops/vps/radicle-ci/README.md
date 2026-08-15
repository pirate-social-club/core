# Radicle seed and CI host

This role turns VPS #3 into the selective Radicle seed and isolated CI host.
The Radicle node and Ambient-backed CI broker are deployed independently.
The promotion controller is deployed in an explicitly non-authoritative
advisory overlap. Its DID is
`did:key:z6MkiHv3QB6tjLb3zK6wWzUBsZa51f3f1UhSVKnAGwczHnwg`; it is not yet a
repository delegate and the controller binary contains no canonical-push
path. Human-only recovery escrow and canonical-ref tests remain cutover
prerequisites. `recovery-escrow.md` defines the split-control Infisical model;
`proof-state-restore.md` defines the mandatory off-host restore drill before
enforcement. `authoritative-gates.md` records the initial self-contained Web
and API checks; those plans remain advisory until the recovery and mirror
cutover gates pass.

## Boundaries

- `radicle` owns `/var/lib/radicle` and the seed identity.
- `promotion` owns the future delegate key and serialized promotion state.
- `radicle` also launches the broker and Ambient guests, but systemd confines
  them to the separately capped `radicle-ci.slice`.
- The seed identity is a transport identity, not a repository delegate.
- CI must never mount or read the Radicle or promotion state directories.

The node and future controller run in `radicle-core.slice`. CI guests run in
`radicle-ci.slice`. The core slice retains priority under contention; CI is
hard-capped at three CPUs and 6 GiB RAM.

## Network

The host accepts only:

- TCP 22 for SSH
- TCP 8776 for the Radicle node

The provider firewall and UFW must agree. The node keeps
`seedingPolicy.default` set to `block`; repositories are allowed explicitly.
The public seed keeps dynamic peers for replication, but logs only at `WARN`.
Journald is capped at 256 MiB with fourteen-day maximum retention so connection
churn cannot consume the host disk.

## Initial repository set

`config/repositories` is the single tracked allowlist for the broker,
announcement reconciler, proof exporter, promotion controller, proof backup,
and host verifier. Change repository membership there, render the broker
configuration, and deploy every consumer together. README examples and test
fixtures are not authority lists.

## Install sequence

Reviewed bootstrap artifacts on 2026-08-11:

```text
radicle                 1.10.0-1
radicle-ci-broker       0.30.0
radicle-ci-ambient      0.21.1
ambient-ci              0.16.0-1
ambient.qcow2 sha256    e0e13e9e2d0225cbcb69a6f4f44d6136e9ca50a9a355295c07c90d173840b293
```

`rebuild-artifacts.yaml` records exact public download metadata, hashes,
sizes, and dual-system bootstrap refs. The Ambient image URL is mutable:
verify the decompressed image, not merely the URL or compressed filename.
Archive the reviewed image and executor crate immutably before enforcement.
See `vps-replacement.md` for a clean-host recovery sequence and the explicit
state that does not yet survive loss of VPS #3.

1. Install the signed Radicle package at the version reviewed for this role.
2. Create the system `radicle` user with `/var/lib/radicle` as its home.
3. Generate a passphrase-free seed identity as that user. Seed identities do
   not sign canonical repository state.
4. Install `config/config.json` as `/var/lib/radicle/config.json`, mode `0600`.
5. Install `journald/60-radicle-ci.conf` under
   `/etc/systemd/journald.conf.d`, restart journald, and verify the effective
   256 MiB cap with `systemd-analyze cat-config systemd/journald.conf`.
6. Install the two slices and `radicle-node.service` under
   `/etc/systemd/system`, then reload systemd.
7. Open TCP 8776 in UFW and the provider firewall.
8. Start the node and explicitly seed the reviewed RIDs.
9. Verify direct connectivity and repository replication before installing CI.
10. Install Ambient, `radicle-ci-broker`, and `radicle-ci-ambient`; add the
   `radicle` account to the `kvm` group.
11. Install `config/ambient.yaml` under
    `/var/lib/radicle/.config/ambient/config.yaml` and the two broker configs
    under `/var/lib/radicle/ci`. Generate `ci-broker.yaml` from the canonical
    `config/repositories` allowlist; do not hand-edit repository filters:

    ```bash
    install -o root -g root -m 0644 config/repositories \
      /etc/pirate-radicle/repositories
    RADICLE_CI_REPOSITORIES_FILE=/etc/pirate-radicle/repositories \
      scripts/render-ci-broker-config config/ci-broker.yaml.template \
      /var/lib/radicle/ci/ci-broker.yaml
    chown radicle:radicle /var/lib/radicle/ci/ci-broker.yaml
    ```
12. Download the reviewed Ambient VM image to
    `/var/lib/radicle/ambient/ambient.qcow2`; verify its decompressed byte size
    and SHA-256 against `rebuild-artifacts.yaml` before installation.
13. Install and enable `radicle-ci-broker.service` only after `cib config`
    accepts the broker configuration.
14. Install and enable `radicle-ci-host-verification.timer`. It runs the
    installed verifier hourly against the installed reviewed configuration;
    inspect any failed unit before accepting new CI evidence.

Do not install `radicle-httpd` or expose an HTTP API during this phase.
Build code runs only in ephemeral Ambient VMs. The plan VM has no network;
dependency download happens through Ambient's constrained pre-plan actions.

## Advisory promotion controller

Install the controller only after the seed and broker pass verification:

```bash
sudo ops/vps/radicle-ci/scripts/install-promotion-controller.sh \
  ops/vps/radicle-ci
```

The installer creates the host-local controller identity if absent and prints
only its public DID. Re-running it preserves the existing key. It never copies
or exports the controller private key.

Requests are keyed by `(RID, commit, attempt)`. Re-submitting the same tuple
and CI job is idempotent; associating a different job with the same tuple is a
hard error. The controller accepts proof only when:

- the RID is allowlisted and the commit exists in local Radicle storage;
- the CI job is under the configured producer namespace;
- the producer's signed-refs document names the exact job tip;
- the job requests the exact commit; and
- matching run/finished actions report `Succeeded`.

The controller cannot read Radicle storage. A root-owned exporter runs as the
`radicle` account, validates the producer's signed job refs, and writes only
minimal proof summaries to a `radicle:promotion` directory. This one-way
boundary prevents the controller from reading the seed key or arbitrary
repository storage while avoiding ACL breakage when Git creates mode-`0600`
packfiles.

Missing replicated state is `unknown` and receives a bounded retry. Invalid or
still-unknown proof fails closed. In advisory mode, a valid proof writes an
`advisory_validation` record with `authority:false`; it never advances a ref.

The advisory overlap expires for review on **2026-09-15**. The former
2026-08-25 review was extended because recovery escrow, immutable proof backup,
and their restore drills must land before the comparison window can close. Do
not describe the
pipeline as authoritative or remove the workstation delegate merely because
the controller service is green.

## Proof-state backup

`scripts/backup-proof-state` creates a complete Git bundle for each allowlisted
RID containing the CI producer's signed job refs, producer `sigrefs`, and the
canonical identity document. It briefly stops the controller while copying
advisory events, audit records, and queue state, then resumes it before archive
compression or upload. Seed, controller, recovery, and age private keys are
excluded; the systemd unit also makes the seed and controller key paths
inaccessible.

The archive is encrypted to a public age recipient, signed by a dedicated
backup-attestation key, uploaded immutably, and checked for provider COMPLIANCE
retention. The backup signer is not a Radicle delegate. Record its public-key
fingerprint in the secret-free recovery manifest.

`recovery-manifest.yaml` is the live, secret-free rollout record. Any
pre-cutover status, null ceremony field, or `PENDING_NOT_USABLE` placeholder is
a hard stop, not an optional value. Replace it only with evidence verified
during the human-only ceremony; never infer or fill it from this workstation.

## Ambient dependency retry

Ambient 0.16.0 does not retry `npm_get` or generic `http_get` downloads.
Install the tracked, exact-source-hash executor patch before promotion becomes
authoritative. The installer replaces the guest-plan executor selected by
`config/ambient.yaml`, not merely the host coordinator:

```bash
sudo ops/vps/radicle-ci/scripts/install-ambient-npm-retry \
  ops/vps/radicle-ci
sudo ops/vps/radicle-ci/scripts/verify-host.sh
```

The installer builds a candidate before replacing the PATH-preferred binary
and records the source, patch, and resulting binary hashes under
`/usr/local/share/pirate-radicle`. Host verification rejects a missing or
changed binary, patch, or manifest. The patch retries individual pre-plan
package and generic HTTP downloads and ignores non-HTTP lockfile entries such
as prepared local `file:` dependencies. Repositories must provision those
inputs separately and pin/checksum them before `npm ci --offline`.
Repository test failures are never retried automatically.

After the dedicated recovery organization, age recipient, scoped immutable
bucket credential, and alert endpoint exist:

```bash
sudo ops/vps/radicle-ci/scripts/install-proof-state-backup.sh \
  ops/vps/radicle-ci
sudo install -o root -g root -m 0600 <scoped-rclone-config> \
  /etc/pirate-radicle/proof-state-rclone.conf
sudo install -o root -g root -m 0600 \
  /etc/pirate-radicle/proof-state-backup.env.example \
  /etc/pirate-radicle/proof-state-backup.env
sudoedit /etc/pirate-radicle/proof-state-backup.env
sudo systemctl start radicle-proof-state-backup.service
sudo journalctl -u radicle-proof-state-backup.service --since today
```

Do not enable the timer until the manual upload passes provider-retention
verification and `proof-state-restore.md` succeeds without access to VPS #3.
The installer deliberately creates only `proof-state-backup.env.example`.
Presence of `proof-state-backup.env` means configuration is complete and makes
the timer and its last successful run mandatory in `verify-host.sh`; never
create the production file as an empty setup placeholder.
Then enable the daily timer:

```bash
sudo systemctl enable --now radicle-proof-state-backup.timer
```

## Verification

```bash
sudo -u radicle env RAD_HOME=/var/lib/radicle rad self --nid
sudo -u radicle env RAD_HOME=/var/lib/radicle rad node status
sudo -u radicle env RAD_HOME=/var/lib/radicle rad seed
sudo ss -lntp | grep ':8776'
systemctl is-active radicle-node.service
systemctl show radicle-node.service -p Slice -p MemoryCurrent -p TasksCurrent
sudo -u radicle env HOME=/var/lib/radicle RAD_HOME=/var/lib/radicle \
  /var/lib/radicle/.cargo/bin/cib \
  --config /var/lib/radicle/ci/ci-broker.yaml config
systemctl is-active radicle-ci-broker.service
systemctl is-active promotion-controller.service
sudo -u promotion /usr/local/libexec/pirate-radicle/promotion-controller status
```

From another node, connect to the address printed by:

```bash
sudo -u radicle env RAD_HOME=/var/lib/radicle rad node config --addresses
```

Then fetch each RID and confirm the expected signed namespaces are present.
