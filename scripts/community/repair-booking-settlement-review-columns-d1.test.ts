import { describe, expect, test } from "bun:test"
import { Database } from "bun:sqlite"
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

import {
  convergenceFailures,
  parseSettlementReviewMigration,
  planSettlementReviewRepair,
  probeFromRow,
  settlementReviewProbeSql,
  type RepairProbe,
} from "./repair-booking-settlement-review-columns-d1"

const MIGRATIONS_DIR = resolve(import.meta.dir, "../../db/community-template/migrations")
const MIGRATION = "1108_booking_settlement_review.sql"
/** Read the REAL migration off disk, so this test cannot drift from what ships. */
const REAL_SQL = readFileSync(resolve(MIGRATIONS_DIR, MIGRATION), "utf8")
const CHECKSUM = createHash("sha256").update(REAL_SQL).digest("hex")
const PARSED = parseSettlementReviewMigration(REAL_SQL)

/** The three columns DB_CMTY_0068 is missing, in file order. */
const INCIDENT_MISSING = [
  "settlement_review_operator_actor_id",
  "settlement_review_note",
  "settlement_review_version",
]

function buildShardDb(input: {
  missing?: ReadonlySet<string>
  ledgerChecksum?: string | null
  withBookings?: boolean
  withIndex?: boolean
} = {}): Database {
  const missing = input.missing ?? new Set<string>()
  const db = new Database(":memory:")
  db.exec(`CREATE TABLE schema_migrations (
    migration_name TEXT PRIMARY KEY,
    migration_label TEXT NOT NULL,
    checksum TEXT NOT NULL,
    applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`)
  if (input.ledgerChecksum !== null) {
    db.prepare(
      "INSERT INTO schema_migrations (migration_name, migration_label, checksum) VALUES (?, 'community-template', ?)",
    ).run(MIGRATION, input.ledgerChecksum ?? CHECKSUM)
  }
  if (input.withBookings !== false) {
    db.exec("CREATE TABLE bookings (booking_id TEXT PRIMARY KEY, community_id TEXT, updated_at TEXT)")
    for (const column of PARSED.columns) {
      if (missing.has(column.name)) continue
      db.exec(column.statement)
    }
    if (input.withIndex !== false) {
      // The fixture only needs the index to EXIST under its real name.
      db.exec(`CREATE INDEX ${PARSED.indexName} ON bookings (booking_id)`)
    }
  }
  return db
}

/** Run the script's REAL probe SQL against a local shard DB — no wrangler, no network. */
function probeDb(db: Database): RepairProbe {
  const row = db.query(settlementReviewProbeSql(PARSED.indexName)).get() as Record<string, unknown>
  return probeFromRow(row)
}

function planFor(db: Database) {
  return planSettlementReviewRepair({ checksum: CHECKSUM, columns: PARSED.columns, indexName: PARSED.indexName, probe: probeDb(db) })
}

describe("parseSettlementReviewMigration — the repair shape from the real file", () => {
  test("parses exactly the nine columns in file order, with verbatim statements", () => {
    expect(PARSED.columns.map((c) => c.name)).toEqual([
      "settlement_review_status",
      "settlement_review_reason",
      "settlement_review_resolution",
      "settlement_review_opened_at",
      "settlement_review_resolved_at",
      "settlement_review_operator_credential_id",
      "settlement_review_operator_actor_id",
      "settlement_review_note",
      "settlement_review_version",
    ])
    const version = PARSED.columns.find((c) => c.name === "settlement_review_version")!
    expect(version.statement).toContain("ADD COLUMN settlement_review_version INTEGER NOT NULL DEFAULT 0")
    expect(version.statement).toContain("CHECK (settlement_review_version >= 0)")
    expect(PARSED.indexName).toBe("idx_bookings_settlement_review_pending")
  })
})

describe("planSettlementReviewRepair — against real local shard databases", () => {
  test("the DB_CMTY_0068 fixture: exactly the three missing ALTERs, then convergence", () => {
    const db = buildShardDb({ missing: new Set(INCIDENT_MISSING) })
    try {
      const probe = probeDb(db)
      expect(probe.presentColumns.size).toBe(6 + 3) // booking_id, community_id, updated_at + six review columns
      expect(probe.hasIndex).toBe(true)
      expect(probe.ledgerChecksum).toBe(CHECKSUM)

      const plan = planSettlementReviewRepair({ checksum: CHECKSUM, columns: PARSED.columns, indexName: PARSED.indexName, probe })
      expect(plan.kind).toBe("repair")
      if (plan.kind !== "repair") throw new Error("repair plan expected")
      expect(plan.missing).toEqual(INCIDENT_MISSING)
      // Statements are the file's verbatim ALTERs for exactly those columns.
      expect(plan.statements).toEqual(PARSED.columns.filter((c) => INCIDENT_MISSING.includes(c.name)).map((c) => c.statement))

      // Apply, re-probe: converged, no verification failures.
      for (const statement of plan.statements) db.exec(statement)
      const after = planSettlementReviewRepair({ checksum: CHECKSUM, columns: PARSED.columns, indexName: PARSED.indexName, probe: probeDb(db) })
      expect(after.kind).toBe("converged")
      expect(convergenceFailures({ checksum: CHECKSUM, columns: PARSED.columns, indexName: PARSED.indexName, probe: probeDb(db) })).toEqual([])
    } finally {
      db.close()
    }
  })

  test("a fully-converged shard reports converged with no statements", () => {
    const db = buildShardDb()
    try {
      const plan = planFor(db)
      expect(plan.kind).toBe("converged")
      expect("statements" in plan).toBe(false)
    } finally {
      db.close()
    }
  })

  test("a ledger checksum mismatch refuses — that is a different repair", () => {
    const db = buildShardDb({ missing: new Set(INCIDENT_MISSING), ledgerChecksum: "0".repeat(64) })
    try {
      const plan = planFor(db)
      expect(plan.kind).toBe("refuse")
      if (plan.kind !== "refuse") throw new Error("refusal expected")
      expect(plan.reason).toContain("checksum")
    } finally {
      db.close()
    }
  })

  test("an absent 1108 ledger row refuses — never ledgered is a different repair", () => {
    const db = buildShardDb({ missing: new Set(INCIDENT_MISSING), ledgerChecksum: null })
    try {
      const plan = planFor(db)
      expect(plan.kind).toBe("refuse")
      if (plan.kind !== "refuse") throw new Error("refusal expected")
      expect(plan.reason).toContain("no ledger row")
    } finally {
      db.close()
    }
  })

  test("a missing index refuses — the reviewed partial state includes the index", () => {
    const db = buildShardDb({ missing: new Set(INCIDENT_MISSING), withIndex: false })
    try {
      const plan = planFor(db)
      expect(plan.kind).toBe("refuse")
      if (plan.kind !== "refuse") throw new Error("refusal expected")
      expect(plan.reason).toContain(PARSED.indexName)
    } finally {
      db.close()
    }
  })

  test("a missing bookings table refuses", () => {
    const db = buildShardDb({ withBookings: false })
    try {
      const plan = planFor(db)
      expect(plan.kind).toBe("refuse")
      if (plan.kind !== "refuse") throw new Error("refusal expected")
      expect(plan.reason).toContain("bookings")
    } finally {
      db.close()
    }
  })

  test("the plan never emits an ALTER for a present column (idempotent re-run safety)", () => {
    const db = buildShardDb({ missing: new Set(INCIDENT_MISSING) })
    try {
      const plan = planFor(db)
      if (plan.kind !== "repair") throw new Error("repair plan expected")
      const presentReviewColumns = PARSED.columns
        .filter((c) => !INCIDENT_MISSING.includes(c.name))
        .map((c) => c.name)
      for (const present of presentReviewColumns) {
        expect(plan.missing).not.toContain(present)
        expect(plan.statements.some((s) => s.includes(`ADD COLUMN ${present}`))).toBe(false)
      }
    } finally {
      db.close()
    }
  })
})
