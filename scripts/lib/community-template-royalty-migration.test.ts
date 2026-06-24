// Focused schema test for the royalty-allocation migrations (1099/1100).
// Verifies they apply cleanly to a fresh community-template SQLite database,
// produce the schema the spec requires (core/specs/domain/royalty-allocation.md),
// enforce the declared constraints, and are order-independent so existing
// community databases (already past migration 1100) upgrade to the same schema.
import { Database } from "bun:sqlite";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";

const MIGRATIONS_DIR = join(import.meta.dir, "../../db/community-template/migrations");

function migrationFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith(".sql"))
    .sort();
}

function applyMigrations(order: string[]): Database {
  const db = new Database(":memory:");
  for (const file of order) {
    db.exec(readFileSync(join(MIGRATIONS_DIR, file), "utf8"));
  }
  return db;
}

function schemaFingerprint(db: Database): string {
  const rows = db
    .query<{ sql: string | null }, []>(
      "SELECT sql FROM sqlite_master WHERE sql IS NOT NULL ORDER BY type, name",
    )
    .all();
  return rows.map((row) => row.sql).join("\n");
}

describe("community-template royalty-allocation migrations", () => {
  test("apply cleanly to a fresh database and create the canonical objects", () => {
    const db = applyMigrations(migrationFiles());

    const table = db
      .query("SELECT name FROM sqlite_master WHERE type='table' AND name='initial_royalty_allocations'")
      .get();
    expect(table).toBeTruthy();

    const allocationColumns = db
      .query<{ name: string }, []>("PRAGMA table_info(initial_royalty_allocations)")
      .all()
      .map((row) => row.name);
    for (const column of [
      "allocation_id", "asset_id", "community_id", "recipient_kind", "recipient_user_id",
      "wallet_attachment_id", "wallet_address_normalized", "wallet_address_display", "chain_id",
      "share_bps", "expected_rt_units", "position", "distribution_status", "verified_rt_units",
      "allocation_fingerprint", "created_at", "registered_at",
    ]) {
      expect(allocationColumns).toContain(column);
    }

    const assetColumns = db
      .query<{ name: string }, []>("PRAGMA table_info(assets)")
      .all()
      .map((row) => row.name);
    for (const column of [
      "royalty_allocation_status", "royalty_allocation_fingerprint", "royalty_allocation_version",
      "royalty_allocation_effect_key", "ip_royalty_vault", "royalty_vault_total_supply",
      "royalty_vault_decimals", "royalty_allocation_registered_at", "royalty_allocation_projection_synced",
    ]) {
      expect(assetColumns).toContain(column);
    }

    db.close();
  });

  test("enforce the declared per-recipient constraints", () => {
    const db = applyMigrations(migrationFiles());
    // Isolate this table's own CHECK/unique constraints from FK enforcement
    // (no parent assets/communities fixtures needed for a schema-constraint test).
    db.exec("PRAGMA foreign_keys = OFF;");
    const insert = (overrides: Record<string, unknown>) => {
      const row = {
        allocation_id: `alloc_${Math.round(Math.random() * 1e9)}`,
        asset_id: "asset_1", community_id: "com_1", recipient_kind: "collaborator",
        wallet_address_normalized: "0xabc", wallet_address_display: "0xABC", chain_id: 1315,
        share_bps: 5000, position: 0, allocation_fingerprint: "fp", created_at: "2026-01-01T00:00:00Z",
        ...overrides,
      };
      const cols = Object.keys(row);
      db.query(`INSERT INTO initial_royalty_allocations (${cols.join(",")}) VALUES (${cols.map((c) => `$${c}`).join(",")})`)
        .run(Object.fromEntries(cols.map((c) => [`$${c}`, (row as Record<string, unknown>)[c]])) as never);
    };

    // share_bps must be within (0, 10000].
    expect(() => insert({ allocation_id: "a_zero", share_bps: 0 })).toThrow();
    expect(() => insert({ allocation_id: "a_over", share_bps: 10001 })).toThrow();

    // First creator for an asset is fine; a second creator violates the partial-unique index.
    insert({ allocation_id: "a_creator1", recipient_kind: "creator", wallet_address_normalized: "0xc1", position: 0 });
    expect(() => insert({ allocation_id: "a_creator2", recipient_kind: "creator", wallet_address_normalized: "0xc2", position: 1 }))
      .toThrow();

    // Duplicate wallet for the same asset violates the asset+wallet unique index.
    insert({ allocation_id: "a_w1", wallet_address_normalized: "0xdup", position: 2 });
    expect(() => insert({ allocation_id: "a_w2", wallet_address_normalized: "0xdup", position: 3 })).toThrow();

    db.close();
  });

  test("are order-independent: 1099/1100 applied last yield the same schema as a fresh apply", () => {
    const all = migrationFiles();
    const royalty = all.filter((file) => /^(1099|1100)_/.test(file));
    expect(royalty.length).toBe(2);

    const fresh = applyMigrations(all);
    // Existing-deployment upgrade: everything else first, then the royalty migrations.
    const upgradeOrder = [...all.filter((file) => !royalty.includes(file)), ...royalty];
    const upgrade = applyMigrations(upgradeOrder);

    expect(schemaFingerprint(upgrade)).toBe(schemaFingerprint(fresh));

    fresh.close();
    upgrade.close();
  });
});
