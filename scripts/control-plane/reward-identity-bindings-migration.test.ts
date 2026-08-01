import { describe, expect, test } from "bun:test"
import { Database } from "bun:sqlite"

const migrationPath = new URL(
  "../../db/control-plane/migrations/0179_control_plane_reward_identity_bindings.sql",
  import.meta.url,
)

describe("0179 reward identity bindings migration", () => {
  test("allows only one active binding per user and preserves explicit history", async () => {
    const db = new Database(":memory:")
    try {
      db.exec(`
        PRAGMA foreign_keys = ON;
        CREATE TABLE users (user_id TEXT PRIMARY KEY);
        CREATE TABLE identity_nullifiers (identity_nullifier_id TEXT PRIMARY KEY);
        INSERT INTO users VALUES ('usr_1');
        INSERT INTO identity_nullifiers VALUES ('nul_1'), ('nul_2');
      `)
      db.exec(await Bun.file(migrationPath).text())

      db.exec(`
        INSERT INTO reward_identity_bindings VALUES (
          'rib_1', 'usr_1', 'nul_1', 'active',
          '2026-08-01T00:00:00Z', NULL,
          '2026-08-01T00:00:00Z', '2026-08-01T00:00:00Z'
        );
      `)
      expect(() => db.query(`
        INSERT INTO reward_identity_bindings VALUES (
          'rib_2', 'usr_1', 'nul_2', 'active',
          '2026-08-01T00:00:01Z', NULL,
          '2026-08-01T00:00:01Z', '2026-08-01T00:00:01Z'
        );
      `).run()).toThrow()

      db.exec(`
        UPDATE reward_identity_bindings
        SET status = 'superseded',
            superseded_at = '2026-08-01T00:00:02Z',
            updated_at = '2026-08-01T00:00:02Z'
        WHERE reward_identity_binding_id = 'rib_1';
        INSERT INTO reward_identity_bindings VALUES (
          'rib_2', 'usr_1', 'nul_2', 'active',
          '2026-08-01T00:00:02Z', NULL,
          '2026-08-01T00:00:02Z', '2026-08-01T00:00:02Z'
        );
      `)

      expect(db.query(`
        SELECT reward_identity_binding_id, status
        FROM reward_identity_bindings
        ORDER BY reward_identity_binding_id
      `).all()).toEqual([
        { reward_identity_binding_id: "rib_1", status: "superseded" },
        { reward_identity_binding_id: "rib_2", status: "active" },
      ])
    } finally {
      db.close()
    }
  })
})
