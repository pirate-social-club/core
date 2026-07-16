import { describe, expect, test } from "bun:test"
import { Database } from "bun:sqlite"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

const COMMUNITY_MIGRATIONS = resolve(import.meta.dir, "../../db/community-template/migrations")
const CONTROL_PLANE_MIGRATIONS = resolve(import.meta.dir, "../../db/control-plane/migrations")

describe("0145 control-plane community namespace bindings", () => {
  test("backfills the scalar primary and enforces active binding invariants", () => {
    const db = new Database(":memory:")
    try {
      db.exec(`
        CREATE TABLE namespace_verifications (
          namespace_verification_id TEXT PRIMARY KEY
        );
        CREATE TABLE communities (
          community_id TEXT PRIMARY KEY,
          namespace_verification_id TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        INSERT INTO namespace_verifications VALUES
          ('nv_primary'), ('nv_mirror_1'), ('nv_mirror_2'), ('nv_primary_2');
        INSERT INTO communities VALUES
          ('com_1', 'nv_primary', '2026-07-16T00:00:00Z', '2026-07-16T00:00:00Z'),
          ('com_2', NULL, '2026-07-16T00:00:00Z', '2026-07-16T00:00:00Z');
      `)

      db.exec(readFileSync(
        resolve(CONTROL_PLANE_MIGRATIONS, "0145_control_plane_community_namespace_bindings.sql"),
        "utf8",
      ))

      expect(db.query(`
        SELECT community_namespace_binding_id, namespace_role, status
        FROM community_namespace_bindings
        WHERE community_id = 'com_1'
      `).get()).toEqual({
        community_namespace_binding_id: "cnb_com_1",
        namespace_role: "primary",
        status: "active",
      })

      db.exec(`
        INSERT INTO community_namespace_bindings VALUES
          ('cnb_mirror_1', 'com_1', 'nv_mirror_1', 'mirror', 'active', 'now', 'now'),
          ('cnb_mirror_2', 'com_1', 'nv_mirror_2', 'mirror', 'active', 'now', 'now');
      `)
      expect(() => db.query(`
        INSERT INTO community_namespace_bindings VALUES
          ('cnb_primary_2', 'com_1', 'nv_primary_2', 'primary', 'active', 'now', 'now');
      `).run()).toThrow()
      expect(() => db.query(`
        INSERT INTO community_namespace_bindings VALUES
          ('cnb_elsewhere', 'com_2', 'nv_mirror_1', 'mirror', 'active', 'now', 'now');
      `).run()).toThrow()
    } finally {
      db.close()
    }
  })
})

describe("1133 multi-namespace bindings", () => {
  test("retains one primary while allowing multiple active mirrors", () => {
    const db = new Database(":memory:")
    try {
      db.exec(`
        CREATE TABLE namespace_bindings (
          namespace_id TEXT PRIMARY KEY,
          community_id TEXT NOT NULL,
          namespace_verification_id TEXT NOT NULL,
          status TEXT NOT NULL
        );
        CREATE UNIQUE INDEX idx_namespace_bindings_active_community
          ON namespace_bindings(community_id)
          WHERE status = 'active';
        INSERT INTO namespace_bindings VALUES ('ns_primary', 'com_1', 'nv_primary', 'active');
      `)

      db.exec(readFileSync(resolve(COMMUNITY_MIGRATIONS, "1133_multi_namespace_bindings.sql"), "utf8"))

      expect(db.query(`
        SELECT namespace_role
        FROM namespace_bindings
        WHERE namespace_id = 'ns_primary'
      `).get()).toEqual({ namespace_role: "primary" })

      db.exec(`
        INSERT INTO namespace_bindings VALUES
          ('ns_mirror_1', 'com_1', 'nv_mirror_1', 'active', 'mirror'),
          ('ns_mirror_2', 'com_1', 'nv_mirror_2', 'active', 'mirror');
      `)

      expect(() => db.query(`
        INSERT INTO namespace_bindings VALUES
          ('ns_primary_2', 'com_1', 'nv_primary_2', 'active', 'primary');
      `).run()).toThrow()
      expect(() => db.query(`
        INSERT INTO namespace_bindings VALUES
          ('ns_elsewhere', 'com_2', 'nv_mirror_1', 'active', 'mirror');
      `).run()).toThrow()
    } finally {
      db.close()
    }
  })
})
