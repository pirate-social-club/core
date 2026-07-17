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
├── config/                               host-local config; only its HASH is recorded
└── shared/                               persistent state (databases, keys)
```

Releases are immutable and built only from clean, exact git commits.
Configuration and state never live inside a release.

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

Reports host/role, desired commit + image digest, running container state and
start time, whether the running image matches the pinned digest, release
checksum integrity, config-hash status, and (when `DB_PATH` is declared) the
database mtime and zone count. Ends with `drift: none` or one line per finding.

`verify-deployment.sh` runs the same checks and exits nonzero on any drift —
for timers and scripts.

## Daily drift timer

Install on each host:

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

Failures post to the ops-alerts webhook using the same payload shape as the
backup role. Remember the standing lesson: `OnFailure` cannot catch a dead
timer — external dead-man monitoring on "most recent successful verification"
belongs with the general monitoring role, not here.

## What is deliberately NOT here

- No public version endpoint or metadata TXT record: SSH plus alerting is
  sufficient at this fleet size, and availability is probed externally.
- No fleet ledger commits back into this repo: the host is the authority for
  runtime state; deployment history is the `releases/` directory itself.
- No configuration contents or secrets in any recorded artifact — hashes only.

## Testing

`deployment-tooling.test.sh` is an executable harness (docker shimmed, no
daemon needed) covering release staging, dirty-tree refusal, checksum/config/
symlink/digest/expectation drift. It runs in the `hns-integration` workflow.
