# Radicle seed and CI host

This role turns VPS #3 into the selective Radicle seed and isolated CI host.
The Radicle node and Ambient-backed CI broker are deployed independently.
The promotion controller is deployed in an explicitly non-authoritative
advisory overlap. Its DID is
`did:key:z6MkiHv3QB6tjLb3zK6wWzUBsZa51f3f1UhSVKnAGwczHnwg`; it is not yet a
repository delegate and the controller binary contains no canonical-push
path. Offline recovery and canonical-ref tests remain cutover prerequisites.

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

```text
rad:z3qZx2qJDkjxfjBSPwRva4DutYJTh  pirate-web
rad:z2g5M6jqfcwzJobizqRbNCakDsdpU  pirate-api
rad:zWrB9TTk3sZ5SfSPv5Z8gbq5sbvb   pirate-contracts
rad:z26RNpiPMzH8nyaca12meKeT2HMBy  freedom-browser
rad:zK3mrwKm8bG7w9iiRuZAAX9eQyWw   pirate-core
```

## Install sequence

Reviewed bootstrap artifacts on 2026-08-11:

```text
radicle                 1.10.0-1
radicle-ci-broker       0.30.0
radicle-ci-ambient      0.21.1
ambient-ci              0.16.0-1
ambient.qcow2 sha256    e0e13e9e2d0225cbcb69a6f4f44d6136e9ca50a9a355295c07c90d173840b293
```

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
    under `/var/lib/radicle/ci`.
12. Download the reviewed Ambient VM image to
    `/var/lib/radicle/ambient/ambient.qcow2` and record its SHA-256.
13. Install and enable `radicle-ci-broker.service` only after `cib config`
    accepts the broker configuration.

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

The advisory overlap expires for review on **2026-08-25**. Do not describe the
pipeline as authoritative or remove the workstation delegate merely because
the controller service is green.

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
