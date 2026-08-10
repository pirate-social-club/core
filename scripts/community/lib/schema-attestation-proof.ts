import { createHash } from "node:crypto"

export const SHARD_STATUSES = [
  "satisfied",
  "missing_migration",
  "ledger_missing_artifacts_present",
  "ledger_present_artifacts_missing",
  "partial_artifacts",
  "checksum_mismatch",
  "canonical_schema_missing",
  "canonical_schema_regression",
  "schema_not_ready",
  "missing_from_config",
  "unreachable",
  "error",
] as const

export type ShardStatus = typeof SHARD_STATUSES[number]

export type ManifestShard = {
  binding: string
  database_name: string
  community_id?: string
  pool_version?: number
  status: ShardStatus
  missing: string[]
  canonical_missing?: string[]
  canonical_regressions?: string[]
  detail?: string
  observation_proof?: ShardObservationProof
}

export type ShardObservationProof = {
  format_version: 1
  kind: "raw" | "unavailable"
  schema_fingerprint: string
  migration_ledger_digest: string
  canonical_inventory_digest: string
}

export type SchemaManifest = {
  fleet: "production" | "staging"
  shard_worker_id?: string
  requirements_version: number
  features_checked: string[]
  required_migrations: string[]
  feature_migrations: Record<string, string[]>
  canonical_schema_checked: boolean
  canonical_schema_mode: "disabled" | "ratchet" | "strict"
  canonical_schema_expected_artifacts: number
  canonical_schema_excluded_migrations: string[]
  compatible_missing_schema_artifacts: string[]
  allocated_loaded_shards: number
  live_shards: number
  quarantined_shards: number
  quarantine_registry_checksum: string
  quarantines: Array<{ binding: string; reason_code: string; expires_at: string }>
  classified: number
  summary: Partial<Record<ShardStatus, number>>
  shards: ManifestShard[]
  policy_evidence?: EffectivePolicyEvidence
  effective_policy_digest?: string
}

export type EffectivePolicyEvidence = {
  format_version: 1
  requirements_digest: string
  migration_checksums_digest: string
  classifications_digest: string
  canonical_expected_digest: string
  canonical_baseline_digest: string
  drift_policy_digest: string
}

export type EffectivePolicyContent = {
  requirementsContent: string
  migrations: Array<{ name: string; checksum: string }>
  classifications: unknown
  canonicalExpectedArtifacts: string[]
  canonicalBaselineProfiles: unknown
  driftPolicyContent: string
}

export type PolicyVerdictRow = {
  shard_worker_id: string
  binding_name: string
  community_id: string
  pool_version: number
  attestation_epoch: string
  state: "invalid" | "verified"
  verdict_status: ShardStatus
  effective_policy_digest: string
  schema_fingerprint: string
  migration_ledger_digest: string
  canonical_inventory_digest: string
  verified_at: string | null
  writer_kind: "full_scan"
  writer_run_id: string
  last_error_code: ShardStatus | null
  last_error_detail: string | null
}

export type NormalizedStateProof = {
  shard_worker_id: string
  binding_name: string
  status: ShardStatus
  missing_migrations: string[]
  canonical_missing: string[]
  canonical_regressions: string[]
  detail: string | null
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue)
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, stableValue(entry)]),
    )
  }
  return value
}

export function stableJson(value: unknown): string {
  return JSON.stringify(stableValue(value))
}

export function digest(value: unknown): string {
  return createHash("sha256").update(stableJson(value)).digest("hex")
}

export function shardObservationProof(input: {
  schemaRows: Array<{ type: "index" | "table"; name: string; sql: string | null }>
  migrationLedgerRows: Array<{ migration_name: string; checksum: string }>
  canonicalArtifacts: string[]
}): ShardObservationProof {
  const schemaRows = [...input.schemaRows]
    .map(({ type, name, sql }) => ({ type, name, sql }))
    .sort((left, right) => left.type.localeCompare(right.type) || left.name.localeCompare(right.name))
  const migrationLedgerRows = [...input.migrationLedgerRows]
    .map(({ migration_name, checksum }) => ({ migration_name, checksum }))
    .sort((left, right) => left.migration_name.localeCompare(right.migration_name))
  const canonicalArtifacts = [...input.canonicalArtifacts].sort()
  return {
    format_version: 1,
    kind: "raw",
    schema_fingerprint: digest(schemaRows),
    migration_ledger_digest: digest(migrationLedgerRows),
    canonical_inventory_digest: digest(canonicalArtifacts),
  }
}

export function unavailableShardObservationProof(reason: unknown): ShardObservationProof {
  const unavailable = digest({ unavailable: reason })
  return {
    format_version: 1,
    kind: "unavailable",
    schema_fingerprint: unavailable,
    migration_ledger_digest: unavailable,
    canonical_inventory_digest: unavailable,
  }
}

export function phase0LegacyManifestPolicyEvidence(manifest: SchemaManifest): EffectivePolicyEvidence {
  return {
    format_version: 1,
    requirements_digest: digest({
    requirements_version: manifest.requirements_version,
    features_checked: [...manifest.features_checked].sort(),
    required_migrations: [...manifest.required_migrations].sort(),
    feature_migrations: manifest.feature_migrations,
    }),
    // Historical manifests do not carry these source-content digests. These
    // deterministic replay placeholders are for Phase 0 sizing only and MUST
    // NOT be accepted by a publisher or release fast path.
    migration_checksums_digest: `phase0-legacy:${digest(manifest.required_migrations)}`,
    classifications_digest: `phase0-legacy:${digest({
      features: manifest.features_checked,
      excluded: manifest.canonical_schema_excluded_migrations,
    })}`,
    canonical_expected_digest: `phase0-legacy:${digest({
    canonical_schema_checked: manifest.canonical_schema_checked,
    canonical_schema_mode: manifest.canonical_schema_mode,
    canonical_schema_expected_artifacts: manifest.canonical_schema_expected_artifacts,
    canonical_schema_excluded_migrations: [...manifest.canonical_schema_excluded_migrations].sort(),
    compatible_missing_schema_artifacts: [...manifest.compatible_missing_schema_artifacts].sort(),
    })}`,
    canonical_baseline_digest: `phase0-legacy:${digest(manifest.shards.map((shard) => shard.canonical_missing ?? []))}`,
    drift_policy_digest: "phase0-legacy:unavailable",
  }
}

export function effectivePolicyDigest(evidence: EffectivePolicyEvidence): string {
  const digests = Object.entries(evidence)
    .filter(([key]) => key !== "format_version")
    .map(([, value]) => value)
  if (evidence.format_version !== 1 || digests.some((value) => !/^[0-9a-f]{64}$/u.test(value))) {
    throw new Error("effective policy evidence requires six source-content SHA-256 digests")
  }
  return digest(evidence)
}

/** Bind a verdict to the complete content that can change its meaning.
 *
 * Raw policy files are hashed as bytes so even a source edit that happens to
 * preserve today's derived summary invalidates old proofs. Derived collections
 * are sorted here, making their identity independent of filesystem, Set, or
 * object insertion order.
 */
export function effectivePolicyEvidenceFromContent(
  content: EffectivePolicyContent,
): EffectivePolicyEvidence {
  const migrations = [...content.migrations]
    .map(({ name, checksum }) => ({ name, checksum }))
    .sort((left, right) => left.name.localeCompare(right.name))
  if (
    migrations.some(({ name, checksum }) => !name || !/^[0-9a-f]{64}$/u.test(checksum))
    || new Set(migrations.map(({ name }) => name)).size !== migrations.length
  ) {
    throw new Error("migration policy evidence requires unique names and SHA-256 checksums")
  }
  return {
    format_version: 1,
    requirements_digest: createHash("sha256").update(content.requirementsContent).digest("hex"),
    migration_checksums_digest: digest(migrations),
    classifications_digest: digest(content.classifications),
    canonical_expected_digest: digest([...content.canonicalExpectedArtifacts].sort()),
    canonical_baseline_digest: digest(content.canonicalBaselineProfiles),
    drift_policy_digest: createHash("sha256").update(content.driftPolicyContent).digest("hex"),
  }
}

export function candidateARow(
  shard: ManifestShard,
  manifest: SchemaManifest,
  input: {
    shardWorkerId: string
    communityId?: string
    poolVersion?: number
    runId: string
    verifiedAt: string
    policyDigest: string
  },
): PolicyVerdictRow {
  if (!/^[0-9a-f]{64}$/u.test(input.policyDigest)) {
    throw new Error("Candidate A requires a source-content policy SHA-256 digest")
  }
  const satisfied = shard.status === "satisfied"
  const canonicalMissing = [...(shard.canonical_missing ?? [])].sort()
  const canonicalRegressions = [...(shard.canonical_regressions ?? [])].sort()
  const observationProof = shard.observation_proof
  return {
    shard_worker_id: input.shardWorkerId,
    binding_name: shard.binding,
    community_id: input.communityId ?? `fixture:${shard.binding}`,
    pool_version: input.poolVersion ?? 1,
    attestation_epoch: input.runId,
    state: satisfied ? "verified" : "invalid",
    verdict_status: shard.status,
    effective_policy_digest: input.policyDigest,
    // Legacy fallbacks keep the Phase 0 fixture replay reproducible. An
    // activation-capable manifest is validated first and must carry the raw
    // observation proofs, so production publisher rows always take this path.
    schema_fingerprint: observationProof?.schema_fingerprint
      ?? digest({ canonicalMissing, canonicalRegressions }),
    migration_ledger_digest: observationProof?.migration_ledger_digest
      ?? digest({
        required: [...manifest.required_migrations].sort(),
        missing: [...shard.missing].sort(),
        status: shard.status,
      }),
    canonical_inventory_digest: observationProof?.canonical_inventory_digest
      ?? digest({
        expectedCount: manifest.canonical_schema_expected_artifacts,
        missing: canonicalMissing,
      }),
    verified_at: satisfied ? input.verifiedAt : null,
    writer_kind: "full_scan",
    writer_run_id: input.runId,
    last_error_code: satisfied ? null : shard.status,
    last_error_detail: satisfied ? null : (shard.detail ?? shard.missing.join(", ")).slice(0, 2_000),
  }
}

export function candidateBProof(shard: ManifestShard, shardWorkerId: string): NormalizedStateProof {
  return {
    shard_worker_id: shardWorkerId,
    binding_name: shard.binding,
    status: shard.status,
    missing_migrations: [...shard.missing].sort(),
    canonical_missing: [...(shard.canonical_missing ?? [])].sort(),
    canonical_regressions: [...(shard.canonical_regressions ?? [])].sort(),
    detail: shard.detail ?? null,
  }
}

export function statusFromCandidateA(row: PolicyVerdictRow): ShardStatus {
  return row.state === "verified" ? "satisfied" : row.last_error_code ?? "error"
}

export function evaluatePoolVerdicts(input: {
  shardWorkerId: string
  liveBindings: string[]
  quarantinedBindings: ReadonlySet<string>
  policyDigest: string
  rows: PolicyVerdictRow[]
}) {
  const live = input.liveBindings.filter((binding) => !input.quarantinedBindings.has(binding))
  const matchingRows = new Map(
    input.rows
      .filter((row) => row.shard_worker_id === input.shardWorkerId)
      .map((row) => [row.binding_name, row]),
  )
  let missing = 0
  let invalid = 0
  let policyMismatch = 0
  for (const binding of live) {
    const row = matchingRows.get(binding)
    if (!row) missing += 1
    else if (row.state !== "verified") invalid += 1
    else if (row.effective_policy_digest !== input.policyDigest) policyMismatch += 1
  }
  return {
    hit: live.length > 0 && missing === 0 && invalid === 0 && policyMismatch === 0,
    live: live.length,
    quarantined: input.liveBindings.length - live.length,
    verified: live.length - missing - invalid - policyMismatch,
    missing,
    invalid,
    policyMismatch,
  }
}

function validateManifestShape(value: unknown, source: string): SchemaManifest {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${source}: expected object`)
  const manifest = value as SchemaManifest
  if (manifest.fleet !== "production" && manifest.fleet !== "staging") throw new Error(`${source}: invalid fleet`)
  if (!Array.isArray(manifest.shards)) throw new Error(`${source}: shards must be an array`)
  if (manifest.classified !== manifest.shards.length || manifest.live_shards !== manifest.shards.length) {
    throw new Error(`${source}: incomplete shard classification`)
  }
  if (manifest.allocated_loaded_shards !== manifest.live_shards + manifest.quarantined_shards) {
    throw new Error(`${source}: live and quarantined counts do not cover the allocated loaded roster`)
  }
  const statuses = new Set<string>(SHARD_STATUSES)
  for (const shard of manifest.shards) {
    if (!shard.binding || !statuses.has(shard.status) || !Array.isArray(shard.missing)) {
      throw new Error(`${source}: malformed shard report`)
    }
  }
  const observed: Partial<Record<ShardStatus, number>> = {}
  for (const shard of manifest.shards) observed[shard.status] = (observed[shard.status] ?? 0) + 1
  if (stableJson(observed) !== stableJson(manifest.summary)) {
    throw new Error(`${source}: summary does not reproduce per-shard statuses`)
  }
  return manifest
}

/** Historical scan artifacts are accepted only by the local Phase 0 replay. */
export function validatePhase0LegacyManifest(value: unknown, source = "legacy schema manifest"): SchemaManifest {
  return validateManifestShape(value, source)
}

/** Activation-capable readers fail closed unless all six content proofs exist
 * and reproduce the published effective-policy digest. */
export function validateManifest(value: unknown, source = "schema manifest"): SchemaManifest {
  const manifest = validateManifestShape(value, source)
  if (!manifest.policy_evidence || !manifest.effective_policy_digest) {
    throw new Error(`${source}: missing effective policy content evidence`)
  }
  if (typeof manifest.shard_worker_id !== "string" || !manifest.shard_worker_id.trim()) {
    throw new Error(`${source}: missing shard worker identity`)
  }
  let computed: string
  try {
    computed = effectivePolicyDigest(manifest.policy_evidence)
  } catch (error) {
    throw new Error(`${source}: invalid effective policy content evidence: ${error instanceof Error ? error.message : String(error)}`)
  }
  if (computed !== manifest.effective_policy_digest) {
    throw new Error(`${source}: effective policy digest does not match its six content digests`)
  }
  for (const shard of manifest.shards) {
    const proof = shard.observation_proof
    const digests = proof && [proof.schema_fingerprint, proof.migration_ledger_digest, proof.canonical_inventory_digest]
    if (
      proof?.format_version !== 1
      || (proof.kind !== "raw" && proof.kind !== "unavailable")
      || (shard.status === "satisfied" && proof.kind !== "raw")
      || typeof shard.community_id !== "string"
      || !shard.community_id
      || !Number.isInteger(shard.pool_version)
      || (shard.pool_version as number) < 0
      || !digests
      || digests.some((value) => !/^[0-9a-f]{64}$/u.test(value))
    ) {
      throw new Error(`${source}: ${shard.binding} is missing authoritative per-shard observation evidence`)
    }
  }
  return manifest
}

export const PROPOSED_LEDGER_DDL = `CREATE TABLE d1_pool_schema_attestations (
  shard_worker_id TEXT NOT NULL,
  binding_name TEXT NOT NULL,
  community_id TEXT NOT NULL,
  pool_version INTEGER NOT NULL,
  attestation_epoch TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('invalid', 'verified')),
  verdict_status TEXT NOT NULL CHECK (verdict_status IN (${SHARD_STATUSES.map((status) => `'${status}'`).join(", ")})),
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
  ON d1_pool_schema_attestations(shard_worker_id, effective_policy_digest, state);`

export const PROPOSED_AGGREGATE_SQL = `WITH quarantined(binding_name) AS (
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
  AND q.binding_name IS NULL`
