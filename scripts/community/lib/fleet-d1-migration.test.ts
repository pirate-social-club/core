import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

import { SPEC as OUTBOX_SPEC } from "../apply-reward-outbox-d1-migration"
import { SPEC as STORY_SPEC } from "../apply-story-metadata-refs-d1-migration"
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
