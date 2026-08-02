# Schema attestation Phase 0 fixtures

These are compacted, read-only release manifests used by the local proof-format
spike. They contain the policy fields, quarantine summary, and per-shard reports
needed for replay; transport metrics and runner-local paths were removed.

- `staging-30759252865.json`: Release run 30759252865, staging schema gate.
- `production-30438236181.json`: Release run 30438236181, production schema gate.

No account IDs, database IDs, credentials, or raw SQL are present. The spike
report records a content checksum for each compact fixture.

Reproduce the report from the Core repository root:

```sh
bun scripts/community/spike-schema-attestation-ledger.ts \
  --manifest scripts/community/fixtures/schema-attestation-ledger/staging-30759252865.json,community-d1-shard-staging \
  --manifest scripts/community/fixtures/schema-attestation-ledger/production-30438236181.json,community-d1-shard-production \
  --report docs/community-d1-schema-attestation-ledger-phase0.md
```
