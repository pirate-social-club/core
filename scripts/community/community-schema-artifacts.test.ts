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
  test("1140 repairs missing karaoke attempts and is replay-safe", () => {
    const migration = readMigration("1140_karaoke_attempts_schema_repair.sql")
    const a = expectedArtifacts(migration)
    expect(a.tables).toEqual(["karaoke_attempt"])
    expect(a.indexes).toEqual([
      "idx_karaoke_attempt_rank",
      "idx_karaoke_attempt_user_post",
    ])
    expect(a.unrecognized).toEqual([])

    const empty = new Database(":memory:")
    const existing = new Database(":memory:")
    try {
      empty.exec("CREATE TABLE communities (community_id TEXT PRIMARY KEY)")
      empty.exec("CREATE TABLE posts (post_id TEXT PRIMARY KEY)")
      empty.exec(migration)
      expect(empty.query("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'karaoke_attempt'").get()).toEqual({ name: "karaoke_attempt" })

      existing.exec("CREATE TABLE communities (community_id TEXT PRIMARY KEY)")
      existing.exec("CREATE TABLE posts (post_id TEXT PRIMARY KEY)")
      existing.exec(migration)
      existing.exec(migration)
      expect(existing.query("SELECT COUNT(*) AS count FROM pragma_index_list('karaoke_attempt') WHERE name IN ('idx_karaoke_attempt_rank', 'idx_karaoke_attempt_user_post')").get()).toEqual({ count: 2 })
    } finally {
      empty.close()
      existing.close()
    }
  })

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

  test("1136_community_handle_label_reservations: shared acquisition mutex", () => {
    const a = expectedArtifacts(readMigration("1136_community_handle_label_reservations.sql"))
    expect(a.columns).toEqual([])
    expect(a.tables).toEqual(["community_handle_label_reservations"])
    expect(a.indexes).toEqual([
      "idx_community_handle_label_reservations_active_label",
      "idx_community_handle_label_reservations_active_expiry",
    ])
    expect(a.altered).toEqual([])
    expect(a.unrecognized).toEqual([])
    expect(artifactCount(a)).toBe(3)
  })

  test("1137_community_handle_payment_reservation_cap: one active payment per user", () => {
    const a = expectedArtifacts(readMigration("1137_community_handle_payment_reservation_cap.sql"))
    expect(a.columns).toEqual([])
    expect(a.tables).toEqual([])
    expect(a.indexes).toEqual(["idx_community_handle_label_reservations_active_payment_user"])
    expect(a.altered).toEqual([])
    expect(a.unrecognized).toEqual([])
    expect(artifactCount(a)).toBe(1)
  })

  test("1141_namespace_handle_policy_revision: one revision column", () => {
    const a = expectedArtifacts(readMigration("1141_namespace_handle_policy_revision.sql"))
    expect(a.columns).toEqual([["namespace_handle_policies", "revision"]])
    expect(a.altered).toEqual(["namespace_handle_policies"])
    expect(a.unrecognized).toEqual([])
    expect(artifactCount(a)).toBe(1)
  })

  test("1141 backfills existing namespace policies at revision one", () => {
    const db = new Database(":memory:")
    try {
      db.exec("CREATE TABLE namespace_handle_policies (namespace_handle_policy_id TEXT PRIMARY KEY)")
      db.exec("INSERT INTO namespace_handle_policies VALUES ('policy-1')")
      db.exec(readMigration("1141_namespace_handle_policy_revision.sql"))

      expect(db.query("SELECT revision FROM namespace_handle_policies").get()).toEqual({ revision: 1 })
    } finally {
      db.close()
    }
  })

  test("1142_song_study_sessions: session tables and logical attempt identity", () => {
    const a = expectedArtifacts(readMigration("1142_song_study_sessions.sql"))
    expect(a.columns).toEqual([
      ["song_study_attempt", "study_session_id"],
      ["song_study_attempt", "presentation_number"],
    ])
    expect(a.tables).toEqual(["song_study_session", "song_study_session_exercise"])
    expect(a.indexes).toEqual([
      "idx_song_study_session_active",
      "idx_song_study_session_expiry",
      "idx_song_study_session_exercise_queue",
      "idx_song_study_attempt_session_presentation",
    ])
    expect(a.altered).toEqual(["song_study_attempt"])
    expect(a.unrecognized).toEqual([])
    expect(artifactCount(a)).toBe(8)
  })

  test("1143_lyrics_language: 6 columns on posts, nothing else", () => {
    const a = expectedArtifacts(readMigration("1143_lyrics_language.sql"))
    expect(a.columns).toEqual([
      ["posts", "lyrics_language"],
      ["posts", "lyrics_language_confidence"],
      ["posts", "lyrics_language_reliable"],
      ["posts", "lyrics_language_detector"],
      ["posts", "lyrics_language_detected_at"],
      ["posts", "lyrics_language_source_hash"],
    ])
    expect(a.tables).toEqual([])
    expect(a.indexes).toEqual([])
    expect(a.altered).toEqual(["posts"])
    expect(a.unrecognized).toEqual([])
    expect(artifactCount(a)).toBe(6)
  })

  test("1151_song_study_orchestration_v2: durable orchestration state and snapshots", () => {
    const a = expectedArtifacts(readMigration("1151_song_study_orchestration_v2.sql"))
    expect(a.columns).toEqual([
      ["song_study_session", "session_revision"],
      ["song_study_session", "current_exercise_id"],
      ["song_study_session", "completion_reason"],
      ["song_study_session_exercise", "appearance_ordinal"],
      ["song_study_session_exercise", "appearance_attempt_count"],
      ["song_study_session_exercise", "lesson_resolved"],
      ["song_study_session_exercise", "last_served_index"],
      ["song_study_session_exercise", "qualifies_for_reward"],
    ])
    expect(a.tables).toEqual([
      "song_study_ungradable_receipt",
      "song_study_attempt_response",
    ])
    expect(a.indexes).toEqual(["idx_song_study_attempt_response_session"])
    expect(a.altered).toEqual(["song_study_session", "song_study_session_exercise"])
    expect(a.unrecognized).toEqual([
      "UPDATE song_study_session SET",
      "UPDATE song_study_session_exercise SET",
      "UPDATE song_study_session_exercise SET",
    ])
    expect(artifactCount(a)).toBe(11)
  })

  test("1143_lyrics_language: applies cleanly and defaults are inert", () => {
    const db = new Database(":memory:")
    try {
      db.exec("CREATE TABLE posts (post_id TEXT PRIMARY KEY)")
      db.exec(readMigration("1143_lyrics_language.sql"))
      db.exec("INSERT INTO posts (post_id) VALUES ('pst_1')")
      expect(
        db.query(`SELECT lyrics_language, lyrics_language_confidence, lyrics_language_reliable,
                         lyrics_language_detector, lyrics_language_detected_at, lyrics_language_source_hash
                  FROM posts WHERE post_id = 'pst_1'`).get(),
      ).toEqual({
        lyrics_language: null,
        lyrics_language_confidence: null,
        // Never default-reliable: a row with no detection evidence must read as unverified.
        lyrics_language_reliable: 0,
        lyrics_language_detector: null,
        lyrics_language_detected_at: null,
        lyrics_language_source_hash: null,
      })
    } finally {
      db.close()
    }
  })
})
