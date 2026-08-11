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
- removal of the workstation DID from every delegate set.

Only the final removal creates enforcement. Before it, CI remains advisory.

## Promotion-state backup boundary

The broker's current job-COB announcement defect makes signed CI evidence
single-homed on VPS #3. The proof summaries are not a substitute for their
signed source objects. Before enforcement, the external encrypted backup set
must therefore include:

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
one signed CI job without access to the original host.

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
- Infisical must never contain the offline recovery delegate or the online
  controller delegate private key.

## Emergency fallback

If the seed or broker is unavailable, leave Radicle canonical state unchanged
and temporarily use the existing GitHub workflows for validation and release.
Do not reinterpret a GitHub-only commit as a Radicle promotion. Once service is
restored, publish the reviewed change as a Radicle patch and follow the normal
promotion sequence.
