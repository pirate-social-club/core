# HNS/Spaces VPS Git provenance audit — 2026-08-12

## Verdict

The VPS runtime is mostly Git-backed, but the audited deployment was not fully
Git-controlled. Production included branch-only Spaces code, the HNS verifier
shared an app symlink with the state-backup role, and install-time artifacts
under `/etc` were outside deployment integrity verification.

## Evidence labels

- **Repository-confirmed:** reproduced independently from tracked files and
  remote Git references.
- **Directly observed once on 2026-08-12, not independently reconfirmed:** read
  from the two VPS hosts through non-mutating SSH commands during the original
  audit. A later independent review could not obtain SSH permission.
- **Publicly reprobed:** checked through the public HTTPS endpoint without SSH.

No secret values were read and no host state was changed.

## Repository-confirmed findings

1. The active Spaces lineage was five commits ahead of `origin/main`. It
   existed on `origin/fix/spaces-verifier-anchor-freshness`, but had no pull
   request or CI run. Remote branch storage prevented immediate loss; it did
   not provide protected-branch review or durable mainline provenance.
   The lineage later entered `main` through pull request #502 as squash commit
   `511e914e2c5992d28500495cdf673b2f452a2f78`. This historical commit records
   the first compliant release source; future releases use the then-current
   `origin/main`, not this dated value.
2. The HNS verifier unit used `/srv/pirate-hns/app`, while the state-backup role
   owned `/srv/pirate-hns` and independently pinned that same app symlink. The
   collision was structural: deploying either app could invalidate the other
   role's declared commit.
3. Release verification covered role and app manifests, deploy-root config,
   and host-managed executables. The installed-file manifest did not enumerate
   additions and did not capture systemd's effective unit plus drop-ins.
4. The third-party DNS proxy image was digest-pinned. The locally built HNS
   observer and recursive chain-reader images initially used bare local tags;
   Core #514 later bound their running bytes to Docker content-addressed image
   IDs in `DEPLOYMENT` and checks them during drift verification.
5. The superseded `infra/hns-edge` prototype was outside any Git repository and
   was marked `do not deploy`; the canonical implementation lived under
   `core/ops/vps` and `core/services`.
6. The old release builders rejected dirty trees and admitted only tracked
   files, but accepted any local commit. `--app-commit` was validated as a full
   hexadecimal commit identifier without a protected-branch ancestry check.

## Direct live observations

These facts were directly observed once on 2026-08-12 and were not
independently reconfirmed:

- `/srv/pirate-hns/current` declared one app commit while
  `/srv/pirate-hns/app` pointed to a newer checksummed app release. The role's
  deployment status reported both the symlink and metadata mismatch.
- Eleven of twelve sampled installed product systemd units matched their
  release copies. The HNS verifier unit was an older historical version and
  omitted the current executable preflight checks.
- Daily deployment-drift verifier instances existed for authority DNS, DoH,
  observer, Spaces, and secondary DNS. Separate backup execution monitoring
  was active, but deployment-drift instances were not configured for the
  state-backup, gateway, or HNS verifier roles.
- All active role and app file manifests verified except the HNS shared-app
  mismatch. The active Spaces role and app commits were branch-only; other
  active role commits were ancestors of `origin/main`.
- Across 46 retained role/app commit identifiers, 39 were on `main`, seven
  remained only on remote feature branches, and none lacked a remote ref.
- The HNS observer and recursive chain-reader containers were healthy but used
  locally built images without deployment-recorded digests.
- Primary and secondary DNS had ten zones in common with matching SOA serials.
  The secondary retained three additional zones absent from the primary.
- No Git checkout or ad hoc source tree existed under the inspected service,
  optional-software, or operator-home paths on either host.

Public probes returned HTTP 200 for Spaces health and DoH. The HNS verifier
health route required authentication as designed.

## Integrity coverage after remediation

| Asset | Integrity source |
| --- | --- |
| Role and app-release files | Release `SHA256SUMS` |
| `$DEPLOY_ROOT/config/**` | `CONFIG_SHA256` |
| Bun and the custom Caddy binary | `RUNTIME_SHA256SUMS` |
| Installed file bytes and generated Caddy JSON | `INSTALLED_SHA256SUMS` |
| Effective systemd units plus drop-ins | `SYSTEMD_UNIT_SHA256SUMS` (normalized `systemctl cat`) |
| Locally built container image bytes | `LOCAL_IMAGE_ID_*` in `DEPLOYMENT` |

The installed-file manifest belongs to the role that performs the installation
and is itself covered by that role's config hash. It detects a symlink repoint
when the bytes at the installed path change; byte-identical replacement is
outside this content-integrity boundary. The effective-unit manifest is also
protected by `CONFIG_SHA256`; it covers the unit assembled by systemd, including
drop-ins, rather than only the individual files recorded at install time.

## Remediation order

1. Give the HNS verifier the dedicated `/srv/pirate-hns-verifier` root. Stage
   its app and role release first, then install the root-changing systemd unit
   and restart it in one operation window. Do not separately update the old
   unit before the new root is complete.
2. After the verifier is healthy on its dedicated root, atomically repoint
   `/srv/pirate-hns/app` to the app commit declared by the state-backup role.
   Require a clean backup-role deployment verification before enabling its
   drift timer.
3. Merge the Spaces production lineage through protected `main`, run CI, and
   redeploy both its role and app from mainline commits.
4. Enable deployment-drift verification for backup, gateway, and verifier.
5. Record installed systemd fragments and generated Caddy JSON at install time;
   Core #532 now also records and verifies the normalized effective unit,
   including drop-ins. The gateway is the sole tracked owner of `caddy.service`.
6. Core #514 records and verifies immutable Docker image IDs for the locally
   built observer and recursive chain-reader images; future releases must
   capture those IDs after building from the same protected Core commit.
7. Reconcile the three secondary-only zones through the reviewed zone-lifecycle
   process.
8. Archive or remove the superseded unversioned prototype after confirming it
   has no remaining reference value.

## Release provenance decision

Normal release construction hard-fails unless core and app commits are
ancestors of the locally fetched `refs/remotes/origin/main`. The builders do
not require network access; CI and the operator must fetch the protected branch
before building. A disconnected emergency requires an explicit
`--break-glass-non-main <incident-or-change-reference>` argument, and the
exception is written into release metadata.

## 2026-08-13 host follow-up

The removed `/etc/caddy/Caddyfile` was a rendered verifier rate-limiting
configuration, not a copy of any tracked gateway Caddyfile example. Its
SHA-256 was
`62ea19fafaf2b8be47c400f3e9142f20a8aafb718ea61302ac14a934c6284fe2`.
The captured artifact is retained at
[`evidence/legacy-caddyfile-observed-2026-08-13.txt`](evidence/legacy-caddyfile-observed-2026-08-13.txt)
for historical comparison; `/etc/caddy/caddy.json` is the active authoritative
configuration.

The observer bring-up now documents Docker Buildx as a required build-time host
dependency because its Dockerfile uses BuildKit-only `COPY --chmod`. Runtime
integrity remains bound to the recorded local image ID.
