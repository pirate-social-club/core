import { describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

import { SPECS } from "./apply-karaoke-policy-columns-d1-migration"
import {
  BLOCKING_STATUSES,
  classificationSql,
  classifyRow,
  type MigrationSpec,
} from "./lib/fleet-d1-migration"

const MIGRATIONS_DIR = resolve(import.meta.dir, "../../db/community-template/migrations")
const [TELEGRAM, KARAOKE_ENABLED, KARAOKE_POLICY] = SPECS

/** Read the REAL migration off disk, so this test cannot drift from what ships. */
function realSql(spec: MigrationSpec): string {
  return readFileSync(resolve(MIGRATIONS_DIR, spec.migration), "utf8")
}

function checksumOf(spec: MigrationSpec): string {
  return createHash("sha256").update(realSql(spec)).digest("hex")
}

/** The DB_CMTY_0078/0079 shape: ledger at the head, but no row and no objects for this block. */
function bareRow(spec: MigrationSpec, overrides: Record<string, number | string> = {}) {
  const objects: Record<string, number> = {}
  if (spec.creates.kind === "columns") {
    for (const column of spec.creates.columns) objects[`obj_${column}`] = 0
  }
  return {
    has_ledger: 1,
    ledger_checksum: "",
    ...Object.fromEntries(spec.requiredTables.map((table) => [`req_${table}`, 1])),
    ...objects,
    ...overrides,
  }
}

function allObjectsPresent(spec: MigrationSpec): Record<string, number> {
  if (spec.creates.kind !== "columns") throw new Error("columns spec expected")
  return Object.fromEntries(spec.creates.columns.map((column) => [`obj_${column}`, 1]))
}

describe("karaoke policy columns fleet repair — the specs match the real files", () => {
  test("targets the contiguous 1095 -> 1098 block in order (1097 does not exist)", () => {
    expect(SPECS.map((spec) => spec.migration)).toEqual([
      "1095_community_assistant_telegram_preview_prompt_suffix.sql",
      "1096_community_karaoke_enabled.sql",
      "1098_community_karaoke_scoring_policy.sql",
    ])
    for (const spec of SPECS) {
      expect(spec.replayableDdl).toBe(false) // plain ADD COLUMN: never replay, backfill ledger only
      // No ledgerBackfillSql: a ledger row without objects must stay BLOCKING,
      // not get papered over by a repair write.
      expect(spec.ledgerBackfillSql).toBeUndefined()
    }
  })

  test("every attested column is an ADD COLUMN in the real migration file", () => {
    for (const spec of SPECS) {
      if (spec.creates.kind !== "columns") throw new Error("columns spec expected")
      const sql = realSql(spec)
      for (const column of spec.creates.columns) {
        expect(sql).toContain(`ALTER TABLE ${spec.creates.table}`)
        expect(sql).toContain(`ADD COLUMN ${column}`)
      }
      expect(spec.requiredTables).toEqual([spec.creates.table])
    }
    expect(TELEGRAM.creates.kind === "columns" && TELEGRAM.creates.table).toBe("community_assistant_policy")
    expect(KARAOKE_ENABLED.creates.kind === "columns" && KARAOKE_ENABLED.creates.table).toBe("communities")
    expect(KARAOKE_POLICY.creates.kind === "columns" && KARAOKE_POLICY.creates.columns).toEqual([
      "karaoke_scoring_enabled",
      "karaoke_stt_provider",
      "karaoke_stt_model",
      "karaoke_voice_coach_enabled",
      "karaoke_audio_retention",
    ])
  })

  test("the classification probe reads the ledger and pragma_table_info for each column", () => {
    const sql = classificationSql(KARAOKE_POLICY)
    expect(sql).toContain("migration_name='1098_community_karaoke_scoring_policy.sql'")
    expect(sql).toContain("pragma_table_info('communities')")
    for (const column of ["karaoke_scoring_enabled", "karaoke_stt_provider", "karaoke_stt_model", "karaoke_voice_coach_enabled", "karaoke_audio_retention"]) {
      expect(sql).toContain(`name='${column}'`)
    }
    expect(classificationSql(TELEGRAM)).toContain("pragma_table_info('community_assistant_policy')")
  })
})

describe("karaoke policy columns fleet repair — classification", () => {
  test("a healthy shard classifies ok_recorded for all three", () => {
    for (const spec of SPECS) {
      const checksum = checksumOf(spec)
      const row = bareRow(spec, { ...allObjectsPresent(spec), ledger_checksum: checksum })
      expect(classifyRow(spec, row, checksum)).toEqual({ status: "ok_recorded" })
    }
  })

  test("DB_CMTY_0078/0079-style shards classify needs_migration for all three", () => {
    // No ledger row, no columns — but the required tables exist because the rest
    // of the ledger is at the head.
    for (const spec of SPECS) {
      expect(classifyRow(spec, bareRow(spec), checksumOf(spec))).toEqual({ status: "needs_migration" })
    }
  })

  test("a 1095 ledger row without the column is ledger_without_objects and BLOCKING", () => {
    const checksum = checksumOf(TELEGRAM)
    const row = bareRow(TELEGRAM, { ledger_checksum: checksum })
    const result = classifyRow(TELEGRAM, row, checksum)
    expect(result.status).toBe("ledger_without_objects")
    expect(BLOCKING_STATUSES).toContain(result.status)
  })

  test("columns present but never ledgered: ledger backfill only, never DDL replay", () => {
    for (const spec of SPECS) {
      expect(classifyRow(spec, bareRow(spec, allObjectsPresent(spec)), checksumOf(spec)))
        .toEqual({ status: "needs_ledger_backfill" })
    }
  })

  test("a partial application is blocking rather than repaired blindly", () => {
    const result = classifyRow(
      KARAOKE_POLICY,
      bareRow(KARAOKE_POLICY, { obj_karaoke_scoring_enabled: 1, obj_karaoke_stt_provider: 1 }),
      checksumOf(KARAOKE_POLICY),
    )
    expect(result.status).toBe("partial_objects")
    expect(BLOCKING_STATUSES).toContain(result.status)
  })
})
