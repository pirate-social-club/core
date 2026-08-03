import type { D1QueryResult, D1QueryStatement } from "./d1-rest-types"
import type { PolicyVerdictRow } from "./schema-attestation-proof"

export type AllocationGeneration = {
  binding_name: string
  community_id: string
  version: number
}

export type AttestationPublisherRunner = (
  statements: D1QueryStatement[],
) => Promise<D1QueryResult[]>

const INVALIDATE_SQL = `
INSERT INTO d1_pool_schema_attestations (
  shard_worker_id, binding_name, community_id, pool_version,
  attestation_epoch, state, verdict_status, effective_policy_digest,
  schema_fingerprint, migration_ledger_digest, canonical_inventory_digest,
  verified_at, writer_kind, writer_run_id, last_error_code, last_error_detail
)
SELECT ?1, p.binding_name, p.community_id, p.version,
       ?2, 'invalid', 'error', ?3,
       ?4, ?4, ?4,
       NULL, 'full_scan', ?2, 'error', 'authoritative full scan in progress'
FROM d1_pool p
WHERE p.community_id IS NOT NULL AND p.last_loaded_at IS NOT NULL
ON CONFLICT(shard_worker_id, binding_name) DO UPDATE SET
  community_id = excluded.community_id,
  pool_version = excluded.pool_version,
  attestation_epoch = excluded.attestation_epoch,
  state = excluded.state,
  verdict_status = excluded.verdict_status,
  effective_policy_digest = excluded.effective_policy_digest,
  schema_fingerprint = excluded.schema_fingerprint,
  migration_ledger_digest = excluded.migration_ledger_digest,
  canonical_inventory_digest = excluded.canonical_inventory_digest,
  verified_at = excluded.verified_at,
  writer_kind = excluded.writer_kind,
  writer_run_id = excluded.writer_run_id,
  last_error_code = excluded.last_error_code,
  last_error_detail = excluded.last_error_detail
RETURNING binding_name, community_id, pool_version AS version
`

const PUBLISH_SQL = `
WITH incoming AS (
  SELECT
    CAST(json_extract(value, '$.shard_worker_id') AS TEXT) AS shard_worker_id,
    CAST(json_extract(value, '$.binding_name') AS TEXT) AS binding_name,
    CAST(json_extract(value, '$.community_id') AS TEXT) AS community_id,
    CAST(json_extract(value, '$.pool_version') AS INTEGER) AS pool_version,
    CAST(json_extract(value, '$.attestation_epoch') AS TEXT) AS attestation_epoch,
    CAST(json_extract(value, '$.state') AS TEXT) AS state,
    CAST(json_extract(value, '$.verdict_status') AS TEXT) AS verdict_status,
    CAST(json_extract(value, '$.effective_policy_digest') AS TEXT) AS effective_policy_digest,
    CAST(json_extract(value, '$.schema_fingerprint') AS TEXT) AS schema_fingerprint,
    CAST(json_extract(value, '$.migration_ledger_digest') AS TEXT) AS migration_ledger_digest,
    CAST(json_extract(value, '$.canonical_inventory_digest') AS TEXT) AS canonical_inventory_digest,
    CAST(json_extract(value, '$.verified_at') AS TEXT) AS verified_at,
    CAST(json_extract(value, '$.writer_kind') AS TEXT) AS writer_kind,
    CAST(json_extract(value, '$.writer_run_id') AS TEXT) AS writer_run_id,
    CAST(json_extract(value, '$.last_error_code') AS TEXT) AS last_error_code,
    CAST(json_extract(value, '$.last_error_detail') AS TEXT) AS last_error_detail
  FROM json_each(?1)
)
INSERT INTO d1_pool_schema_attestations (
  shard_worker_id, binding_name, community_id, pool_version,
  attestation_epoch, state, verdict_status, effective_policy_digest,
  schema_fingerprint, migration_ledger_digest, canonical_inventory_digest,
  verified_at, writer_kind, writer_run_id, last_error_code, last_error_detail
)
SELECT
  i.shard_worker_id, i.binding_name, i.community_id, i.pool_version,
  i.attestation_epoch, i.state, i.verdict_status, i.effective_policy_digest,
  i.schema_fingerprint, i.migration_ledger_digest, i.canonical_inventory_digest,
  i.verified_at, i.writer_kind, i.writer_run_id, i.last_error_code, i.last_error_detail
FROM incoming i
INNER JOIN d1_pool p
  ON p.binding_name = i.binding_name
 AND p.community_id = i.community_id
 AND p.version = i.pool_version
WHERE p.last_loaded_at IS NOT NULL
ON CONFLICT(shard_worker_id, binding_name) DO UPDATE SET
  community_id = excluded.community_id,
  pool_version = excluded.pool_version,
  attestation_epoch = excluded.attestation_epoch,
  state = excluded.state,
  verdict_status = excluded.verdict_status,
  effective_policy_digest = excluded.effective_policy_digest,
  schema_fingerprint = excluded.schema_fingerprint,
  migration_ledger_digest = excluded.migration_ledger_digest,
  canonical_inventory_digest = excluded.canonical_inventory_digest,
  verified_at = excluded.verified_at,
  writer_kind = excluded.writer_kind,
  writer_run_id = excluded.writer_run_id,
  last_error_code = excluded.last_error_code,
  last_error_detail = excluded.last_error_detail
RETURNING binding_name, community_id, pool_version AS version
`

function generationKey(row: AllocationGeneration): string {
  return `${row.binding_name}\u0000${row.community_id}\u0000${row.version}`
}

function requireExactGenerations(
  expected: AllocationGeneration[],
  result: D1QueryResult | undefined,
  operation: string,
): void {
  if (!result || !Array.isArray(result.results)) {
    throw new Error(`${operation} returned no result rows`)
  }
  const actual = (result.results as Array<Record<string, unknown>>).map((row) => ({
    binding_name: String(row.binding_name ?? ""),
    community_id: String(row.community_id ?? ""),
    version: Number(row.version),
  }))
  const expectedKeys = expected.map(generationKey).sort()
  const actualKeys = actual.map(generationKey).sort()
  if (JSON.stringify(actualKeys) !== JSON.stringify(expectedKeys)) {
    const missing = expectedKeys.filter((key) => !new Set(actualKeys).has(key))
    const unexpected = actualKeys.filter((key) => !new Set(expectedKeys).has(key))
    throw new Error(
      `${operation} generation fence rejected the observed roster` +
      ` (missing=${JSON.stringify(missing)}, unexpected=${JSON.stringify(unexpected)})`,
    )
  }
}

export async function invalidatePoolAttestations(input: {
  shardWorkerId: string
  writerRunId: string
  policyDigest: string
  unavailableDigest: string
  expectedRoster: AllocationGeneration[]
  run: AttestationPublisherRunner
}): Promise<void> {
  const results = await input.run([{
    sql: INVALIDATE_SQL,
    params: [input.shardWorkerId, input.writerRunId, input.policyDigest, input.unavailableDigest],
  }])
  requireExactGenerations(input.expectedRoster, results[0], "attestation invalidation")
}

export async function publishPoolAttestations(input: {
  rows: PolicyVerdictRow[]
  run: AttestationPublisherRunner
  chunkSize?: number
}): Promise<void> {
  const chunkSize = input.chunkSize ?? 100
  if (!Number.isInteger(chunkSize) || chunkSize < 1) throw new Error("attestation chunkSize must be positive")
  const statements: D1QueryStatement[] = []
  const chunks: PolicyVerdictRow[][] = []
  for (let index = 0; index < input.rows.length; index += chunkSize) {
    const chunk = input.rows.slice(index, index + chunkSize)
    chunks.push(chunk)
    statements.push({ sql: PUBLISH_SQL, params: [JSON.stringify(chunk)] })
  }
  if (statements.length === 0) throw new Error("refusing to publish an empty attestation roster")
  const results = await input.run(statements)
  if (results.length !== chunks.length) {
    throw new Error(`attestation publication expected ${chunks.length} result(s), received ${results.length}`)
  }
  chunks.forEach((chunk, index) => {
    requireExactGenerations(
      chunk.map((row) => ({
        binding_name: row.binding_name,
        community_id: row.community_id,
        version: row.pool_version,
      })),
      results[index],
      `attestation publication chunk ${index + 1}`,
    )
  })
}

export const ATTESTATION_INVALIDATE_SQL = INVALIDATE_SQL
export const ATTESTATION_PUBLISH_SQL = PUBLISH_SQL
