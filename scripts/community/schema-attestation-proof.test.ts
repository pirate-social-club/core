import { describe, expect, test } from "bun:test"
import {
  SHARD_STATUSES,
  candidateARow,
  candidateBProof,
  effectivePolicyDigest,
  effectivePolicyEvidenceFromContent,
  evaluatePoolVerdicts,
  digest,
  statusFromCandidateA,
  shardObservationProof,
  unavailableShardObservationProof,
  validateManifest,
  type SchemaManifest,
} from "./lib/schema-attestation-proof"

function manifest(status: SchemaManifest["shards"][number]["status"] = "satisfied"): SchemaManifest {
  const policy_evidence = {
    format_version: 1 as const,
    requirements_digest: digest("requirements"),
    migration_checksums_digest: digest("checksums"),
    classifications_digest: digest("classifications"),
    canonical_expected_digest: digest("canonical"),
    canonical_baseline_digest: digest("baseline"),
    drift_policy_digest: digest("drift"),
  }
  return {
    fleet: "staging",
    requirements_version: 1,
    features_checked: [],
    required_migrations: ["one.sql"],
    feature_migrations: {},
    canonical_schema_checked: true,
    canonical_schema_mode: "ratchet",
    canonical_schema_expected_artifacts: 10,
    canonical_schema_excluded_migrations: [],
    compatible_missing_schema_artifacts: [],
    allocated_loaded_shards: 1,
    live_shards: 1,
    quarantined_shards: 0,
    quarantine_registry_checksum: "a".repeat(64),
    quarantines: [],
    classified: 1,
    summary: { [status]: 1 },
    shards: [{
      binding: "DB_CMTY_0001",
      database_name: "fixture",
      status,
      missing: [],
      observation_proof: shardObservationProof({
        schemaRows: [],
        migrationLedgerRows: [],
        canonicalArtifacts: [],
      }),
    }],
    policy_evidence,
    effective_policy_digest: effectivePolicyDigest(policy_evidence),
  }
}

describe("schema attestation proof", () => {
  test("Candidate A round-trips every current ShardStatus", () => {
    for (const status of SHARD_STATUSES) {
      const fixture = manifest(status)
      const row = candidateARow(fixture.shards[0], fixture, {
        shardWorkerId: "community-d1-shard-staging-a",
        runId: "run-1",
        verifiedAt: "2026-08-03T00:00:00.000Z",
        policyDigest: digest("policy"),
      })
      expect(statusFromCandidateA(row)).toBe(status)
      expect(row.state).toBe(status === "satisfied" ? "verified" : "invalid")
    }
  })

  test("policy content and pool identity are explicit", () => {
    const fixture = manifest()
    const evidence = {
      format_version: 1 as const,
      requirements_digest: digest("requirements"),
      migration_checksums_digest: digest("checksums"),
      classifications_digest: digest("classifications"),
      canonical_expected_digest: digest("canonical"),
      canonical_baseline_digest: digest("baseline"),
      drift_policy_digest: digest("drift"),
    }
    expect(effectivePolicyDigest(evidence)).not.toBe(effectivePolicyDigest({
      ...evidence,
      requirements_digest: digest("changed requirements"),
    }))
    const proof = candidateBProof(fixture.shards[0], "pool-worker-b")
    expect(proof.shard_worker_id).toBe("pool-worker-b")
  })

  test("rejects incomplete or placeholder policy evidence", () => {
    expect(() => effectivePolicyDigest({
      format_version: 1,
      requirements_digest: digest("requirements"),
      migration_checksums_digest: "phase0-legacy:unavailable",
      classifications_digest: digest("classifications"),
      canonical_expected_digest: digest("canonical"),
      canonical_baseline_digest: digest("baseline"),
      drift_policy_digest: digest("drift"),
    })).toThrow("six source-content SHA-256 digests")
  })

  test("builds six deterministic content digests and changes each independently", () => {
    const content = {
      requirementsContent: '{"version":1}\n',
      migrations: [{ name: "one.sql", checksum: digest("one.sql") }],
      classifications: { unconditional: ["one.sql"] },
      canonicalExpectedArtifacts: ["table:posts", "column:posts.post_id"],
      canonicalBaselineProfiles: { legacy: ["column:posts.missing"] },
      driftPolicyContent: '{"communityTemplate":{}}\n',
    }
    const first = effectivePolicyEvidenceFromContent(content)
    expect(Object.values(first).filter((value) => typeof value === "string"))
      .toHaveLength(6)
    expect(effectivePolicyEvidenceFromContent({
      ...content,
      migrations: [...content.migrations].reverse(),
      canonicalExpectedArtifacts: [...content.canonicalExpectedArtifacts].reverse(),
    })).toEqual(first)

    const variants = [
      { requirementsContent: `${content.requirementsContent} ` },
      { migrations: [{ name: "one.sql", checksum: digest("changed") }] },
      { classifications: { deferred: ["one.sql"] } },
      { canonicalExpectedArtifacts: ["table:posts"] },
      { canonicalBaselineProfiles: { legacy: [] } },
      { driftPolicyContent: `${content.driftPolicyContent} ` },
    ]
    for (const changed of variants) {
      expect(effectivePolicyDigest(effectivePolicyEvidenceFromContent({ ...content, ...changed })))
        .not.toBe(effectivePolicyDigest(first))
    }
  })

  test("rejects malformed or duplicate migration content evidence", () => {
    const content = {
      requirementsContent: "requirements",
      migrations: [{ name: "one.sql", checksum: digest("one") }],
      classifications: {},
      canonicalExpectedArtifacts: [],
      canonicalBaselineProfiles: null,
      driftPolicyContent: "drift",
    }
    expect(() => effectivePolicyEvidenceFromContent({
      ...content,
      migrations: [...content.migrations, ...content.migrations],
    })).toThrow("unique names")
    expect(() => effectivePolicyEvidenceFromContent({
      ...content,
      migrations: [{ name: "one.sql", checksum: "not-a-digest" }],
    })).toThrow("SHA-256")
  })

  test("rejects incomplete manifest classification", () => {
    const fixture = manifest()
    fixture.live_shards = 2
    expect(() => validateManifest(fixture)).toThrow("incomplete shard classification")
  })

  test("activation reader rejects missing, placeholder, or mismatched content evidence", () => {
    const fixture = manifest()
    expect(() => validateManifest({ ...fixture, policy_evidence: undefined }))
      .toThrow("missing effective policy content evidence")
    expect(() => validateManifest({
      ...fixture,
      policy_evidence: {
        ...fixture.policy_evidence!,
        drift_policy_digest: "phase0-legacy:unavailable",
      },
    })).toThrow("invalid effective policy content evidence")
    expect(() => validateManifest({ ...fixture, effective_policy_digest: digest("wrong") }))
      .toThrow("does not match its six content digests")
    expect(() => validateManifest({
      ...fixture,
      shards: [{ ...fixture.shards[0], observation_proof: undefined }],
    })).toThrow("missing authoritative per-shard observation evidence")
    expect(() => validateManifest({
      ...fixture,
      shards: [{ ...fixture.shards[0], observation_proof: unavailableShardObservationProof("failed") }],
    })).toThrow("missing authoritative per-shard observation evidence")

    const failed = manifest("error")
    failed.shards[0].observation_proof = unavailableShardObservationProof("probe failed")
    expect(validateManifest(failed).shards[0].observation_proof?.kind).toBe("unavailable")
  })

  test("raw shard observations produce deterministic, independently sensitive proofs", () => {
    const input = {
      schemaRows: [
        { type: "table" as const, name: "posts", sql: "CREATE TABLE posts (post_id TEXT)" },
        { type: "index" as const, name: "idx_posts", sql: "CREATE INDEX idx_posts ON posts(post_id)" },
      ],
      migrationLedgerRows: [
        { migration_name: "two.sql", checksum: digest("two") },
        { migration_name: "one.sql", checksum: digest("one") },
      ],
      canonicalArtifacts: ["table:posts", "column:posts.post_id", "index:idx_posts"],
    }
    const first = shardObservationProof(input)
    expect(shardObservationProof({
      schemaRows: [...input.schemaRows].reverse(),
      migrationLedgerRows: [...input.migrationLedgerRows].reverse(),
      canonicalArtifacts: [...input.canonicalArtifacts].reverse(),
    })).toEqual(first)
    expect(shardObservationProof({
      ...input,
      schemaRows: [{ ...input.schemaRows[0], sql: "CREATE TABLE posts (post_id TEXT, title TEXT)" }],
    }).schema_fingerprint).not.toBe(first.schema_fingerprint)
    expect(shardObservationProof({
      ...input,
      migrationLedgerRows: [{ migration_name: "one.sql", checksum: digest("changed") }],
    }).migration_ledger_digest).not.toBe(first.migration_ledger_digest)
    expect(shardObservationProof({
      ...input,
      canonicalArtifacts: ["table:posts"],
    }).canonical_inventory_digest).not.toBe(first.canonical_inventory_digest)
  })

  test("rejects non-content policy identifiers and inconsistent summaries", () => {
    const fixture = manifest()
    expect(() => candidateARow(fixture.shards[0], fixture, {
      shardWorkerId: "worker-a",
      runId: "run-1",
      verifiedAt: "2026-08-03T00:00:00.000Z",
      policyDigest: "git-commit-is-not-policy-content",
    })).toThrow("source-content policy SHA-256")
    fixture.summary = { error: 1 }
    expect(() => validateManifest(fixture)).toThrow("summary does not reproduce")
  })

  test("quarantine removal exposes missing proof and pool identity prevents collisions", () => {
    const fixture = manifest()
    const policyDigest = digest("policy")
    const row = candidateARow(fixture.shards[0], fixture, {
      shardWorkerId: "worker-a",
      runId: "run-1",
      verifiedAt: "2026-08-03T00:00:00.000Z",
      policyDigest,
    })
    const otherPoolRow = { ...row, shard_worker_id: "worker-b" }
    const quarantined = evaluatePoolVerdicts({
      shardWorkerId: "worker-a",
      liveBindings: [row.binding_name, "DB_CMTY_0002"],
      quarantinedBindings: new Set(["DB_CMTY_0002"]),
      policyDigest,
      rows: [row, otherPoolRow],
    })
    expect(quarantined).toMatchObject({ hit: true, live: 1, quarantined: 1 })

    const removed = evaluatePoolVerdicts({
      shardWorkerId: "worker-a",
      liveBindings: [row.binding_name, "DB_CMTY_0002"],
      quarantinedBindings: new Set(),
      policyDigest,
      rows: [row, otherPoolRow],
    })
    expect(removed).toMatchObject({ hit: false, missing: 1 })
  })

  test("policy changes miss and historical canonical profiles keep distinct fingerprints", () => {
    const fixture = manifest()
    const first = candidateARow(fixture.shards[0], fixture, {
      shardWorkerId: "worker-a",
      runId: "run-1",
      verifiedAt: "2026-08-03T00:00:00.000Z",
      policyDigest: digest("policy-v1"),
    })
    const changedProfile = candidateARow({
      ...fixture.shards[0],
      canonical_missing: ["column:legacy.missing"],
      observation_proof: shardObservationProof({
        schemaRows: [{ type: "table", name: "legacy", sql: "CREATE TABLE legacy (id TEXT)" }],
        migrationLedgerRows: [],
        canonicalArtifacts: ["table:legacy", "column:legacy.id"],
      }),
    }, fixture, {
      shardWorkerId: "worker-a",
      runId: "run-1",
      verifiedAt: "2026-08-03T00:00:00.000Z",
      policyDigest: digest("policy-v1"),
    })
    expect(changedProfile.schema_fingerprint).not.toBe(first.schema_fingerprint)
    expect(evaluatePoolVerdicts({
      shardWorkerId: "worker-a",
      liveBindings: [first.binding_name],
      quarantinedBindings: new Set(),
      policyDigest: digest("policy-v2"),
      rows: [first],
    })).toMatchObject({ hit: false, policyMismatch: 1 })
  })
})
