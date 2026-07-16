import { describe, expect, test } from "bun:test"
import { Database } from "bun:sqlite"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

import { artifactCount, expectedArtifacts } from "./community-schema-artifacts"

const MIGRATIONS = resolve(import.meta.dir, "../../db/community-template/migrations")
const readMigration = (name: string) => readFileSync(resolve(MIGRATIONS, name), "utf8")

describe("expectedArtifacts — synthetic", () => {
  test("CREATE INDEX is derived (the gap that let 1124/1126 pass partially)", () => {
    const a = expectedArtifacts("CREATE INDEX idx_foo ON foo(bar);")
    expect(a.indexes).toEqual(["idx_foo"])
    expect(a.unrecognized).toEqual([])
  })

  test("CREATE UNIQUE INDEX IF NOT EXISTS is derived", () => {
    const a = expectedArtifacts("CREATE UNIQUE INDEX IF NOT EXISTS idx_u ON t(c);")
    expect(a.indexes).toEqual(["idx_u"])
  })

  test("unrecognized DDL is recorded, not silently dropped", () => {
    const a = expectedArtifacts("CREATE TRIGGER trg AFTER INSERT ON t BEGIN SELECT 1; END;")
    // A trigger creates nothing this gate can COUNT, and mis-splitting on ';'
    // leaves fragments — all of which must land in `unrecognized`, never recognized.
    expect(a.tables).toEqual([])
    expect(a.columns).toEqual([])
    expect(a.indexes).toEqual([])
    expect(a.unrecognized.length).toBeGreaterThan(0)
  })

  test("DROP / data statements are unrecognized", () => {
    const a = expectedArtifacts("DROP TABLE old;\nUPDATE t SET x = 1;")
    expect(artifactCount(a)).toBe(0)
    expect(a.unrecognized).toContain("DROP TABLE old")
    expect(a.unrecognized).toContain("UPDATE t SET")
  })

  test("DROP INDEX is a checkable absence artifact", () => {
    const a = expectedArtifacts("DROP INDEX IF EXISTS idx_old;")
    expect(a.absentIndexes).toEqual(["idx_old"])
    expect(a.unrecognized).toEqual([])
    expect(artifactCount(a)).toBe(1)
  })

  test("commented-out DDL never becomes an artifact", () => {
    const a = expectedArtifacts("-- CREATE INDEX idx_ghost ON t(c);\nCREATE INDEX idx_real ON t(c);")
    expect(a.indexes).toEqual(["idx_real"])
  })
})

// The load-bearing tests: assert the EXACT artifacts derived from the real files
// the gate ships against. A silent parser regression here is a silent gate hole.
describe("expectedArtifacts — real migration files", () => {
  test("1124_community_job_checkpoints: 4 columns + 1 table + 4 indexes, nothing unrecognized", () => {
    const a = expectedArtifacts(readMigration("1124_community_job_checkpoints.sql"))
    expect(a.columns).toEqual([
      ["community_jobs", "last_checkpoint"],
      ["community_jobs", "last_checkpoint_at"],
      ["community_jobs", "attempt_started_at"],
      ["community_jobs", "attempt_deadline_at"],
    ])
    expect(a.tables).toEqual(["community_job_events"])
    expect(a.indexes).toEqual([
      "idx_community_jobs_running_deadline",
      "idx_community_jobs_running_checkpoint",
      "idx_community_job_events_job",
      "idx_community_job_events_community",
    ])
    expect(a.altered).toEqual(["community_jobs"])
    expect(a.unrecognized).toEqual([])
    expect(artifactCount(a)).toBe(9) // 4 + 1 + 4
  })

  test("1126_reward_qualification_outbox: 1 table + 1 index (the index was previously unchecked)", () => {
    const a = expectedArtifacts(readMigration("1126_reward_qualification_outbox.sql"))
    expect(a.tables).toEqual(["reward_qualification_outbox"])
    expect(a.indexes).toEqual(["idx_reward_qualification_outbox_sequence"])
    expect(a.columns).toEqual([])
    expect(a.unrecognized).toEqual([])
    expect(artifactCount(a)).toBe(2)
  })

  test("1127_asset_story_metadata_refs: 4 columns, nothing else", () => {
    const a = expectedArtifacts(readMigration("1127_asset_story_metadata_refs.sql"))
    expect(a.columns).toEqual([
      ["assets", "story_ip_metadata_uri"],
      ["assets", "story_ip_metadata_hash"],
      ["assets", "story_nft_metadata_uri"],
      ["assets", "story_nft_metadata_hash"],
    ])
    expect(a.tables).toEqual([])
    expect(a.indexes).toEqual([])
    expect(a.altered).toEqual(["assets"])
    expect(a.unrecognized).toEqual([])
    expect(artifactCount(a)).toBe(4)
  })

  test("1128_community_job_attempt_leases: 2 columns + 1 index", () => {
    const a = expectedArtifacts(readMigration("1128_community_job_attempt_leases.sql"))
    expect(a.columns).toEqual([
      ["community_jobs", "attempt_id"],
      ["community_jobs", "lease_expires_at"],
    ])
    expect(a.indexes).toEqual(["idx_community_jobs_running_lease"])
    expect(a.altered).toEqual(["community_jobs"])
    expect(a.unrecognized).toEqual([])
    expect(artifactCount(a)).toBe(3)
  })

  test("1129_story_registration_effects: journal table + 2 indexes", () => {
    const a = expectedArtifacts(readMigration("1129_story_registration_effects.sql"))
    expect(a.tables).toEqual(["story_registration_effects"])
    expect(a.indexes).toEqual([
      "idx_story_registration_effects_asset",
      "idx_story_registration_effects_reconciliation",
    ])
    expect(a.columns).toEqual([])
    expect(a.unrecognized).toEqual([])
    expect(artifactCount(a)).toBe(3)
  })

  test("1130_story_registration_effect_request_identity: 3 immutable request columns", () => {
    const a = expectedArtifacts(readMigration("1130_story_registration_effect_request_identity.sql"))
    expect(a.columns).toEqual([
      ["story_registration_effects", "chain_id"],
      ["story_registration_effects", "signer_address"],
      ["story_registration_effects", "call_data_hash"],
    ])
    expect(a.altered).toEqual(["story_registration_effects"])
    expect(a.unrecognized).toEqual([])
    expect(artifactCount(a)).toBe(3)
  })

  test("1130 executes on a populated SQLite table and backfills fail-closed sentinels", () => {
    const db = new Database(":memory:")
    try {
      db.exec("CREATE TABLE story_registration_effects (effect_key TEXT PRIMARY KEY)")
      db.exec("INSERT INTO story_registration_effects (effect_key) VALUES ('legacy-effect')")
      db.exec(readMigration("1130_story_registration_effect_request_identity.sql"))

      expect(db.query(`
        SELECT chain_id, signer_address, call_data_hash
        FROM story_registration_effects
        WHERE effect_key = 'legacy-effect'
      `).get()).toEqual({ chain_id: 0, signer_address: "", call_data_hash: "" })
    } finally {
      db.close()
    }
  })

  test("1133_multi_namespace_bindings: role column, replacement indexes, and removed legacy index", () => {
    const a = expectedArtifacts(readMigration("1133_multi_namespace_bindings.sql"))
    expect(a.columns).toEqual([["namespace_bindings", "namespace_role"]])
    expect(a.indexes).toEqual([
      "idx_namespace_bindings_active_primary_community",
      "idx_namespace_bindings_active_verification",
    ])
    expect(a.absentIndexes).toEqual(["idx_namespace_bindings_active_community"])
    expect(a.altered).toEqual(["namespace_bindings"])
    expect(a.unrecognized).toEqual([])
    expect(artifactCount(a)).toBe(4)
  })

  test("1134_story_settlement_coordinator_mirror: effect columns + transaction table + fencing indexes", () => {
    const a = expectedArtifacts(readMigration("1134_story_settlement_coordinator_mirror.sql"))
    expect(a.columns).toEqual([
      ["purchase_settlement_effects", "request_fingerprint"],
      ["purchase_settlement_effects", "coordinator_plan_ref"],
      ["purchase_settlement_effects", "coordinator_state"],
      ["purchase_settlement_effects", "coordinator_version"],
      ["purchase_settlement_effects", "reconciliation_reason"],
      ["purchase_settlement_effects", "last_reconciled_at"],
      ["purchase_settlement_effects", "finality_confirmed_at"],
    ])
    expect(a.tables).toEqual(["purchase_settlement_transactions"])
    expect(a.indexes).toEqual([
      "idx_purchase_settlement_transactions_effect_step",
      "idx_purchase_settlement_transactions_coordinator_step",
      "idx_purchase_settlement_transactions_signer_nonce",
    ])
    expect(a.altered).toEqual(["purchase_settlement_effects"])
    expect(a.unrecognized).toEqual([])
    expect(artifactCount(a)).toBe(11)
  })

  test("1135_namespace_handle_claim_gates: policy selectors + versioned expression table", () => {
    const a = expectedArtifacts(readMigration("1135_namespace_handle_claim_gates.sql"))
    expect(a.columns).toEqual([
      ["namespace_handle_policies", "claim_gate_mode"],
      ["namespace_handle_policies", "claim_gate_expression_ref"],
      ["namespace_handle_policies", "eligibility_timing"],
    ])
    expect(a.tables).toEqual(["namespace_handle_claim_gate_policies"])
    expect(a.indexes).toEqual(["idx_namespace_handle_claim_gate_policies_updated"])
    expect(a.altered).toEqual(["namespace_handle_policies"])
    expect(a.unrecognized).toEqual([])
    expect(artifactCount(a)).toBe(5)
  })
})
