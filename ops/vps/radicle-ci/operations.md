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

Run the tracked verifier on VPS #3 after upgrades or restarts:

```bash
sudo ops/vps/radicle-ci/scripts/verify-host.sh
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
keys. The offline recovery delegate therefore remains mandatory before the
workstation delegate can be retired.

The pilot archive is historical test evidence, not production user data. Its
loss does not block rebuilding the seed or CI host.

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
offline recovery delegate to replace the lost DID in every identity document;
it does not mean restoring the same online private key from backup.

Enforcement cutover requires all of the following:

- two separately secured copies of a restore-tested offline recovery delegate;
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
- `/var/lib/promotion/advisory-events.ndjson`;
- `/var/lib/promotion/controller-audit.ndjson`; and
- `/var/lib/promotion/queue`.

Do not include `/var/lib/promotion/keys/radicle`. The controller key is
host-local and is replaced, not restored. Do not treat
`/var/lib/radicle/ci/promotion-proofs` alone as evidence: it is a derived cache
whose signed source must be available for independent verification.

No local snapshot on VPS #3 satisfies this requirement. Completion requires
an encrypted off-host copy plus a restore drill that reconstructs and verifies
one signed CI job without access to the original host. Follow
`proof-state-restore.md`; a failed restore is a hard stop. Do not add delegates,
remove the workstation delegate, or enable authoritative promotion until the
failure is resolved and the drill passes from both recovery copies.

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
- Infisical may hold only the public age recipient after rotation. The private
  age identity belongs on separately secured offline media.
- Record the age-recipient rotation timestamp and
  `old_identity_retire_after = rotation_timestamp + 30 days` in the recovery
  manifest. Keep the old identity, marked compromised and decrypt-only, until
  that timestamp has passed and no retained archive still names its recipient.
- Infisical must never contain the offline recovery delegate or the online
  controller delegate private key.

## Emergency fallback

If the seed or broker is unavailable, leave Radicle canonical state unchanged
and temporarily use the existing GitHub workflows for validation and release.
Do not reinterpret a GitHub-only commit as a Radicle promotion. Once service is
restored, publish the reviewed change as a Radicle patch and follow the normal
promotion sequence.
