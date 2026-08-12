import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

import { SPEC as OUTBOX_SPEC } from "../apply-reward-outbox-d1-migration"
import { SPEC as STORY_SPEC } from "../apply-story-metadata-refs-d1-migration"
import { SPEC as STUDY_RUN_SPEC } from "../apply-song-study-generation-runs-d1-migration"
import { SPEC as SETTLEMENT_RECOVERY_SPEC } from "../apply-paid-purchase-settlement-recovery-d1-migration"
import { SPEC as MULTI_NAMESPACE_SPEC } from "../apply-multi-namespace-bindings-d1-migration"
import { SPEC as STORY_SETTLEMENT_MIRROR_SPEC } from "../apply-story-settlement-coordinator-mirror-d1-migration"
import {
  BLOCKING_STATUSES,
  classificationSql,
  classifyRow,
  executionBody,
  isTransientWranglerFailure,
  ledgerBackfillBody,
  resumeDoneShards,
  resumeEntryKey,
  selectMigrationBindings,
  type MigrationSpec,
} from "./fleet-d1-migration"

const CHECKSUM = "a".repeat(64)

const MIGRATIONS_DIR = resolve(import.meta.dir, "../../../db/community-template/migrations")

describe("wrangler transport retry classification", () => {
  test("retries transient transport and overload failures", () => {
    expect(isTransientWranglerFailure('{"error":{"text":"fetch failed"}}')).toBe(true)
    expect(isTransientWranglerFailure(`${"warning ".repeat(200)}fetch failed`)).toBe(true)
    expect(isTransientWranglerFailure("Cloudflare code 7429")).toBe(true)
    expect(isTransientWranglerFailure("Authentication error [code: 10000]")).toBe(true)
    expect(isTransientWranglerFailure("no such table: posts")).toBe(false)
  })
})

describe("quarantined single-shard remediation", () => {
  const input = {
    liveBindings: ["DB_CMTY_0001"],
    quarantinedTargets: [{
      binding: "DB_CMTY_0092",
      databaseName: "community-d1-pool-0092-prod",
    }],
  }

  test("refuses a quarantined --only target without the explicit repair flag", () => {
    expect(() => selectMigrationBindings({
      ...input,
      only: "community-d1-pool-0092-prod",
      repairQuarantinedOnly: false,
    })).toThrow("targets quarantined binding DB_CMTY_0092")
  })

  test("adds only the named quarantined binding for repair", () => {
    expect(selectMigrationBindings({
      ...input,
      only: "community-d1-pool-0092-prod",
      repairQuarantinedOnly: true,
    })).toEqual({
      bindings: ["DB_CMTY_0001", "DB_CMTY_0092"],
      repairedQuarantineBinding: "DB_CMTY_0092",
    })
  })

  test("refuses to use the repair flag for a non-quarantined target", () => {
    expect(() => selectMigrationBindings({
      ...input,
      only: "community-d1-pool-0001-prod",
      repairQuarantinedOnly: true,
    })).toThrow("is not explicitly quarantined")
  })
})

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

  test("1134 keeps the effect mirror, transaction journal, fencing indexes, and ledger together", () => {
    const body = executionBody(
      realMigration(STORY_SETTLEMENT_MIRROR_SPEC),
      STORY_SETTLEMENT_MIRROR_SPEC,
      CHECKSUM,
    )
    expect(body).toContain("ADD COLUMN request_fingerprint")
    expect(body).toContain("ADD COLUMN coordinator_plan_ref")
    expect(body).toContain("CREATE TABLE purchase_settlement_transactions")
    expect(body).toContain("idx_purchase_settlement_transactions_effect_step")
    expect(body).toContain("idx_purchase_settlement_transactions_coordinator_step")
    expect(body).toContain("idx_purchase_settlement_transactions_signer_nonce")
    expect(body).toContain("1134_story_settlement_coordinator_mirror.sql")
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

describe("ledgerBackfillBody", () => {
  test("keeps an optional data repair and ledger write together", () => {
    const spec: MigrationSpec = {
      ...OUTBOX_SPEC,
      ledgerBackfillSql: "UPDATE posts SET updated_at = updated_at WHERE post_id = 'repair';",
    }
    const body = ledgerBackfillBody(spec, CHECKSUM)

    expect(body.indexOf("UPDATE posts")).toBeLessThan(body.indexOf("INSERT INTO schema_migrations"))
    expect(body).toContain(CHECKSUM)
  })

  test("uses only the ledger write when no repair is configured", () => {
    expect(ledgerBackfillBody(OUTBOX_SPEC, CHECKSUM)).toBe(
      `INSERT INTO schema_migrations (migration_name, migration_label, checksum) VALUES ('${OUTBOX_SPEC.migration}', '${OUTBOX_SPEC.label}', '${CHECKSUM}');\n`,
    )
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

function bareStorySettlementMirrorRow(overrides: Record<string, number | string> = {}) {
  return {
    has_ledger: 1,
    ledger_checksum: "",
    req_purchase_settlement_effects: 1,
    obj_purchase_settlement_effects__request_fingerprint: 0,
    obj_purchase_settlement_effects__coordinator_plan_ref: 0,
    obj_purchase_settlement_effects__coordinator_state: 0,
    obj_purchase_settlement_effects__coordinator_version: 0,
    obj_purchase_settlement_effects__reconciliation_reason: 0,
    obj_purchase_settlement_effects__last_reconciled_at: 0,
    obj_purchase_settlement_effects__finality_confirmed_at: 0,
    obj_purchase_settlement_transactions__purchase_settlement_transaction_id: 0,
    obj_purchase_settlement_transactions__purchase_settlement_effect_id: 0,
    obj_purchase_settlement_transactions__step_key: 0,
    obj_purchase_settlement_transactions__step_kind: 0,
    obj_purchase_settlement_transactions__ordinal: 0,
    obj_purchase_settlement_transactions__call_identity_hash: 0,
    obj_purchase_settlement_transactions__coordinator_step_ref: 0,
    obj_purchase_settlement_transactions__state: 0,
    obj_purchase_settlement_transactions__chain_id: 0,
    obj_purchase_settlement_transactions__signer_address: 0,
    obj_purchase_settlement_transactions__nonce: 0,
    obj_purchase_settlement_transactions__tx_hash: 0,
    obj_purchase_settlement_transactions__block_number: 0,
    obj_purchase_settlement_transactions__block_hash: 0,
    obj_purchase_settlement_transactions__attempt_count: 0,
    obj_purchase_settlement_transactions__last_error_code: 0,
    obj_purchase_settlement_transactions__prepared_at: 0,
    obj_purchase_settlement_transactions__broadcast_at: 0,
    obj_purchase_settlement_transactions__mined_at: 0,
    obj_purchase_settlement_transactions__confirmed_at: 0,
    obj_purchase_settlement_transactions__updated_at: 0,
    obj_index__idx_purchase_settlement_transactions_effect_step: 0,
    obj_index__idx_purchase_settlement_transactions_coordinator_step: 0,
    obj_index__idx_purchase_settlement_transactions_signer_nonce: 0,
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

describe("classifyRow — 1134 Story settlement coordinator mirror", () => {
  test("a partially-created transaction mirror blocks fleet rollout", () => {
    const result = classifyRow(
      STORY_SETTLEMENT_MIRROR_SPEC,
      bareStorySettlementMirrorRow({
        obj_purchase_settlement_effects__request_fingerprint: 1,
        obj_purchase_settlement_effects__coordinator_plan_ref: 1,
        obj_index__idx_purchase_settlement_transactions_effect_step: 1,
      }),
      CHECKSUM,
    )
    expect(result.status).toBe("partial_objects")
    expect(result.detail).toContain("purchase_settlement_effects__request_fingerprint")
    expect(result.detail).toContain("index__idx_purchase_settlement_transactions_effect_step")
  })

  test("all mirror objects with no ledger row backfill the ledger without replaying DDL", () => {
    const present = Object.fromEntries(
      Object.keys(bareStorySettlementMirrorRow())
        .filter((key) => key.startsWith("obj_"))
        .map((key) => [key, 1]),
    )
    expect(
      classifyRow(STORY_SETTLEMENT_MIRROR_SPEC, bareStorySettlementMirrorRow(present), CHECKSUM),
    ).toEqual({ status: "needs_ledger_backfill" })
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
  test("combines tables, indexes, columns, and fragments across rebuilt tables", () => {
    const spec: MigrationSpec = {
      migration: "9999_composite.sql",
      label: "community-template",
      requiredTables: ["attempts", "review_state"],
      creates: {
        kind: "schema_objects",
        columns: [{ table: "attempts", column: "placements_json" }],
        indexes: ["idx_cloze_status"],
        finalIndexes: ["idx_attempts_lookup"],
        tables: ["cloze"],
        tableSqlContains: [
          { table: "attempts", fragments: ["'fill_blank'"] },
          { table: "review_state", fragments: ["'fill_blank'"] },
        ],
      },
      rowCountTables: ["attempts"],
      replayableDdl: false,
      description: "test",
    }
    const sql = classificationSql(spec)
    expect(sql).toContain("obj_table_fragment__attempts__0")
    expect(sql).toContain("obj_table_fragment__review_state__0")
    expect(sql).toContain("metric_rows__attempts")
    expect(classifyRow(spec, {
      has_ledger: 1,
      ledger_checksum: CHECKSUM,
      req_attempts: 1,
      req_review_state: 1,
      obj_attempts__placements_json: 1,
      obj_index__idx_cloze_status: 1,
      obj_table__cloze: 1,
      obj_table_fragment__attempts__0: 1,
      obj_table_fragment__review_state__0: 0,
      final_index__idx_attempts_lookup: 1,
    }, CHECKSUM).status).toBe("partial_objects")
  })

  test("can attest a required fragment in canonical table SQL", () => {
    const spec: MigrationSpec = {
      migration: "1037_rebuild_comments_guest_authorship.sql",
      label: "community-template",
      requiredTables: ["comments"],
      creates: { kind: "table_sql_contains", table: "comments", fragments: ["'guest'"] },
      replayableDdl: true,
      description: "test",
    }
    const sql = classificationSql(spec)
    expect(sql).toContain("name='comments'")
    expect(sql).toContain("instr(lower(sql), lower('''guest''')) > 0")
    expect(classifyRow(spec, {
      has_ledger: 1,
      ledger_checksum: CHECKSUM,
      req_comments: 1,
      obj_fragment__0: 1,
    }, CHECKSUM)).toEqual({ status: "ok_recorded" })
  })

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

describe("resume file — keyed by migration AND shard", () => {
  const M1095 = "1095_community_assistant_telegram_preview_prompt_suffix.sql"
  const M1096 = "1096_community_karaoke_enabled.sql"
  const SHARD = "community-d1-pool-0078-prod"

  test("REGRESSION 2026-08-04: a keyed entry for ANOTHER migration must not skip this spec", () => {
    // The incident: pass 1 (1095) appended the shard to a shared resume file;
    // passes 2 and 3 (1096, 1098) then classified ZERO shards and reported
    // empty summaries over a shard still missing five columns.
    const contents = `${M1095}\t${SHARD}\n`
    const done = resumeDoneShards(contents, M1096)
    expect(done.has(SHARD)).toBe(false)
    expect(done.size).toBe(0)
  })

  test("a keyed entry for the CURRENT migration skips exactly that shard", () => {
    const contents = [
      `${M1095}\t${SHARD}`,
      `${M1096}\t${SHARD}`,
      `${M1096}\tcommunity-d1-pool-0079-prod`,
      "",
    ].join("\n")
    const done = resumeDoneShards(contents, M1096)
    expect([...done].sort()).toEqual(["community-d1-pool-0078-prod", "community-d1-pool-0079-prod"])
  })

  test("a bare shard-only line from a pre-keyed runner matches NOTHING", () => {
    // Legacy files lose skip power rather than being misparsed. Safe:
    // classification is idempotent; ok_recorded shards are never re-written.
    expect(resumeDoneShards(`${SHARD}\n`, M1096).size).toBe(0)
  })

  test("mixed legacy, other-migration, and current-migration lines: only current keyed lines count", () => {
    const contents = [
      "community-d1-pool-0001-prod", // legacy bare name
      `${M1095}\tcommunity-d1-pool-0002-prod`, // done for a different spec
      `${M1096}\tcommunity-d1-pool-0003-prod`, // done for THIS spec
    ].join("\n")
    const done = resumeDoneShards(contents, M1096)
    expect(done.size).toBe(1)
    expect(done.has("community-d1-pool-0003-prod")).toBe(true)
  })

  test("the write format is migration + tab + shard, and it round-trips", () => {
    const key = resumeEntryKey(M1096, SHARD)
    expect(key).toBe(`${M1096}\t${SHARD}`)
    expect(key).not.toBe(SHARD) // never a bare name
    // Single-spec crash-resume is unchanged: same migration + shard still skips.
    expect(resumeDoneShards(`${key}\n`, M1096).has(SHARD)).toBe(true)
  })
})
