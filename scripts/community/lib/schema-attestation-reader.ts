import type { D1QueryResult, D1QueryStatement } from "./d1-rest-types"

export type AttestationReaderRunner = (
  statements: D1QueryStatement[],
) => Promise<D1QueryResult[]>

export type PoolAttestationAggregate = {
  live_count: number
  missing_count: number
  verified_count: number
  invalid_count: number
  policy_mismatch_count: number
  oldest_verified_at: string | null
}

export type AttestationShadowComparison = PoolAttestationAggregate & {
  expected_live_count: number
  authoritative_pass: boolean
  roster_matches_authoritative: boolean
  would_fast_path_fire: boolean
  authoritative_match: boolean
}

// The quarantine overlay is deliberately supplied at read time. It expires
// independently of ledger rows, so persisting an "excluded" state would not
// safely decide whether a binding is eligible for the current release.
export const ATTESTATION_AGGREGATE_SQL = `
WITH quarantined(binding_name) AS (
  SELECT CAST(value AS TEXT) FROM json_each(?3)
)
SELECT
  COUNT(*) AS live_count,
  COALESCE(SUM(CASE WHEN a.binding_name IS NULL THEN 1 ELSE 0 END), 0) AS missing_count,
  COALESCE(SUM(CASE WHEN a.state = 'verified' AND a.effective_policy_digest = ?2 THEN 1 ELSE 0 END), 0) AS verified_count,
  COALESCE(SUM(CASE WHEN a.binding_name IS NOT NULL AND a.state != 'verified' THEN 1 ELSE 0 END), 0) AS invalid_count,
  COALESCE(SUM(CASE WHEN a.state = 'verified' AND a.effective_policy_digest != ?2 THEN 1 ELSE 0 END), 0) AS policy_mismatch_count,
  MIN(CASE WHEN a.state = 'verified' AND a.effective_policy_digest = ?2 THEN a.verified_at END) AS oldest_verified_at
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
`

function nonNegativeInteger(value: unknown, field: string): number {
  const parsed = typeof value === "number" ? value : Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`attestation aggregate ${field} must be a non-negative integer`)
  }
  return parsed
}

function readAggregate(result: D1QueryResult | undefined): PoolAttestationAggregate {
  if (!result || !Array.isArray(result.results) || result.results.length !== 1) {
    throw new Error("attestation aggregate must return exactly one row")
  }
  const row = result.results[0]
  if (!row || typeof row !== "object" || Array.isArray(row)) {
    throw new Error("attestation aggregate returned a malformed row")
  }
  const record = row as Record<string, unknown>
  const oldest = record.oldest_verified_at
  if (oldest !== null && typeof oldest !== "string") {
    throw new Error("attestation aggregate oldest_verified_at must be a string or null")
  }
  return {
    live_count: nonNegativeInteger(record.live_count, "live_count"),
    missing_count: nonNegativeInteger(record.missing_count, "missing_count"),
    verified_count: nonNegativeInteger(record.verified_count, "verified_count"),
    invalid_count: nonNegativeInteger(record.invalid_count, "invalid_count"),
    policy_mismatch_count: nonNegativeInteger(record.policy_mismatch_count, "policy_mismatch_count"),
    oldest_verified_at: oldest,
  }
}

export async function readPoolAttestationAggregate(input: {
  shardWorkerId: string
  policyDigest: string
  quarantinedBindings: readonly string[]
  run: AttestationReaderRunner
}): Promise<PoolAttestationAggregate> {
  if (!input.shardWorkerId) throw new Error("attestation aggregate requires a shard Worker ID")
  if (!/^[0-9a-f]{64}$/u.test(input.policyDigest)) {
    throw new Error("attestation aggregate requires a SHA-256 policy digest")
  }
  if (input.quarantinedBindings.some((binding) => !binding.startsWith("DB_CMTY"))
    || new Set(input.quarantinedBindings).size !== input.quarantinedBindings.length) {
    throw new Error("attestation aggregate requires unique DB_CMTY quarantine bindings")
  }
  const results = await input.run([{
    sql: ATTESTATION_AGGREGATE_SQL,
    params: [input.shardWorkerId, input.policyDigest, JSON.stringify(input.quarantinedBindings)],
  }])
  if (results.length !== 1) throw new Error(`attestation aggregate expected one result, received ${results.length}`)
  return readAggregate(results[0])
}

export function compareAttestationShadow(input: {
  aggregate: PoolAttestationAggregate
  expectedLiveCount: number
  authoritativePass: boolean
}): AttestationShadowComparison {
  if (!Number.isSafeInteger(input.expectedLiveCount) || input.expectedLiveCount < 1) {
    throw new Error("attestation shadow requires at least one authoritative live binding")
  }
  const rosterMatches = input.aggregate.live_count === input.expectedLiveCount
  const wouldFastPathFire = rosterMatches
    && input.aggregate.verified_count === input.aggregate.live_count
    && input.aggregate.missing_count === 0
    && input.aggregate.invalid_count === 0
    && input.aggregate.policy_mismatch_count === 0
  return {
    ...input.aggregate,
    expected_live_count: input.expectedLiveCount,
    authoritative_pass: input.authoritativePass,
    roster_matches_authoritative: rosterMatches,
    would_fast_path_fire: wouldFastPathFire,
    authoritative_match: wouldFastPathFire === input.authoritativePass,
  }
}
