import { describe, expect, test } from "bun:test"
import { Database } from "bun:sqlite"
import { readFileSync } from "node:fs"
import { postgresMigrationStatements } from "../lib/postgres-migrations"

const migration = readFileSync(
  "db/control-plane/migrations/0227_control_plane_provider_keyed_attestation_constraints.sql",
  "utf8",
)

function createProbeDatabase(): Database {
  const db = new Database(":memory:")
  db.exec(`
    CREATE TABLE user_attestations (
      user_attestation_id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      source_verification_session_id TEXT,
      provider TEXT NOT NULL,
      capability_key TEXT,
      status TEXT NOT NULL,
      source_identity_nullifier_id TEXT
    );
  `)
  for (const statement of postgresMigrationStatements(migration).filter((sql) =>
    sql.trimStart().toUpperCase().startsWith("CREATE UNIQUE INDEX")
  )) {
    db.exec(statement)
  }
  return db
}

function insert(db: Database, values: {
  id: string
  user: string
  session: string | null
  provider: string
  capability: string
  status?: string
  nullifier?: string | null
}): void {
  db.query(`
    INSERT INTO user_attestations (
      user_attestation_id, user_id, source_verification_session_id, provider,
      capability_key, status, source_identity_nullifier_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    values.id,
    values.user,
    values.session,
    values.provider,
    values.capability,
    values.status ?? "accepted",
    values.nullifier ?? null,
  )
}

describe("0227 provider-keyed attestation constraints", () => {
  test("contains fail-closed duplicate preflights and all three partial indexes", () => {
    const statements = postgresMigrationStatements(migration)
    expect(statements).toHaveLength(6)
    expect(statements[0]).toContain("duplicate accepted personhood evidence")
    expect(statements[0]).toContain("duplicate accepted document evidence")
    expect(statements[0]).toContain("duplicate accepted single-slot evidence")
    expect(statements[0]).toContain("duplicate accepted verification-session evidence")
    expect(statements[1]).toContain("user_attestations_accepted_nationality_bound_check")
    expect(statements.slice(2).map((statement) => statement.match(/idx_user_attestations_[a-z_]+/u)?.[0])).toEqual([
      "idx_user_attestations_accepted_personhood",
      "idx_user_attestations_accepted_document",
      "idx_user_attestations_accepted_single_slot",
      "idx_user_attestations_accepted_session",
    ])
  })

  test("permits distinct document nullifiers but rejects same-document and session duplicates", () => {
    const db = createProbeDatabase()
    try {
      insert(db, { id: "human-1", user: "u1", session: "s1", provider: "self", capability: "unique_human" })
      expect(() => insert(db, { id: "human-2", user: "u1", session: "s2", provider: "self", capability: "unique_human" })).toThrow()

      insert(db, { id: "nat-a", user: "u1", session: "s3", provider: "self", capability: "nationality", nullifier: "nul-a" })
      insert(db, { id: "nat-b", user: "u1", session: "s4", provider: "self", capability: "nationality", nullifier: "nul-b" })
      expect(() => insert(db, { id: "nat-a2", user: "u1", session: "s5", provider: "self", capability: "nationality", nullifier: "nul-a" })).toThrow()
      expect(() => insert(db, { id: "nat-session-duplicate", user: "u1", session: "s3", provider: "self", capability: "nationality", nullifier: "nul-c" })).toThrow()

      insert(db, { id: "gender-1", user: "u1", session: "s6", provider: "self", capability: "gender", nullifier: "nul-c" })
      expect(() => insert(db, { id: "gender-duplicate", user: "u1", session: "s7", provider: "self", capability: "gender", nullifier: "nul-d" })).toThrow()
      insert(db, { id: "gender-expired", user: "u1", session: "s3", provider: "self", capability: "gender", status: "expired", nullifier: "nul-c" })
    } finally {
      db.close()
    }
  })
})
