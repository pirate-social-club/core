# Radicle seed and CI host

This role turns VPS #3 into the selective Radicle seed and isolated CI host.
The Radicle node and Ambient-backed CI broker are deployed independently.
The promotion controller remains deferred until its recovery delegate and
canonical-ref tests pass.

## Boundaries

- `radicle` owns `/var/lib/radicle` and the seed identity.
- `promotion` will own the delegate key and serialized promotion state.
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

## Initial repository set

```text
rad:z3qZx2qJDkjxfjBSPwRva4DutYJTh  pirate-web
rad:z2g5M6jqfcwzJobizqRbNCakDsdpU  pirate-api
rad:zWrB9TTk3sZ5SfSPv5Z8gbq5sbvb   pirate-contracts
rad:z26RNpiPMzH8nyaca12meKeT2HMBy  freedom-browser
```

Core is added after it is initialized under the reviewed delegate model.

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
5. Install the two slices and `radicle-node.service` under
   `/etc/systemd/system`, then reload systemd.
6. Open TCP 8776 in UFW and the provider firewall.
7. Start the node and explicitly seed the reviewed RIDs.
8. Verify direct connectivity and repository replication before installing CI.
9. Install Ambient, `radicle-ci-broker`, and `radicle-ci-ambient`; add the
   `radicle` account to the `kvm` group.
10. Install `config/ambient.yaml` under
    `/var/lib/radicle/.config/ambient/config.yaml` and the two broker configs
    under `/var/lib/radicle/ci`.
11. Download the reviewed Ambient VM image to
    `/var/lib/radicle/ambient/ambient.qcow2` and record its SHA-256.
12. Install and enable `radicle-ci-broker.service` only after `cib config`
    accepts the broker configuration.

Do not install `radicle-httpd` or expose an HTTP API during this phase.
Build code runs only in ephemeral Ambient VMs. The plan VM has no network;
dependency download happens through Ambient's constrained pre-plan actions.

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
```

From another node, connect to the address printed by:

```bash
sudo -u radicle env RAD_HOME=/var/lib/radicle rad node config --addresses
```

Then fetch each RID and confirm the expected signed namespaces are present.
