# Radicle-primary operations

Radicle is the source of repository collaboration and CI events. GitHub remains
a downstream mirror and the temporary release fallback. Cloudflare Workflows
is not part of this phase.

## Authority

- The canonical repository state is the Radicle identity plus its canonical
  `main` reference.
- VPS #3 is the preferred seed and CI observer. It is not a delegate and cannot
  advance canonical `main`.
- GitHub `main` mirrors an already-promoted Radicle commit. Never promote a
  commit in GitHub first and then treat Radicle as authoritative afterward.
- CI jobs validate patches and canonical updates in ephemeral Ambient VMs.
  Deployment remains in the existing GitHub release workflow until workload
  identity and the promotion controller have been reviewed separately.
- `promotion-controller.service` is currently advisory. Its records explicitly
  carry `authority:false`; the workstation delegate can still bypass it.

## Workstation setup

Unlock the contributor/delegate key once per login session:

```bash
rad auth
rad node start
rad node connect \
  z6MkeUhmbivWz5Uv87h9iT4tQk7xusZabMHCrjTKEGaCTUx4@94.103.168.209:8776
```

The workstation node is intentionally a static, outbound-only client:

- the VPS is its only preferred seed and `node.connect` peer;
- `node.peers.type` is `static`;
- `node.listen` is empty, inbound connections are zero, and outbound is two;
- `node.workers` is two; and
- `node.log` is `WARN`.

Do not restore public bootstrap peers on the workstation. Dynamic peer churn
against unreachable IPv6 and stale local-name peers previously produced about
2.6 GiB of INFO logs and made the control socket unresponsive. The VPS remains
dynamic because it is the public replicating seed; its worker and connection
limits plus bounded journald protect that role.

Every checkout must retain both remotes:

```text
rad     rad://<RID>       primary collaboration remote
origin  https://github.com/pirate-social-club/<repo>.git  fallback mirror
```

Do not change `origin` to point at Radicle. Keeping distinct names makes the
authority boundary reviewable and prevents an ordinary `git push origin` from
silently becoming a canonical Radicle promotion.

### Bootstrap reconciliation record

On 2026-08-12, before authoritative promotion existed, Core's Radicle `main`
was fast-forwarded from `a9d878122c0906101abdb189159d4964cfa22097` to the
exact then-current GitHub `main` SHA
`b9e3cdfcd5ee2183064003cd73f0302b249be585`. The old Radicle tip was the direct
parent, so this was a one-commit fast-forward with no force or history loss.
The bootstrap CI patch was then rebased onto that reconciled tip. This is a
one-time authority bootstrap record, not permission to promote GitHub-first
commits after cutover.

## Parallel-agent push path

Agents publish work as Radicle patches, not competing writes to `main`:

```bash
git push rad HEAD:refs/patches
```

Updating the same patch uses the upstream configured by the first push. The CI
broker queues at most one active run per repository and one Ambient guest on
this host. New pushes remain visible as distinct patch revisions; they are not
silently treated as successful while queued.

The 4-vCPU host is intentionally a correctness/cost tier. Five to ten agents
may publish concurrently, but heavy jobs serialize. Add another CI host before
raising guest concurrency on this machine.

## Promotion and GitHub mirroring

After review and a successful Radicle CI result:

1. Merge the patch into the local `main` checkout.
2. Push `main` to `rad` and wait for synchronization with VPS #3.
3. Record the exact canonical SHA observed by VPS #3.
4. Push that exact SHA to GitHub without force.
5. Allow the existing GitHub release workflow to deploy it.

```bash
git push rad main
rad sync --seed \
  z6MkeUhmbivWz5Uv87h9iT4tQk7xusZabMHCrjTKEGaCTUx4@94.103.168.209:8776
sha="$(git rev-parse main)"
git push origin "$sha:refs/heads/main"
```

If the GitHub push is not a fast-forward, stop. Do not force it: determine why
the fallback mirror diverged and reconcile it from the Radicle canonical state.

## Host verification

Administer VPS #3 through the provider-created `ubuntu` principal:

```bash
ssh ubuntu@94.103.168.209
```

The currently authorized operator key is loaded from the workstation's
`~/.ssh/id_ed25519`; its public fingerprint is
`SHA256:EL/kXFJdrPSK/VOa8tBvR6SpF7JSBb//7FRcCPlXxLo`. The private key is
operator-managed and must never be committed, copied into this role, placed on
the VPS, or exposed to CI. The public fingerprint is the authority record; the
path is only the current client convention.

Rotate access without creating a lockout:

1. Generate or designate the replacement operator key outside the repository.
2. Add its public key to the provider account and
   `/home/ubuntu/.ssh/authorized_keys` without removing the current key.
3. Open a separate session using `IdentitiesOnly=yes` and the replacement key;
   verify `sudo -n true` and run the host verifier.
4. Remove the old public key from both locations, test the replacement again,
   and update the fingerprint above in the same reviewed patch.

Never rotate the SSH key and seed/controller identities together. SSH access,
the seed transport identity, and the promotion delegate are independent
authorities.

Run the tracked verifier on VPS #3 after upgrades or restarts:

```bash
sudo ops/vps/radicle-ci/scripts/verify-host.sh
```

`radicle-ci-host-verification.timer` also runs the installed verifier hourly
with up to five minutes of jitter. A failed run leaves the service failed and
records the violated invariant in journald. Check both timer and last service
result during operational review:

```bash
systemctl status radicle-ci-host-verification.timer --no-pager
systemctl status radicle-ci-host-verification.service --no-pager
```

CI reports are private operator artifacts under
`/var/lib/radicle/ci/reports`. No HTTP report service or additional public port
is required.

## Recovery

The seed transport key is not a repository delegate. If VPS #3 is lost:

1. Provision a replacement from this role.
2. Generate a new seed transport identity.
3. Explicitly allowlist the reviewed RIDs.
4. Fetch them from the workstation, another seed, or the Radicle network.
5. Update the preferred-seed NID/address in tracked configuration.
6. Rebuild the broker and adapter at the recorded versions and run the smoke
   verification before accepting CI results.

GitHub contains Git objects and is useful as a checkout fallback, but it does
not recover Radicle identity documents, collaborative objects, or delegate
keys. The restore-tested human-only recovery delegate in the separate recovery
organization therefore remains mandatory before the workstation delegate can
be retired. See `recovery-escrow.md`.

The pilot archive is historical test evidence, not production user data. Its
loss does not block rebuilding the seed or CI host.

The full clean-host sequence, dual-system bootstrap refs, artifact provenance,
and current advisory-state loss boundary are recorded in `vps-replacement.md`
and `rebuild-artifacts.yaml`.

## Controller restart and queue recovery

Before enforcement, rehearse this procedure while the workstation remains a
delegate:

1. Stop `promotion-controller.service` and confirm no canonical ref moves.
2. Leave one request in `queue/processing`, then restart the service.
3. Confirm startup returns it to `queue/pending` and processes it once.
4. Confirm duplicate `(RID, commit, attempt)` submission returns the original
   request ID, while a different job for that tuple is rejected.
5. Confirm missing, mismatched, unsuccessful, and unreplicated job proofs fail
   closed.

The queue policy is **resume**, not discard: startup atomically returns every
in-flight file to pending. Per-RID locks serialize decisions. A successful
request already present in the advisory log is not enqueued again.

The controller private key is intentionally not exported from VPS #3. “Key
restore” therefore means generating a replacement controller DID and using the
human-retrieved recovery delegate to replace the lost DID in every identity
document; it does not mean restoring the same online private key from backup.

Enforcement cutover requires all of the following:

- a separate recovery organization with MFA, verified secret versioning, no
  machine identities, and its observed audit capabilities recorded;
- a restore-tested, passphrase-encrypted recovery delegate blob in Infisical,
  with its passphrase held only in the separate human password manager;
- successful Radicle-delegate, NS1 archive, and proof-state recovery drills
  from an isolated temporary workspace, with expected audit events when the
  plan exposes them;
- the recovery and controller DIDs added at threshold 1;
- restart, queue recovery, proof rejection, and controller replacement drills;
- a clean advisory comparison window through the recorded review date; and
- an automated, monitored Radicle-to-GitHub mirror that has successfully
  mirrored exact canonical SHAs for every repository while the workstation is
  still a delegate;
- GitHub `main` configured as mirror-only, with ordinary direct pushes denied
  and only the dedicated mirroring identity permitted to advance it;
- a negative push test, using an authenticated non-mirror identity, that is
  rejected for GitHub `main` in every mirrored repository;
- release monitoring that treats a missing or delayed mirror of a canonical
  Radicle SHA as a failed promotion, rather than silently leaving production
  behind; and
- removal of the workstation DID from every delegate set.

Apply and verify the mirror controls before removing the workstation DID. Only
the final removal creates Radicle-side enforcement, and it is only end-to-end
authoritative when the mirror-only GitHub boundary is also active. Before
that, CI remains advisory and GitHub retains a production bypass.

Do not bridge Radicle CI results into GitHub status contexts as the primary
design. The release workflow may run after a mirrored canonical push, but the
promotion decision belongs to Radicle. GitHub is a downstream deploy executor,
not a second promotion authority.

## Promotion-state backup boundary

The broker's current job-COB announcement defect makes signed CI evidence
vulnerable to transient single-homing on VPS #3. Broker 0.30.0 makes one
announcement attempt with a hard-coded five-second timeout; a temporary lack
of eligible seeds produces `no refs were announced` even though the signed COB
was stored correctly. `radicle-ci-proof-announcer.timer` reconciles every
allowlisted repository at five-minute intervals. The proof summaries are not a
substitute for their signed source objects. Before enforcement, the external
encrypted backup set must therefore include:

- the producer namespace's `xyz.radworks.job` refs and reachable Git objects
  for every allowlisted RID;
- the corresponding producer `refs/rad/sigrefs` commit and objects;
- the canonical `refs/rad/id` commit required to validate each restored
  repository and producer signed-ref signature;
- `/var/lib/promotion/advisory-events.ndjson`;
- `/var/lib/promotion/controller-audit.ndjson`; and
- `/var/lib/promotion/queue`.

Do not include `/var/lib/promotion/keys/radicle`. The controller key is
host-local and is replaced, not restored. Do not treat
`/var/lib/radicle/ci/promotion-proofs` alone as evidence: it is a derived cache
whose signed source must be available for independent verification.

The tracked `backup-proof-state` pipeline builds one complete Git bundle per
RID, snapshots only the named promotion state, encrypts the payload to the
proof-backup age recipient, signs its envelope with a dedicated host-only
attestation key, uploads through an immutable bucket credential, and verifies
provider retention. The systemd sandbox makes both Radicle and controller key
paths inaccessible.

No local snapshot on VPS #3 satisfies this requirement. Completion requires a
successful encrypted off-host upload plus a restore drill that reconstructs
and verifies one signed CI job without access to the original host. Follow
`proof-state-restore.md`; a failed restore is a hard stop. Do not add delegates,
remove the workstation delegate, or enable authoritative promotion until the
failure is resolved and the drill passes through the human-only recovery
escrow.

## Dependency-fetch failures

Ambient 0.16.0's `npm_get` and generic `http_get` pre-plan actions download
each dependency once and abort before the isolated plan VM if any request
fails. This is an infrastructure failure: no repository check ran, so it must
never be treated as evidence that the commit is bad. The tracked Ambient source
patch retries each download at most three times with 2-second and 4-second
backoff, removing any partial file before retry. It skips non-HTTP lockfile
entries so a repository can separately provision pinned local `file:`
dependencies; the offline install still fails closed if such an input is
absent. After the third HTTP failure the run remains failed and produces no
successful proof.

Install the exact-version patch with `scripts/install-ambient-npm-retry`. The
installer verifies the upstream source hash, builds offline from the cached
crate after fetching its exact locked dependency graph with bounded retry, and
places the patched guest-plan executor at
`/usr/local/bin/ambient-execute-plan`. `config/ambient.yaml` selects that exact
executor; patching the `ambient` coordinator alone has no effect on `npm_get`.
A later Ambient version is a hard stop
until this mitigation is re-reviewed or confirmed upstream.

Do not retry failed tests automatically. An operator retry is permitted only
when the report shows a pre-plan `npm_get` or `http_get` failure before the
repository shell action began. Use `cibtool trigger` for the exact repository
and commit; it enqueues a synthetic event but does not update a Radicle ref.
Record the original failed job and the retry job separately.

### Announcement reconciliation verification

On 2026-08-12, disposable secret-free Ambient patches exercised the first job
producer fork in every allowlisted repository. Each run succeeded, reproduced
the broker's immediate `no refs were announced` result, and was subsequently
reconciled to multiple public seeds:

| Repository | Terminal job COB |
| --- | --- |
| web | `f788f2091955e0e77c94a7844ca5cf01b4afc06c` |
| api | `358392fd969d9668df238f984a00776e42391598` |
| contracts | `5f62618cee13a4be9d03ad1733889b1a81d21c50` |
| freedom-browser | `e55275750c4a785a486f3dfa67bb6bd460494de9` |
| core | `c309294f4b1475f726f14592d530d61e8aadefcc` |

For each repository, `rad sync status` showed the VPS producer `sigrefs`
commit matched by multiple off-host nodes. This verifies both first-fork
creation and terminal-result reconciliation; it does not replace the encrypted
off-host backup and restore drill required before enforcement.

## Workload identity posture

- Ambient build/test guests receive no Infisical identity or production
  secrets.
- Only the trusted controller/deployment side may receive deploy-time access.
- A temporary Infisical Universal Auth identity, if introduced, must be
  narrowly scoped, stored only on the controller host, and have a recorded
  removal deadline. Generic OIDC remains the target before GitHub release
  orchestration is retired.
- The application Infisical organization may hold only public backup
  recipients. Passphrase-wrapped private recovery blobs live only in the
  separate recovery organization; wrapping/key passphrases live only in the
  human password manager.
- The recovery organization has no machine identity, integration, sync,
  webhook, or daily-operator membership. Its account is used only in a
  disposable human-controlled environment and every retrieval is audit-logged.
- Record the age-recipient rotation timestamp and
  `old_identity_retire_after = rotation_timestamp + 30 days` in the recovery
  manifest. Keep the old identity, marked compromised and decrypt-only, until
  that timestamp has passed and no retained archive still names its recipient.
- Infisical must never contain an unencrypted recovery private key or the
  online controller private key. The controller is replaced, never restored.

## Emergency fallback

If the seed or broker is unavailable, leave Radicle canonical state unchanged
and temporarily use the existing GitHub workflows for validation and release.
Do not reinterpret a GitHub-only commit as a Radicle promotion. Once service is
restored, publish the reviewed change as a Radicle patch and follow the normal
promotion sequence.
