import { beforeAll, describe, expect, test } from "bun:test"
import { Database } from "bun:sqlite"
import { createHash } from "node:crypto"
import { readdirSync, readFileSync } from "node:fs"
import { resolve } from "node:path"

import {
  auditFleetClosure,
  buildFleetExpectations,
  classifyShardClosure,
  columnProbeSql,
  DELETED_TEMPLATE_MIGRATIONS,
  diffShardLedger,
  FLEET_CLOSURE_EXCEPTIONS,
  fleetClosed,
  LEDGER_DUMP_SQL,
  probedTables,
  SCHEMA_OBJECTS_SQL,
  snapshotFromRows,
  type DeletedMigrationRecord,
  type FleetClosureException,
  type MigrationExpectation,
  type ShardSchemaSnapshot,
} from "./audit-community-template-set-closure"

const MIGRATIONS_DIR = resolve(import.meta.dir, "../../db/community-template/migrations")
const DRIFT_POLICY = resolve(import.meta.dir, "../../db/known-community-migration-drifts.json")

const TELEGRAM = "1095_community_assistant_telegram_preview_prompt_suffix.sql"
const KARAOKE_ENABLED = "1096_community_karaoke_enabled.sql"
const KARAOKE_POLICY = "1098_community_karaoke_scoring_policy.sql"
const THREAD_LOCKS_STUB = "1064_thread_comment_locks.sql"
const POST_LOCKS_STUB = "1080_post_comment_locks.sql"
const DELETED_ALLOCATION_LEGS = "1097_purchase_allocation_legs_performer.sql"

let expectations: MigrationExpectation[]
let templateMigrations: ReadonlySet<string>
let deletedMigrations: readonly DeletedMigrationRecord[]
let tables: string[]

beforeAll(async () => {
  const built = await buildFleetExpectations({
    migrationsDir: MIGRATIONS_DIR,
    driftPolicyPath: DRIFT_POLICY,
  })
  expectations = built.expectations
  templateMigrations = built.templateMigrations
  deletedMigrations = built.deletedMigrations
  tables = probedTables(expectations)
})

function sha256(sql: string): string {
  return createHash("sha256").update(sql).digest("hex")
}

/**
 * A local shard carrying the whole non-exempt template: every migration applied
 * and ledgered with its current checksum. `skip` models a shard that skipped a
 * contiguous block entirely (no objects, no ledger rows) — the DB_CMTY_0078/0079
 * case. `ledgerChecksumOverrides` records a DIFFERENT ledger checksum (null drops
 * the row) while leaving the schema alone.
 */
function buildShardDb(input: {
  skip?: readonly string[]
  ledgerChecksumOverrides?: Record<string, string | null>
} = {}): Database {
  const skip = new Set(input.skip ?? [])
  const db = new Database(":memory:")
  db.exec("PRAGMA foreign_keys = ON")
  db.exec(`CREATE TABLE schema_migrations (
    migration_name TEXT PRIMARY KEY,
    migration_label TEXT NOT NULL,
    checksum TEXT NOT NULL,
    applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`)
  const insert = db.prepare(
    "INSERT INTO schema_migrations (migration_name, migration_label, checksum) VALUES (?, 'community-template', ?)",
  )
  const exempt = new Set(FLEET_CLOSURE_EXCEPTIONS.map((e) => e.migration))
  for (const name of readdirSync(MIGRATIONS_DIR).filter((n) => n.endsWith(".sql")).sort()) {
    if (exempt.has(name) || skip.has(name)) continue
    const sql = readFileSync(resolve(MIGRATIONS_DIR, name), "utf8")
    db.exec(sql)
    const override = input.ledgerChecksumOverrides?.[name]
    const checksum = override === undefined ? sha256(sql) : override
    if (checksum !== null) insert.run(name, checksum)
  }
  return db
}

/** Run the audit's REAL probe SQL against a local shard DB — no wrangler, no network. */
function probeDb(db: Database): () => Promise<ShardSchemaSnapshot> {
  return async () =>
    snapshotFromRows({
      ledgerRows: db.query(LEDGER_DUMP_SQL).all() as Array<Record<string, unknown>>,
      objectRows: db.query(SCHEMA_OBJECTS_SQL).all() as Array<Record<string, unknown>>,
      columnRow: db.query(columnProbeSql(tables)).get() as Record<string, unknown>,
      probedTables: tables,
    })
}

function gapsFor(db: Database, migration: string) {
  const snapshot = snapshotFromRows({
    ledgerRows: db.query(LEDGER_DUMP_SQL).all() as Array<Record<string, unknown>>,
    objectRows: db.query(SCHEMA_OBJECTS_SQL).all() as Array<Record<string, unknown>>,
    columnRow: db.query(columnProbeSql(tables)).get() as Record<string, unknown>,
    probedTables: tables,
  })
  return classifyShardClosure(expectations, snapshot).filter((g) => g.migration === migration)
}

describe("buildFleetExpectations — the expected set over the real template", () => {
  test("expects every template file minus the documented exceptions", () => {
    expect(FLEET_CLOSURE_EXCEPTIONS.map((e) => e.migration)).toEqual([
      "1116_buyer_funding_tx_single_use.sql",
      "1122_live_room_audience_gates.sql",
    ])
    for (const exception of FLEET_CLOSURE_EXCEPTIONS) {
      expect(exception.reason.trim().length).toBeGreaterThan(0)
    }
    const names = expectations.map((e) => e.migration)
    const files = readdirSync(MIGRATIONS_DIR).filter((n) => n.endsWith(".sql"))
    expect(names.length).toBe(files.length - FLEET_CLOSURE_EXCEPTIONS.length)
    expect(names).not.toContain("1116_buyer_funding_tx_single_use.sql")
    expect(names).not.toContain("1122_live_room_audience_gates.sql")
    expect(names).toContain(TELEGRAM)
    for (const e of expectations) expect(e.checksum).toMatch(/^[0-9a-f]{64}$/u)
  })

  test("the incident migrations are object-attested with their exact columns", () => {
    const byName = new Map(expectations.map((e) => [e.migration, e]))
    expect(byName.get(TELEGRAM)?.attestable).toBe(true)
    expect(byName.get(TELEGRAM)?.artifacts.columns).toEqual([
      ["community_assistant_policy", "telegram_preview_prompt_suffix_json"],
    ])
    expect(byName.get(KARAOKE_ENABLED)?.artifacts.columns).toEqual([["communities", "karaoke_enabled"]])
    expect(byName.get(KARAOKE_POLICY)?.artifacts.columns).toEqual([
      ["communities", "karaoke_scoring_enabled"],
      ["communities", "karaoke_stt_provider"],
      ["communities", "karaoke_stt_model"],
      ["communities", "karaoke_voice_coach_enabled"],
      ["communities", "karaoke_audio_retention"],
    ])
  })

  test("ledger stubs 1064/1080 are ledger-only: no objects are ever expected", () => {
    const byName = new Map(expectations.map((e) => [e.migration, e]))
    for (const stub of [THREAD_LOCKS_STUB, POST_LOCKS_STUB]) {
      const expectation = byName.get(stub)
      expect(expectation?.attestable).toBe(false)
      expect(expectation?.artifacts.tables).toEqual([])
      expect(expectation?.artifacts.columns).toEqual([])
      expect(expectation?.artifacts.indexes).toEqual([])
    }
  })

  test("a rebuild-superseded object is not required (1106 dropped 1105's index by design)", () => {
    const expectation = expectations.find((e) => e.migration === "1105_booking_payment_intents.sql")
    expect(expectation?.attestable).toBe(true)
    expect(expectation?.artifacts.indexes).not.toContain("idx_booking_payment_intents_consumed_tx")
    expect(expectation?.artifacts.tables).toContain("booking_payment_intents")
  })

  test("documented checksum repairs are accepted; undocumented ones are not", () => {
    const stub = expectations.find((e) => e.migration === THREAD_LOCKS_STUB)
    // The documented alternate from db/known-community-migration-drifts.json.
    expect(stub?.acceptableChecksums).toContain("bdb8e886939b733f10afff54e25f83cc39ed49c2a6501b7f7604ac3357b8d61f")
    const telegram = expectations.find((e) => e.migration === TELEGRAM)
    expect(telegram?.acceptableChecksums).toEqual([telegram?.checksum])
  })

  test("fail-closed rot guard: an exception naming a nonexistent file is an error", async () => {
    const bogus: FleetClosureException = {
      migration: "9999_no_such_migration.sql",
      reason: "test",
      approved_at: "2026-08-03T00:00:00Z",
      review_after: "2026-09-02T00:00:00Z",
      expires_at: "2026-11-01T00:00:00Z",
    }
    await expect(buildFleetExpectations({ migrationsDir: MIGRATIONS_DIR, exceptions: [bogus] }))
      .rejects.toThrow("9999_no_such_migration.sql")
  })

  test("fail-closed expiry: an expired exception is an error, not a silent waiver", async () => {
    const expired: FleetClosureException = {
      migration: "1116_buyer_funding_tx_single_use.sql",
      reason: "test",
      approved_at: "2026-01-01T00:00:00Z",
      review_after: "2026-02-01T00:00:00Z",
      expires_at: "2026-03-01T00:00:00Z",
    }
    await expect(
      buildFleetExpectations({
        migrationsDir: MIGRATIONS_DIR,
        exceptions: [expired],
        now: Date.parse("2026-08-03T00:00:00Z"),
      }),
    ).rejects.toThrow("expired")
  })
})

describe("columnProbeSql", () => {
  test("one bounded SELECT covers every altered table", () => {
    expect(tables).toContain("communities")
    expect(tables).toContain("community_assistant_policy")
    const sql = columnProbeSql(["communities", "community_assistant_policy"])
    expect(sql).toContain("pragma_table_info('communities')")
    expect(sql).toContain('AS "cols_communities"')
    expect(sql).toContain("pragma_table_info('community_assistant_policy')")
  })
})

describe("classifyShardClosure — against real local shard databases", () => {
  test("a shard carrying the whole non-exempt template is fully closed", () => {
    const db = buildShardDb()
    try {
      expect(classifyShardClosure(expectations, snapshotFromRows({
        ledgerRows: db.query(LEDGER_DUMP_SQL).all() as Array<Record<string, unknown>>,
        objectRows: db.query(SCHEMA_OBJECTS_SQL).all() as Array<Record<string, unknown>>,
        columnRow: db.query(columnProbeSql(tables)).get() as Record<string, unknown>,
        probedTables: tables,
      }))).toEqual([])
    } finally {
      db.close()
    }
  })

  test("DB_CMTY_0078/0079: a skipped contiguous block reports objects_missing per migration", () => {
    const db = buildShardDb({ skip: [TELEGRAM, KARAOKE_ENABLED, KARAOKE_POLICY] })
    try {
      for (const [migration, objects] of [
        [TELEGRAM, "column:community_assistant_policy.telegram_preview_prompt_suffix_json"],
        [KARAOKE_ENABLED, "column:communities.karaoke_enabled"],
        [KARAOKE_POLICY, "column:communities.karaoke_stt_provider"],
      ] as const) {
        const gaps = gapsFor(db, migration)
        expect(gaps.length).toBe(1)
        expect(gaps[0].status).toBe("objects_missing")
        expect(gaps[0].detail).toContain(objects)
      }
      const policy = gapsFor(db, KARAOKE_POLICY)[0]
      expect(policy.detail).toContain("column:communities.karaoke_audio_retention")
    } finally {
      db.close()
    }
  })

  test("objects present but the ledger row deleted: ledger_missing, a backfill candidate", () => {
    const db = buildShardDb({ ledgerChecksumOverrides: { [KARAOKE_ENABLED]: null } })
    try {
      const gaps = gapsFor(db, KARAOKE_ENABLED)
      expect(gaps).toEqual([{
        migration: KARAOKE_ENABLED,
        status: "ledger_missing",
        detail: "objects present but the ledger row is absent",
      }])
    } finally {
      db.close()
    }
  })

  test("ledgered but never applied: ledger_without_objects — the ledger lies", () => {
    // Objects absent (migration not applied) but the ledger row carries the
    // CORRECT checksum: the row claims work the schema does not have.
    const db = buildShardDb({ skip: [KARAOKE_ENABLED] })
    db.prepare("INSERT INTO schema_migrations (migration_name, migration_label, checksum) VALUES (?, 'community-template', ?)")
      .run(KARAOKE_ENABLED, sha256(readFileSync(resolve(MIGRATIONS_DIR, KARAOKE_ENABLED), "utf8")))
    try {
      const gaps = gapsFor(db, KARAOKE_ENABLED)
      expect(gaps.length).toBe(1)
      expect(gaps[0].status).toBe("ledger_without_objects")
      expect(gaps[0].detail).toContain("column:communities.karaoke_enabled")
    } finally {
      db.close()
    }
  })

  test("a ledger row recording different bytes: checksum_mismatch", () => {
    const db = buildShardDb({ ledgerChecksumOverrides: { [KARAOKE_POLICY]: "0".repeat(64) } })
    try {
      const gaps = gapsFor(db, KARAOKE_POLICY)
      expect(gaps.length).toBe(1)
      expect(gaps[0].status).toBe("checksum_mismatch")
    } finally {
      db.close()
    }
  })

  test("the documented 1064 repair checksum is accepted; an undocumented one mismatches", () => {
    const db = buildShardDb({
      ledgerChecksumOverrides: {
        [THREAD_LOCKS_STUB]: "bdb8e886939b733f10afff54e25f83cc39ed49c2a6501b7f7604ac3357b8d61f",
        [POST_LOCKS_STUB]: "1".repeat(64),
      },
    })
    try {
      expect(gapsFor(db, THREAD_LOCKS_STUB)).toEqual([])
      expect(gapsFor(db, POST_LOCKS_STUB)[0]?.status).toBe("checksum_mismatch")
    } finally {
      db.close()
    }
  })

  test("a ledger stub with no ledger row is ledger_missing, never objects_missing", () => {
    const db = buildShardDb({ ledgerChecksumOverrides: { [POST_LOCKS_STUB]: null } })
    try {
      const gaps = gapsFor(db, POST_LOCKS_STUB)
      expect(gaps.length).toBe(1)
      expect(gaps[0].status).toBe("ledger_missing")
      expect(gaps[0].detail).toContain("ledger-only")
    } finally {
      db.close()
    }
  })
})

describe("auditFleetClosure — shard buckets", () => {
  const live = [{ binding: "DB_CMTY_0001", name: "community-d1-pool-0001-prod" }]
  const quarantined = [{ binding: "DB_CMTY_0092", name: "community-d1-pool-0092-prod" }]

  test("a healthy live shard lands in ok and closes the fleet", async () => {
    const db = buildShardDb()
    try {
      const report = await auditFleetClosure({
        expectations,
        templateMigrations,
        deletedMigrations,
        live,
        quarantined: [],
        missingFromConfig: [],
        probe: probeDb(db),
        concurrency: 4,
      })
      expect(report.live).toEqual([{
        binding: "DB_CMTY_0001",
        database_name: live[0].name,
        bucket: "ok",
        gaps: [],
        ledgerEntries: [],
      }])
      expect(fleetClosed(report)).toBe(true)
    } finally {
      db.close()
    }
  })

  test("a gapped live shard lands in gaps with per-migration detail and fails closure", async () => {
    const db = buildShardDb({ skip: [TELEGRAM, KARAOKE_ENABLED, KARAOKE_POLICY] })
    try {
      const report = await auditFleetClosure({
        expectations,
        templateMigrations,
        deletedMigrations,
        live,
        quarantined: [],
        missingFromConfig: [],
        probe: probeDb(db),
        concurrency: 4,
      })
      expect(report.live[0].bucket).toBe("gaps")
      expect(report.live[0].gaps.map((g) => g.migration).sort()).toEqual([
        TELEGRAM, KARAOKE_ENABLED, KARAOKE_POLICY,
      ].sort())
      expect(fleetClosed(report)).toBe(false)
    } finally {
      db.close()
    }
  })

  test("a shard whose probe throws is unreachable, never silently ok", async () => {
    const report = await auditFleetClosure({
      expectations,
      templateMigrations,
      deletedMigrations,
      live,
      quarantined: [],
      missingFromConfig: [],
      probe: async () => {
        throw new Error("wrangler exited 1: no such table: schema_migrations")
      },
      concurrency: 4,
    })
    expect(report.live[0].bucket).toBe("unreachable")
    expect(report.live[0].detail).toContain("schema_migrations")
    expect(fleetClosed(report)).toBe(false)
  })

  test("quarantined shards keep their gaps, reported separately, never closure-deciding", async () => {
    const healthy = buildShardDb()
    const gapped = buildShardDb({ skip: [TELEGRAM, KARAOKE_ENABLED, KARAOKE_POLICY] })
    try {
      const report = await auditFleetClosure({
        expectations,
        templateMigrations,
        deletedMigrations,
        live,
        quarantined,
        missingFromConfig: [],
        probe: async (name) =>
          probeDb(name === "community-d1-pool-0092-prod" ? gapped : healthy)(),
        concurrency: 4,
      })
      expect(report.live[0].bucket).toBe("ok")
      expect(report.quarantined[0].binding).toBe("DB_CMTY_0092")
      expect(report.quarantined[0].bucket).toBe("gaps")
      expect(report.quarantined[0].gaps.length).toBe(3)
      // Quarantine is an operator decision with its own review clock; the audit
      // surfaces the shard's gaps but does not let them fail the live fleet.
      expect(fleetClosed(report)).toBe(true)
    } finally {
      healthy.close()
      gapped.close()
    }
  })

  test("an allocated shard absent from the shard config fails closure", async () => {
    const db = buildShardDb()
    try {
      const report = await auditFleetClosure({
        expectations,
        templateMigrations,
        deletedMigrations,
        live,
        quarantined: [],
        missingFromConfig: ["DB_CMTY_0999"],
        probe: probeDb(db),
        concurrency: 4,
      })
      expect(report.missingFromConfig[0].binding).toBe("DB_CMTY_0999")
      expect(fleetClosed(report)).toBe(false)
    } finally {
      db.close()
    }
  })
})

function insertLedgerRow(db: Database, migration: string, checksum = "f".repeat(64)): void {
  db.prepare(
    "INSERT INTO schema_migrations (migration_name, migration_label, checksum) VALUES (?, 'community-template', ?)",
  ).run(migration, checksum)
}

describe("deleted-migrations registry — the shard-to-template direction of closure", () => {
  test("the registry documents 1097 with its provenance, and the file is really gone", () => {
    expect(DELETED_TEMPLATE_MIGRATIONS.map((record) => record.migration)).toEqual([
      DELETED_ALLOCATION_LEGS,
    ])
    const record = DELETED_TEMPLATE_MIGRATIONS[0]
    // Added 2026-06-22 in 062e750 on the pre-cutover branches; never merged to
    // main, so no deletion commit exists — the field documents that instead.
    expect(record.deleted_in).toContain("062e750")
    expect(record.reason).toContain("062e750")
    expect(record.reason.trim().length).toBeGreaterThan(0)
    expect(readdirSync(MIGRATIONS_DIR)).not.toContain(DELETED_ALLOCATION_LEGS)
  })

  test("a shard carrying the registered 1097 row is acknowledged, still ok, still closed", async () => {
    const db = buildShardDb()
    insertLedgerRow(db, DELETED_ALLOCATION_LEGS)
    try {
      const notes = diffShardLedger(await probeDb(db)(), templateMigrations, deletedMigrations)
      expect(notes).toEqual([{
        migration: DELETED_ALLOCATION_LEGS,
        status: "acknowledged_deleted",
        detail: expect.stringContaining("062e750"),
      }])

      const report = await auditFleetClosure({
        expectations,
        templateMigrations,
        deletedMigrations,
        live: [{ binding: "DB_CMTY_0077", name: "community-d1-pool-0077-prod" }],
        quarantined: [],
        missingFromConfig: [],
        probe: probeDb(db),
        concurrency: 4,
      })
      expect(report.live[0].bucket).toBe("ok")
      expect(report.live[0].gaps).toEqual([])
      expect(report.live[0].ledgerEntries[0]?.status).toBe("acknowledged_deleted")
      expect(fleetClosed(report)).toBe(true)
    } finally {
      db.close()
    }
  })

  test("a shard carrying an UNREGISTERED deleted migration is flagged and fails closure", async () => {
    const db = buildShardDb()
    insertLedgerRow(db, "9999_phantom_migration.sql")
    try {
      const notes = diffShardLedger(await probeDb(db)(), templateMigrations, deletedMigrations)
      expect(notes.length).toBe(1)
      expect(notes[0].migration).toBe("9999_phantom_migration.sql")
      expect(notes[0].status).toBe("unknown_ledger_entry")

      const report = await auditFleetClosure({
        expectations,
        templateMigrations,
        deletedMigrations,
        live: [{ binding: "DB_CMTY_0077", name: "community-d1-pool-0077-prod" }],
        quarantined: [],
        missingFromConfig: [],
        probe: probeDb(db),
        concurrency: 4,
      })
      expect(report.live[0].bucket).toBe("gaps")
      expect(fleetClosed(report)).toBe(false)
    } finally {
      db.close()
    }
  })

  test("ledger rows for exception migrations (snapshot-provisioned shards) are not unknown", () => {
    // Shards provisioned from the api schema snapshot legitimately carry ledger
    // rows for 1116/1122 — the template set for the shard->template diff is the
    // whole dir, exceptions included.
    const snapshot: ShardSchemaSnapshot = {
      ledger: new Map([
        ["1116_buyer_funding_tx_single_use.sql", "a".repeat(64)],
        ["1122_live_room_audience_gates.sql", "b".repeat(64)],
      ]),
      tables: new Set(),
      indexes: new Set(),
      columns: new Map(),
    }
    expect(templateMigrations.has("1116_buyer_funding_tx_single_use.sql")).toBe(true)
    expect(diffShardLedger(snapshot, templateMigrations, deletedMigrations)).toEqual([])
  })

  test("fail-closed rot guard: a registry entry whose file exists in the template dir is an error", async () => {
    const restored: DeletedMigrationRecord = {
      migration: KARAOKE_ENABLED,
      reason: "test",
      deleted_in: "0000000",
      approved_at: "2026-08-03T00:00:00Z",
      review_after: "2026-09-02T00:00:00Z",
      expires_at: "2026-11-01T00:00:00Z",
    }
    await expect(buildFleetExpectations({ migrationsDir: MIGRATIONS_DIR, deletedMigrations: [restored] }))
      .rejects.toThrow("must leave the registry")
  })

  test("fail-closed expiry: an expired registry entry is an error, not silent tolerance", async () => {
    const expired: DeletedMigrationRecord = {
      migration: DELETED_ALLOCATION_LEGS,
      reason: "test",
      deleted_in: "never merged to main; last carried by 062e750",
      approved_at: "2026-01-01T00:00:00Z",
      review_after: "2026-02-01T00:00:00Z",
      expires_at: "2026-03-01T00:00:00Z",
    }
    await expect(
      buildFleetExpectations({
        migrationsDir: MIGRATIONS_DIR,
        deletedMigrations: [expired],
        now: Date.parse("2026-08-03T00:00:00Z"),
      }),
    ).rejects.toThrow("expired")
  })
})
