# VPS Deployment Tooling

Reusable release + drift-verification tooling for the HNS/Spaces edge roles
(`hns-secondary-dns`, `hns-authoritative-dns`, `hns-verifier`,
`hns-public-gateway`, `hns-chain-observer`, `spaces-verifier`, ...). It answers
three questions with three sources of truth:

| Source                    | Answers                          |
| ------------------------- | -------------------------------- |
| Core git commit           | What should be deployed?         |
| Host status/verification  | What is actually running?        |
| External DNS/HTTP probe   | Does it work from the internet?  |

This tooling implements the middle row. External probes are a separate,
multi-vantage concern and deliberately not part of this role.

## Release layout

Every role deploys under a single root, e.g. `/srv/pirate-hns-secondary`:

```
$DEPLOY_ROOT/
├── current -> releases/<core-commit>     atomic switch + rollback
├── releases/<core-commit>/
│   ├── DEPLOYMENT                        role, commit, image digest, flags
│   ├── SHA256SUMS                        covers every file in the release
│   ├── bin/                              this tooling, copied per release
│   └── <tracked role files>
├── app -> app-releases/<app-commit>       optional independently pinned app
├── app-releases/<app-commit>/
│   └── .pirate-deployment/{DEPLOYMENT,SHA256SUMS}
├── config/                               host-local config; only its HASH is recorded
└── shared/                               persistent state (databases, keys)
```

Releases are immutable and built only from clean, exact git commits that are
ancestors of the locally fetched `refs/remotes/origin/main`.
Configuration and state never live inside a release.

### Runtime mount boundary

Release checksums prove that the tracked compose file is authentic; they do
not prove that a running container uses the paths declared in that file.
Compose resolves relative bind mounts from the release directory, so a
`./data` or `./secrets` mount can silently create fresh state after a release
switch while the release and config manifests still verify cleanly. Stateful
roles must use explicit stable host paths (normally under `$DEPLOY_ROOT/shared`
or `$DEPLOY_ROOT/config`) and deployment should inspect the live container
mounts during cutover. The deployment harness rejects release-relative
`./data` and `./secrets` mounts across every `ops/vps/*/compose.yaml`.

## Building a release (operator machine, clean checkout)

```
bash ops/vps/deployment-tooling/make-release.sh ops/vps/hns-secondary-dns \
  /tmp/ns2-out --expect-running false --db-path shared/data/pdns.sqlite3
```

`make-release.sh` refuses dirty trees, copies only `git ls-files` output,
extracts the pinned image digest and container name from the role's
`compose.yaml`, and writes `DEPLOYMENT` + `SHA256SUMS`. Copy
`releases/<commit>` to the host, flip the `current` symlink, then record the
configuration hash once:

Both release builders fail closed when the selected core or app commit is not
an ancestor of the locally available `origin/main`. They do not perform network
access. CI and the operator are responsible for fetching the current protected
branch before building. An approved disconnected emergency must pass
`--break-glass-non-main <incident-or-change-reference>`; the builders record
that exception in `DEPLOYMENT` rather than silently warning.

A role that needs a separately built runtime artifact may provide an
executable, tracked `bin/stage-release-assets.sh`. `make-release.sh` runs it
with the new release directory as its only argument before producing
`SHA256SUMS`. The role stager must pin and verify the artifact provenance and
must write only inside that release directory; any failure aborts staging.

Roles that execute source from a separate full-repository app tree must stage
that tree and pin it explicitly:

```bash
bash ops/vps/deployment-tooling/make-app-release.sh /tmp/spaces-out \
  --commit <full-app-commit>
bash ops/vps/deployment-tooling/make-release.sh ops/vps/spaces-verifier \
  /tmp/spaces-out --app-commit <full-app-commit>
```

Copy both immutable release directories to the host, then atomically point
`current` and `app` at the declared releases. App releases contain a manifest
covering the complete archived source tree. Verification fails if the app
symlink is missing or repointed, the app metadata disagrees, any covered file
changes or disappears, a file is added, or the manifest is missing.

```
sudo $DEPLOY_ROOT/current/bin/deployment-status.sh --deploy-root $DEPLOY_ROOT --record-config
```

Set `EXPECT_RUNNING=false` for roles staged ahead of their launch gate (e.g.
ns2 before the primary exists); flip it to `true` in the next release when the
service goes live.

## Checking a host

```
sudo $DEPLOY_ROOT/current/bin/deployment-status.sh --deploy-root $DEPLOY_ROOT
```

Reports host/role, desired role and optional app commits, image digest, running
container state and start time, release and app checksum integrity,
host-runtime executable integrity, installed host-file integrity, config-hash
status, and (when `DB_PATH` is declared) the database mtime and zone count.
Ends with `drift: none` or one line per finding.

For a role that deliberately executes a host-managed binary, create the
root-owned `$DEPLOY_ROOT/config/RUNTIME_SHA256SUMS` using standard `sha256sum`
format and absolute, resolved executable paths. The daily verifier checks every
entry. Because the manifest is inside `config/`, its own contents are also
covered by `CONFIG_SHA256`; adding or changing a pin requires an explicit
`--record-config`. Do not use this manifest for release-contained artifacts or
digest-pinned containers, which already have stronger native checks.

`verify-deployment.sh` runs the same checks and exits nonzero on any drift —
for timers and scripts.

## Installed host files

Files copied or generated outside the immutable release are not executables and
must not be added to `RUNTIME_SHA256SUMS`. Examples are installed systemd
fragments and generated `/etc/caddy/caddy.json`.

After installing the complete set owned by one role, record it in one call:

```bash
sudo $DEPLOY_ROOT/current/bin/record-installed-files.sh \
  --deploy-root "$DEPLOY_ROOT" \
  /etc/systemd/system/pirate-example.service \
  /etc/example/generated.json
```

The helper writes `config/INSTALLED_SHA256SUMS` atomically from absolute paths
and refreshes `CONFIG_SHA256`, so the installed-file manifest is itself
covered. It preserves each installed path instead of resolving symlinks, so a
later repoint that changes the deployed bytes is detected. A repoint to
byte-identical content intentionally passes because this is a content-integrity
manifest, not a symlink-identity ledger. Each invocation replaces the manifest:
pass the complete set of installed files owned by that role. Daily deployment
verification checks their live bytes.

When an installed path belongs to systemd, the helper also records the effective
unit assembled by `systemctl cat`, including every drop-in, in
`config/SYSTEMD_UNIT_SHA256SUMS`. Source-path comments emitted by systemd,
line-ending differences, and trailing whitespace are normalized; directive
internal whitespace is preserved. A unit can be recorded explicitly when no
unit file path is among the installed files:

```bash
sudo $DEPLOY_ROOT/current/bin/record-installed-files.sh \
  --deploy-root "$DEPLOY_ROOT" \
  --systemd-unit caddy.service \
  /etc/caddy/caddy.json
```

The effective-unit manifest is protected by `CONFIG_SHA256`, and verification
fails if a unit or any of its drop-ins is unavailable or changes. Every shared
host unit has exactly one owning role; for example, the gateway owns
`caddy.service`, so other roles must not record or install competing Caddy
drop-ins.

## Daily drift timer

For a host with exactly one Pirate role, the original single-role unit remains
available:

```
sudo install -m 0644 $DEPLOY_ROOT/current/systemd/pirate-deployment-verify.service /etc/systemd/system/
sudo install -m 0644 $DEPLOY_ROOT/current/systemd/pirate-deployment-verify.timer /etc/systemd/system/
sudo install -m 0644 $DEPLOY_ROOT/current/systemd/pirate-deployment-verify-alert@.service /etc/systemd/system/
printf 'DEPLOY_ROOT=%s\nOPS_ALERT_WEBHOOK_URL=%s\n' "$DEPLOY_ROOT" "$WEBHOOK" \
  | sudo tee /etc/pirate-deployment-verify.env >/dev/null
sudo chmod 0600 /etc/pirate-deployment-verify.env
sudo systemctl daemon-reload
sudo systemctl enable --now pirate-deployment-verify.timer
```

For a host with multiple roles, install the templated units once and create one
root-owned env file per stable role name:

```bash
sudo install -m 0644 $DEPLOY_ROOT/current/systemd/pirate-deployment-verify@.service /etc/systemd/system/
sudo install -m 0644 $DEPLOY_ROOT/current/systemd/pirate-deployment-verify@.timer /etc/systemd/system/
sudo install -m 0644 $DEPLOY_ROOT/current/systemd/pirate-deployment-verify-role-alert@.service /etc/systemd/system/
sudo install -d -m 0700 /etc/pirate-deployment-verify
printf 'DEPLOY_ROOT=%s\nOPS_ALERT_WEBHOOK_URL=%s\n' "$DEPLOY_ROOT" "$WEBHOOK" \
  | sudo tee /etc/pirate-deployment-verify/observer.env >/dev/null
sudo chmod 0600 /etc/pirate-deployment-verify/observer.env
sudo systemctl daemon-reload
sudo systemctl enable --now pirate-deployment-verify@observer.timer
```

When the destination is Pirate's authenticated edge-alert ingress, also set
`OPS_ALERT_BEARER_TOKEN_FILE=/etc/pirate-deployment-verify/edge-alert-token` in
each role env file. Install the shared token file once with root ownership and
mode `0600`; never place the token value directly in an env file or command
argument. The alert helper reads it only when constructing the HTTPS request.

Repeat only the env-file and enable steps for other roles, such as `authdns`
or `secondary`. Role names are systemd instance identifiers, not deploy-root
paths. Run each service once after installation and confirm success before
relying on its timer:

```bash
sudo systemctl start pirate-deployment-verify@observer.service
sudo systemctl status --no-pager pirate-deployment-verify@observer.service
```

Failures post to the ops-alerts webhook using the same payload shape as the
backup role. Successful checks also POST an authenticated role heartbeat when
the webhook, token file, and deploy root are configured. The API alerts when
an expected role has not checked in for 36 hours, covering dead hosts and dead
timers that cannot trigger `OnFailure` locally.

## What is deliberately NOT here

- No public version endpoint or metadata TXT record: SSH plus alerting is
  sufficient at this fleet size, and availability is probed externally.
- No fleet ledger commits back into this repo: the host is the authority for
  runtime state; deployment history is the `releases/` directory itself.
- No configuration contents or secrets in any recorded artifact — hashes only.

## Testing

`deployment-tooling.test.sh` is an executable harness (docker shimmed, no
daemon needed) covering release staging, dirty-tree refusal, checksum/config/
role/app symlink, app file-set, digest, and expectation drift. It runs in the
`hns-integration` workflow.
