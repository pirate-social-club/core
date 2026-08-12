# Radicle CI VPS replacement

Use this procedure if VPS #3 is lost. The role code is tracked in both GitHub
and Radicle; the host is not the only copy of the implementation. The seed and
controller private keys are intentionally replaceable host identities, not
backup inputs.

`rebuild-artifacts.yaml` records public artifact provenance and the two
bootstrap source refs. Treat every `pending_before_enforcement` value as a
cutover blocker, but not as a blocker to rebuilding the current advisory host.

## What can be rebuilt

- systemd units, installers, configs, patches, tests, and drift verification
  come from the Core role;
- repository Git objects and Radicle collaborative objects can be fetched from
  the workstation or replicated seeds;
- the seed identity is regenerated and the preferred-seed NID is updated;
- the controller identity is regenerated. After enforcement, the human
  recovery delegate replaces its DID in repository identity documents; the
  old controller private key is never restored;
- dependency caches and HTML CI reports are disposable derived state.

Until encrypted proof-state backup and its off-host restore drill are live,
the controller queue, audit log, advisory events, and local HTML reports do not
survive total host loss. That is acceptable only while the controller remains
advisory. Never describe a replacement as a state restore unless an archive
was actually restored and verified.

## Select a reviewed role revision

1. Fetch the Core branch named in `rebuild-artifacts.yaml` from GitHub, or the
   named Radicle patch from any available seed.
2. Compare both systems when available. Stop on divergent tips; do not choose
   one silently.
3. Require a successful signed Radicle CI job for the exact selected commit.
   The recorded anchor is a known recovery floor, not a permanently pinned tip.
4. Run the focused role tests from the repository root. Do not run a broad
   workspace check on the operator workstation.

## Rebuild the host

1. Provision the reviewed Ubuntu base and restrict ingress to SSH and TCP 8776.
2. Apply the role's node, journald, slice, broker, adapter, controller, proof
   reconciler, and hourly drift-verification configuration in README order.
3. Generate a new seed transport identity. Record its public NID, update the
   tracked preferred-seed configuration, and seed only `config/repositories`.
4. Obtain the Ambient image from the manifest source or immutable archive.
   Decompress into a temporary path, verify both decompressed byte size and
   SHA-256, and only then install it as
   `/var/lib/radicle/ambient/ambient.qcow2`. A matching URL or filename is not
   sufficient because the upstream URL is mutable.
5. Obtain the exact Ambient crate/package inputs. Verify the recorded hashes,
   install the reviewed versions, and run `install-ambient-npm-retry`; its own
   source and patch hash checks must pass.
6. Render the broker config from `config/repositories`, synchronize every RID,
   and run `verify-host.sh` before enabling the broker.
7. Generate a replacement advisory controller identity. Do not add it as a
   delegate during host recovery unless the separate recovery/cutover procedure
   is being executed and every gate in `operations.md` passes.
8. Publish a disposable patch in each repository with a real CI plan and verify
   exact-commit signed proof replication to an off-host node.

## Backup boundary

Do not create `/etc/pirate-radicle/proof-state-backup.env` or enable
`radicle-proof-state-backup.timer` with placeholders. Configure it only with a
real age recipient, scoped immutable object-store credential, alert endpoint,
and retention policy. Run a manual backup and the VPS-independent restore drill
before enabling its timer.

The 10 GiB VM image and exact executor source archive should be copied to the
same immutable artifact store before enforcement. Their public checksums are
safe to keep in Git; credentials and private recovery material are not.
