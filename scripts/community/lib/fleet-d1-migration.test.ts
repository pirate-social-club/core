import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

import { SPEC as OUTBOX_SPEC } from "../apply-reward-outbox-d1-migration"
import { SPEC as STORY_SPEC } from "../apply-story-metadata-refs-d1-migration"
import { SPEC as STUDY_RUN_SPEC } from "../apply-song-study-generation-runs-d1-migration"
import { SPEC as SETTLEMENT_RECOVERY_SPEC } from "../apply-paid-purchase-settlement-recovery-d1-migration"
import { SPEC as MULTI_NAMESPACE_SPEC } from "../apply-multi-namespace-bindings-d1-migration"
import {
  BLOCKING_STATUSES,
  classificationSql,
  classifyRow,
  executionBody,
  type MigrationSpec,
} from "./fleet-d1-migration"

const CHECKSUM = "a".repeat(64)

const MIGRATIONS_DIR = resolve(import.meta.dir, "../../../db/community-template/migrations")

/** Read the REAL migration off disk, so this test cannot drift from what ships. */
function realMigration(spec: MigrationSpec): string {
  return readFileSync(resolve(MIGRATIONS_DIR, spec.migration), "utf8")
}

describe("executionBody — the exact bytes sent to D1", () => {
  // Regression: an earlier version split the SQL on ";" and dropped any segment whose
  // trimmed text began with "--". That silently discarded the FIRST statement of any
  // migration opening with a comment. 1126 opens with a comment, so its CREATE TABLE
  // vanished and only the CREATE INDEX survived — which would have failed on all 93
  // production shards. Assert against the real files, not a fixture.
  test("1126 keeps its CREATE TABLE even though the file opens with comments", () => {
    const sql = realMigration(OUTBOX_SPEC)
    expect(sql.trimStart().startsWith("--")).toBe(true) // the precondition that broke it

    const body = executionBody(sql, OUTBOX_SPEC, CHECKSUM)
    expect(body).toContain("CREATE TABLE reward_qualification_outbox")
    expect(body).toContain("CREATE INDEX idx_reward_qualification_outbox_sequence")
    expect(body).toContain("INSERT INTO schema_migrations")
    expect(body).toContain("1126_reward_qualification_outbox.sql")
  })

  test("1127 keeps every ALTER TABLE", () => {
    const sql = realMigration(STORY_SPEC)
    const body = executionBody(sql, STORY_SPEC, CHECKSUM)
    for (const column of STORY_SPEC.creates.kind === "columns" ? STORY_SPEC.creates.columns : []) {
      expect(body).toContain(`ADD COLUMN ${column}`)
    }
    expect(body).toContain("INSERT INTO schema_migrations")
  })

  test("1131 keeps the durable run table, index, and ledger write together", () => {
    const body = executionBody(realMigration(STUDY_RUN_SPEC), STUDY_RUN_SPEC, CHECKSUM)
    expect(body).toContain("CREATE TABLE song_study_generation_run")
    expect(body).toContain("CREATE INDEX idx_song_study_generation_run_status")
    expect(body).toContain("1131_song_study_generation_runs.sql")
  })

  test("1132 keeps quote freeze, effect disposition, recovery index, and ledger together", () => {
    const body = executionBody(realMigration(SETTLEMENT_RECOVERY_SPEC), SETTLEMENT_RECOVERY_SPEC, CHECKSUM)
    expect(body).toContain("ADD COLUMN funding_locked_at")
    expect(body).toContain("ADD COLUMN failure_disposition")
    expect(body).toContain("ADD COLUMN broadcast_tx_ref")
    expect(body).toContain("CREATE INDEX idx_purchase_settlement_effects_parent_recovery")
    expect(body).toContain("1132_paid_purchase_settlement_recovery.sql")
  })

  test("1133 attests its role column and both replacement indexes", () => {
    const sql = classificationSql(MULTI_NAMESPACE_SPEC)
    expect(sql).toContain("obj_namespace_bindings__namespace_role")
    expect(sql).toContain("obj_index__idx_namespace_bindings_active_primary_community")
    expect(sql).toContain("obj_index__idx_namespace_bindings_active_verification")
  })

  test("the migration SQL is passed through verbatim — never parsed or rewritten", () => {
    const sql = realMigration(OUTBOX_SPEC)
    const body = executionBody(sql, OUTBOX_SPEC, CHECKSUM)
    // Everything before the appended ledger line is byte-identical to the trimmed file.
    expect(body.startsWith(sql.trim())).toBe(true)
    // Comments survive: they are valid SQL and there is no reason to touch the file.
    expect(body).toContain("-- Append-only")
  })

  test("the ledger INSERT is appended so schema and ledger move together", () => {
    const body = executionBody(realMigration(OUTBOX_SPEC), OUTBOX_SPEC, CHECKSUM)
    expect(body.indexOf("CREATE TABLE")).toBeLessThan(body.indexOf("INSERT INTO schema_migrations"))
    expect(body).toContain(CHECKSUM)
  })
})

/** A shard where nothing has been applied yet. */
function bareOutboxRow(overrides: Record<string, number | string> = {}) {
  return {
    has_ledger: 1,
    ledger_checksum: "",
    req_posts: 1,
    req_communities: 1,
    obj_reward_qualification_outbox: 0,
    ...overrides,
  }
}

function bareStoryRow(overrides: Record<string, number | string> = {}) {
  return {
    has_ledger: 1,
    ledger_checksum: "",
    req_assets: 1,
    obj_story_ip_metadata_uri: 0,
    obj_story_ip_metadata_hash: 0,
    obj_story_nft_metadata_uri: 0,
    obj_story_nft_metadata_hash: 0,
    ...overrides,
  }
}

function bareSettlementRecoveryRow(overrides: Record<string, number | string> = {}) {
  return {
    has_ledger: 1,
    ledger_checksum: "",
    req_purchase_quotes: 1,
    req_purchase_settlement_effects: 1,
    obj_purchase_quotes__funding_locked_at: 0,
    obj_purchase_settlement_effects__failure_disposition: 0,
    obj_purchase_settlement_effects__broadcast_tx_ref: 0,
    ...overrides,
  }
}

function bareMultiNamespaceRow(overrides: Record<string, number | string> = {}) {
  return {
    has_ledger: 1,
    ledger_checksum: "",
    req_namespace_bindings: 1,
    obj_namespace_bindings__namespace_role: 0,
    obj_index__idx_namespace_bindings_active_primary_community: 0,
    obj_index__idx_namespace_bindings_active_verification: 0,
    ...overrides,
  }
}

describe("classifyRow — 1133 mixed schema objects", () => {
  test("a role column without both replacement indexes is a blocking partial state", () => {
    expect(classifyRow(MULTI_NAMESPACE_SPEC, bareMultiNamespaceRow({
      obj_namespace_bindings__namespace_role: 1,
      obj_index__idx_namespace_bindings_active_primary_community: 1,
    }), CHECKSUM)).toEqual({
      status: "partial_objects",
      detail: "present: namespace_bindings__namespace_role, index__idx_namespace_bindings_active_primary_community",
    })
  })
})

describe("classifyRow — 1126 reward outbox (CREATE TABLE)", () => {
  test("no ledger and no table: apply DDL + ledger", () => {
    expect(classifyRow(OUTBOX_SPEC, bareOutboxRow(), CHECKSUM)).toEqual({ status: "needs_migration" })
  })

  test("table present but ledger missing: backfill the LEDGER ONLY, never replay CREATE TABLE", () => {
    // Replaying `CREATE TABLE` here would fail with "table already exists" and, worse,
    // an operator might then delete the table to make the script pass.
    expect(classifyRow(OUTBOX_SPEC, bareOutboxRow({ obj_reward_qualification_outbox: 1 }), CHECKSUM))
      .toEqual({ status: "needs_ledger_backfill" })
  })

  test("ledger + table + matching checksum: nothing to do", () => {
    const row = bareOutboxRow({ obj_reward_qualification_outbox: 1, ledger_checksum: CHECKSUM })
    expect(classifyRow(OUTBOX_SPEC, row, CHECKSUM)).toEqual({ status: "ok_recorded" })
  })

  test("ledger says applied but the table is absent: refuse", () => {
    const row = bareOutboxRow({ ledger_checksum: CHECKSUM })
    expect(classifyRow(OUTBOX_SPEC, row, CHECKSUM).status).toBe("ledger_without_objects")
  })

  test("ledger records a DIFFERENT 1126: refuse", () => {
    const row = bareOutboxRow({ obj_reward_qualification_outbox: 1, ledger_checksum: "b".repeat(64) })
    expect(classifyRow(OUTBOX_SPEC, row, CHECKSUM).status).toBe("checksum_mismatch")
  })

  test("a required FK parent is missing: refuse rather than create a dangling table", () => {
    expect(classifyRow(OUTBOX_SPEC, bareOutboxRow({ req_posts: 0 }), CHECKSUM).status).toBe("schema_not_ready")
    expect(classifyRow(OUTBOX_SPEC, bareOutboxRow({ req_communities: 0 }), CHECKSUM).status).toBe("schema_not_ready")
  })

  test("no schema_migrations ledger at all: refuse", () => {
    expect(classifyRow(OUTBOX_SPEC, bareOutboxRow({ has_ledger: 0 }), CHECKSUM).status).toBe("schema_not_ready")
  })
})

describe("classifyRow — 1127 story metadata refs (ADD COLUMN)", () => {
  test("no ledger and no columns: apply DDL + ledger", () => {
    expect(classifyRow(STORY_SPEC, bareStoryRow(), CHECKSUM)).toEqual({ status: "needs_migration" })
  })

  test("all columns present but ledger missing: backfill the LEDGER ONLY", () => {
    const row = bareStoryRow({
      obj_story_ip_metadata_uri: 1,
      obj_story_ip_metadata_hash: 1,
      obj_story_nft_metadata_uri: 1,
      obj_story_nft_metadata_hash: 1,
    })
    expect(classifyRow(STORY_SPEC, row, CHECKSUM)).toEqual({ status: "needs_ledger_backfill" })
  })

  test("SOME columns present: refuse — a partial shard is not understood", () => {
    const row = bareStoryRow({ obj_story_ip_metadata_uri: 1, obj_story_ip_metadata_hash: 1 })
    const result = classifyRow(STORY_SPEC, row, CHECKSUM)
    expect(result.status).toBe("partial_objects")
    expect(result.detail).toContain("story_ip_metadata_uri")
  })
})

describe("classifyRow — 1132 columns across tables", () => {
  test("all columns absent applies the migration", () => {
    expect(classifyRow(SETTLEMENT_RECOVERY_SPEC, bareSettlementRecoveryRow(), CHECKSUM))
      .toEqual({ status: "needs_migration" })
  })

  test("a cross-table partial application is blocking", () => {
    const result = classifyRow(SETTLEMENT_RECOVERY_SPEC, bareSettlementRecoveryRow({
      obj_purchase_quotes__funding_locked_at: 1,
      obj_purchase_settlement_effects__failure_disposition: 1,
    }), CHECKSUM)
    expect(result.status).toBe("partial_objects")
    expect(result.detail).toContain("purchase_quotes__funding_locked_at")
  })
})

describe("classificationSql", () => {
  test("probes a CREATE TABLE migration via sqlite_master", () => {
    const sql = classificationSql(OUTBOX_SPEC)
    expect(sql).toContain("name='reward_qualification_outbox'") // object presence
    expect(sql).toContain("name='posts'") // required FK parent
    expect(sql).toContain("name='communities'")
    expect(sql).toContain("migration_name='1126_reward_qualification_outbox.sql'")
  })

  test("probes an ADD COLUMN migration via pragma_table_info", () => {
    const sql = classificationSql(STORY_SPEC)
    expect(sql).toContain("pragma_table_info('assets')")
    expect(sql).toContain("name='story_ip_metadata_uri'")
  })

  test("probes the 1131 table and both required FK parents", () => {
    const sql = classificationSql(STUDY_RUN_SPEC)
    expect(sql).toContain("name='song_study_generation_run'")
    expect(sql).toContain("name='posts'")
    expect(sql).toContain("name='community_jobs'")
    expect(sql).toContain("migration_name='1131_song_study_generation_runs.sql'")
  })

  test("probes 1132 columns across both commerce tables", () => {
    const sql = classificationSql(SETTLEMENT_RECOVERY_SPEC)
    expect(sql).toContain("pragma_table_info('purchase_quotes')")
    expect(sql).toContain("name='funding_locked_at'")
    expect(sql).toContain("pragma_table_info('purchase_settlement_effects')")
    expect(sql).toContain("name='failure_disposition'")
    expect(sql).toContain("name='broadcast_tx_ref'")
  })
})

describe("BLOCKING_STATUSES", () => {
  test("every not-understood state fails the run rather than being skipped", () => {
    // Silently skipping a live shard is how a fleet migration lies about its coverage.
    for (const status of [
      "checksum_mismatch",
      "ledger_without_objects",
      "partial_objects",
      "schema_not_ready",
      "missing_from_config",
      "error",
    ] as const) {
      expect(BLOCKING_STATUSES).toContain(status)
    }
    expect(BLOCKING_STATUSES).not.toContain("ok_recorded")
    expect(BLOCKING_STATUSES).not.toContain("needs_migration")
  })
})
