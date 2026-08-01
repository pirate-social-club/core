import { describe, expect, test } from "bun:test"
import { Database } from "bun:sqlite"

const migrationPath = new URL(
  "../../db/control-plane/migrations/0178_control_plane_nationality_attestation_nullifier.sql",
  import.meta.url,
)

describe("0178 nationality attestation nullifier migration", () => {
  test("adds a nullable foreign key without inventing bindings", async () => {
    const db = new Database(":memory:")
    try {
      db.exec(`
        PRAGMA foreign_keys = ON;
        CREATE TABLE identity_nullifiers (
          identity_nullifier_id TEXT PRIMARY KEY
        );
        CREATE TABLE user_attestations (
          user_attestation_id TEXT PRIMARY KEY,
          capability_key TEXT NOT NULL
        );
        INSERT INTO user_attestations VALUES ('att_existing', 'nationality');
      `)

      db.exec(await Bun.file(migrationPath).text())

      expect(db.query("PRAGMA foreign_keys").get()).toEqual({ foreign_keys: 1 })
      expect(db.query("PRAGMA foreign_key_list(user_attestations)").all()).toContainEqual({
        id: 0,
        seq: 0,
        table: "identity_nullifiers",
        from: "source_identity_nullifier_id",
        to: "identity_nullifier_id",
        on_update: "NO ACTION",
        on_delete: "NO ACTION",
        match: "NONE",
      })

      expect(db.query(`
        SELECT source_identity_nullifier_id
        FROM user_attestations
        WHERE user_attestation_id = 'att_existing'
      `).get()).toEqual({ source_identity_nullifier_id: null })

      db.exec(`
        INSERT INTO identity_nullifiers VALUES ('nul_1');
        INSERT INTO user_attestations (
          user_attestation_id,
          capability_key,
          source_identity_nullifier_id
        ) VALUES ('att_bound', 'nationality', 'nul_1');
      `)
      expect(() => db.query(`
        INSERT INTO user_attestations (
          user_attestation_id,
          capability_key,
          source_identity_nullifier_id
        ) VALUES ('att_invalid', 'nationality', 'nul_missing');
      `).run()).toThrow()

      expect(db.query(`
        SELECT name FROM sqlite_master
        WHERE type = 'index'
          AND name = 'idx_user_attestations_source_identity_nullifier'
      `).get()).toEqual({ name: "idx_user_attestations_source_identity_nullifier" })
    } finally {
      db.close()
    }
  })
})
