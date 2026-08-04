# D1 schema attestation ledger Phase 0 spike

Generated from recent read-only staging and production schema-gate manifests. Timings are local Bun SQLite measurements over 1,000 executions; they validate query shape and response size, not Cloudflare network latency.

| fleet | pools | live | quarantined | statuses | profiles | A bytes/shard | B bytes/shard | aggregate bytes | local query ms | fixture SHA |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| staging | 1 | 1055 | 7 | 2 | 5 | 764 | 257 | 151 | 2 | 6f0f1d969127 |
| production | 1 | 104 | 1 | 1 | 7 | 773 | 2926 | 149 | <1 | f6904c5d11b9 |

## Findings

- staging: Candidate A reproduced all 1055 recorded ShardStatus values; 5 historical canonical profiles remained distinct.
- staging: changing effective policy produced a new digest, so all prior verdict rows miss without rewriting them.
- staging: adding quarantine removes a binding from the aggregate roster; removing it exposes the left-joined row, where missing/invalid/policy-mismatched proof blocks or falls back.
- production: Candidate A reproduced all 104 recorded ShardStatus values; 7 historical canonical profiles remained distinct.
- production: changing effective policy produced a new digest, so all prior verdict rows miss without rewriting them.
- production: adding quarantine removes a binding from the aggregate roster; removing it exposes the left-joined row, where missing/invalid/policy-mismatched proof blocks or falls back.

Candidate A is selected. Its row size is fixed and bounded (Candidate B is smaller for the sparse staging fixture but grows with recorded inventory drift, as the production fixture shows), it preserves every current status through the bounded verdict code, and it makes policy changes fail closed by digest. Candidate B is retained only as the byte-size comparison; the current manifest does not contain enough raw ledger/checksum observations to make Candidate B safely re-evaluate arbitrary future policy.

## Blocking evidence gap found by the spike

The Phase 0 fixtures predate trusted policy identity and retain visibly invalid
`phase0-legacy:*` placeholders for local sizing only. Phase 2 adds six SHA-256
fields to newly published schema-gate manifests: requirements content,
migration names+checksums, effective classifications, canonical expected
inventory, canonical baseline profiles, and known-drift policy. The
activation-capable reader rejects a placeholder, missing field, unknown format,
non-SHA-256 value, or aggregate digest mismatch; the legacy reader is confined
to the local Phase 0 replay. This closes the policy-content evidence gap but
does not activate the release fast path. The manifest's missing-artifact arrays
remain insufficient as authoritative per-shard schema/ledger fingerprints.
The publisher phase now computes all three from raw observations returned by
the verifier's existing per-shard REST batch: the ordered `sqlite_master`
inventory, the ordered `(migration_name, checksum)` ledger, and the normalized
canonical artifact inventory. This adds statements and response bytes to the
existing batch but no additional HTTP request. Activation remains a separate,
reviewed phase; the REST full-fleet scan is still the release authority.

A release performs one aggregate query per shard-owned D1_POOL and combines all pool results fail closed. This is the multi-pool-safe interpretation of the original one-query goal; a single D1 query cannot span independent pool databases. Pool identity is part of every proof key.

The proof state machine uses only invalid and verified. The proposed verifying state is removed because Phase 0 found no owner or safety property that requires it.

## Proposed DDL

```sql
CREATE TABLE d1_pool_schema_attestations (
  shard_worker_id TEXT NOT NULL,
  binding_name TEXT NOT NULL,
  community_id TEXT NOT NULL,
  pool_version INTEGER NOT NULL,
  attestation_epoch TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('invalid', 'verified')),
  verdict_status TEXT NOT NULL CHECK (verdict_status IN ('satisfied', 'missing_migration', 'ledger_missing_artifacts_present', 'ledger_present_artifacts_missing', 'partial_artifacts', 'checksum_mismatch', 'canonical_schema_missing', 'canonical_schema_regression', 'schema_not_ready', 'missing_from_config', 'error')),
  effective_policy_digest TEXT NOT NULL CHECK (length(effective_policy_digest) = 64 AND effective_policy_digest NOT GLOB '*[^0-9a-f]*'),
  schema_fingerprint TEXT NOT NULL CHECK (length(schema_fingerprint) = 64 AND schema_fingerprint NOT GLOB '*[^0-9a-f]*'),
  migration_ledger_digest TEXT NOT NULL CHECK (length(migration_ledger_digest) = 64 AND migration_ledger_digest NOT GLOB '*[^0-9a-f]*'),
  canonical_inventory_digest TEXT NOT NULL CHECK (length(canonical_inventory_digest) = 64 AND canonical_inventory_digest NOT GLOB '*[^0-9a-f]*'),
  verified_at TEXT,
  writer_kind TEXT NOT NULL,
  writer_run_id TEXT NOT NULL,
  last_error_code TEXT,
  last_error_detail TEXT CHECK (length(last_error_detail) <= 2000),
  PRIMARY KEY (shard_worker_id, binding_name),
  FOREIGN KEY (binding_name) REFERENCES d1_pool(binding_name) ON DELETE CASCADE,
  CHECK ((state = 'verified' AND verified_at IS NOT NULL AND last_error_code IS NULL)
      OR (state = 'invalid' AND verified_at IS NULL))
);
CREATE INDEX idx_d1_pool_schema_attestations_policy
  ON d1_pool_schema_attestations(shard_worker_id, effective_policy_digest, state);
```

## Proposed per-pool aggregate

The three parameters are shard Worker ID, effective-policy digest, and the freshly validated quarantine binding array encoded as JSON. A zero-live result is blocking. The caller requires `live_count = verified_count` and every miss/error count to be zero.

```sql
WITH quarantined(binding_name) AS (
  SELECT CAST(value AS TEXT) FROM json_each(?3)
)
SELECT
  COUNT(*) AS live_count,
  SUM(CASE WHEN a.binding_name IS NULL THEN 1 ELSE 0 END) AS missing_count,
  SUM(CASE WHEN a.state = 'verified' AND a.effective_policy_digest = ?2 THEN 1 ELSE 0 END) AS verified_count,
  SUM(CASE WHEN a.state != 'verified' THEN 1 ELSE 0 END) AS invalid_count,
  SUM(CASE WHEN a.state = 'verified' AND a.effective_policy_digest != ?2 THEN 1 ELSE 0 END) AS policy_mismatch_count,
  MIN(a.verified_at) AS oldest_verified_at
FROM d1_pool p
LEFT JOIN quarantined q ON q.binding_name = p.binding_name
LEFT JOIN d1_pool_schema_attestations a
  ON a.binding_name = p.binding_name
 AND a.shard_worker_id = ?1
 AND a.community_id = p.community_id
 AND a.pool_version = p.version
WHERE p.community_id IS NOT NULL
  AND p.last_loaded_at IS NOT NULL
  AND q.binding_name IS NULL
```

## Publisher phase

`verify-community-schema-requirements.ts --publish-attestations` keeps the REST
full-fleet scan as the sole release authority while publishing its evidence to
the pool ledger. Before contacting community databases, the writer invalidates
the complete allocated-and-loaded roster and verifies that the rows returned by
that write exactly match the roster it discovered. After the scan, it publishes
each verdict only while `(binding_name, community_id, version)` still matches
`d1_pool` and the ledger still carries that scan's writer epoch. A release,
reallocation, or newer overlapping scan therefore makes the older writer fail
closed instead of overwriting fresher invalidation evidence.
Quarantined allocations are invalidated but are not republished until a later
authoritative scan observes them as live.

Publication status is recorded in the manifest as `pending` before the final
write and changed to `published` only after every generation-fenced chunk is
confirmed. A publication error fails the command, but no ledger result changes
how the full scan classifies the release.

Fast-path activation remains a later review gate. Shadow evidence must span at
least one real community-template schema change and demonstrate correct
invalidation, migration, and re-attestation. It must also include a quarantine
transition, an unavailable or failed observation, and every canonical schema
profile present in staging. Consecutive quiet green releases alone are not
sufficient activation evidence.

Each shadow manifest records both `authoritative_match` and
`would_fast_path_fire`. The latter is required: agreement alone cannot detect a
reader that abstains forever. Quarantined bindings are excluded through the
freshly validated registry at read time, so their intentionally invalid ledger
rows neither block nor falsely satisfy the aggregate.
