import { readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "bun:test";
import { createClient, type Client } from "@libsql/client";
import { splitSqlStatements, toSqliteCompatibleStatement } from "./shared/sql-migration";

type Cleanup = () => Promise<void>;

let cleanup: Cleanup | null = null;

const MIGRATION_NAME = "0117_control_plane_community_database_routing.sql";
const NOW = "2026-06-14T00:00:00.000Z";

async function createBindingDirectoryTestDatabase(): Promise<{
  client: Client;
  cleanup: Cleanup;
}> {
  const databasePath = join(tmpdir(), `pirate-core-routing-migration-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
  const client = createClient({ url: `file:${databasePath}` });
  await client.execute("PRAGMA foreign_keys = ON");

  const migrationsDir = new URL("../../db/control-plane/migrations/", import.meta.url);
  const entries = (await readdir(migrationsDir))
    .filter((entry) => entry.endsWith(".sql"))
    .sort();
  const baselineEntry = entries.find((entry) => entry.startsWith("0000_") && entry.includes("baseline"));
  if (!baselineEntry) {
    throw new Error("control-plane baseline migration not found");
  }

  for (const entry of [baselineEntry, MIGRATION_NAME]) {
    const rawSql = await readFile(new URL(entry, migrationsDir), "utf8");
    for (const statement of splitSqlStatements(rawSql)) {
      const sqliteStatement = toSqliteCompatibleStatement(statement);
      if (!sqliteStatement) {
        continue;
      }
      await client.execute(sqliteStatement);
    }
  }

  return {
    client,
    cleanup: async () => {
      client.close();
      await rm(databasePath, { force: true });
    },
  };
}

async function insertCommunity(client: Client, communityId: string, creatorUserId: string): Promise<void> {
  await client.execute({
    sql: `
      INSERT INTO users (
        user_id, verification_state, verification_capabilities_json, created_at, updated_at
      ) VALUES (?1, 'verified', '{}', ?2, ?2)
    `,
    args: [creatorUserId, NOW],
  });
  await client.execute({
    sql: `
      INSERT INTO communities (
        community_id, creator_user_id, display_name, membership_mode, status,
        provisioning_state, transfer_state, created_at, updated_at
      ) VALUES (
        ?1, ?2, ?3, 'open', 'active', 'active', 'none', ?4, ?4
      )
    `,
    args: [communityId, creatorUserId, `community-${communityId}`, NOW],
  });
}

async function insertTursoBinding(client: Client, bindingId: string, communityId: string): Promise<void> {
  await client.execute({
    sql: `
      INSERT INTO community_database_bindings (
        community_database_binding_id, community_id, binding_role, organization_slug,
        group_name, database_name, database_url, requires_credentials, status, created_at, updated_at
      ) VALUES (
        ?1, ?2, 'primary', 'pirate-prod', 'pirate-prod-default', 'main-com', 'libsql://main-com.turso.io', 1, 'active', ?3, ?3
      )
    `,
    args: [bindingId, communityId, NOW],
  });
}

afterEach(async () => {
  if (cleanup) {
    await cleanup();
    cleanup = null;
  }
});

describe("control-plane binding-directory migration (0117)", () => {
  test("creates the community_database_routing table with the design columns", async () => {
    const db = await createBindingDirectoryTestDatabase();
    cleanup = db.cleanup;

    const rows = await db.client.execute(`
      SELECT name FROM pragma_table_info('community_database_routing')
      ORDER BY cid
    `);

    const columnNames = rows.rows.map((row) => String(row.name));
    expect(columnNames).toEqual([
      "community_id",
      "backend",
      "provisioning_state",
      "shard_worker_id",
      "binding_name",
      "region",
      "turso_database_binding_id",
      "migrated_at",
      "decommissioned_at",
      "last_error_at",
      "last_error_message",
      "created_at",
      "updated_at",
    ]);
  });

  test("creates the documented indices on provisioning_state and shard_worker_id", async () => {
    const db = await createBindingDirectoryTestDatabase();
    cleanup = db.cleanup;

    const indexRows = await db.client.execute(`
      SELECT name, sql FROM sqlite_master
      WHERE type = 'index' AND tbl_name = 'community_database_routing'
      ORDER BY name
    `);

    const indexNames = indexRows.rows.map((row) => String(row.name));
    expect(indexNames).toContain("idx_community_database_routing_state");
    expect(indexNames).toContain("idx_community_database_routing_shard");
  });

  test("accepts a turso backend row with turso_database_binding_id set and d1 fields null", async () => {
    const db = await createBindingDirectoryTestDatabase();
    cleanup = db.cleanup;

    await insertCommunity(db.client, "cmt_routing_turso", "usr_routing_turso");
    await insertTursoBinding(db.client, "cdb_routing_turso", "cmt_routing_turso");

    await db.client.execute({
      sql: `
        INSERT INTO community_database_routing (
          community_id, backend, provisioning_state, turso_database_binding_id,
          created_at, updated_at
        ) VALUES (
          'cmt_routing_turso', 'turso', 'ready', 'cdb_routing_turso', ?1, ?1
        )
      `,
      args: [NOW],
    });

    const result = await db.client.execute({
      sql: "SELECT backend, provisioning_state, turso_database_binding_id FROM community_database_routing WHERE community_id = ?1",
      args: ["cmt_routing_turso"],
    });
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toEqual({
      backend: "turso",
      provisioning_state: "ready",
      turso_database_binding_id: "cdb_routing_turso",
    });
  });

  test("accepts a d1 backend row with shard_worker_id, binding_name, and region set", async () => {
    const db = await createBindingDirectoryTestDatabase();
    cleanup = db.cleanup;

    await insertCommunity(db.client, "cmt_routing_d1", "usr_routing_d1");

    await db.client.execute({
      sql: `
        INSERT INTO community_database_routing (
          community_id, backend, provisioning_state, shard_worker_id, binding_name, region,
          migrated_at, created_at, updated_at
        ) VALUES (
          'cmt_routing_d1', 'd1', 'ready', 'pirate-api-shard-0', 'D1_C00001', 'WEU', ?1, ?1, ?1
        )
      `,
      args: [NOW],
    });

    const result = await db.client.execute({
      sql: "SELECT backend, shard_worker_id, binding_name, region, migrated_at FROM community_database_routing WHERE community_id = ?1",
      args: ["cmt_routing_d1"],
    });
    expect(result.rows).toEqual([
      {
        backend: "d1",
        shard_worker_id: "pirate-api-shard-0",
        binding_name: "D1_C00001",
        region: "WEU",
        migrated_at: NOW,
      },
    ]);
  });

  test("rejects a turso row that also sets d1 fields", async () => {
    const db = await createBindingDirectoryTestDatabase();
    cleanup = db.cleanup;

    await insertCommunity(db.client, "cmt_routing_mix_t", "usr_routing_mix_t");
    await insertTursoBinding(db.client, "cdb_routing_mix_t", "cmt_routing_mix_t");

    expect(
      db.client.execute({
        sql: `
          INSERT INTO community_database_routing (
            community_id, backend, provisioning_state, shard_worker_id, binding_name, region,
            turso_database_binding_id, created_at, updated_at
          ) VALUES (
            'cmt_routing_mix_t', 'turso', 'ready', 'pirate-api-shard-0', 'D1_C00001', 'WEU',
            'cdb_routing_mix_t', ?1, ?1
          )
        `,
        args: [NOW],
      }),
    ).rejects.toThrow();
  });

  test("rejects a d1 row that also sets turso_database_binding_id", async () => {
    const db = await createBindingDirectoryTestDatabase();
    cleanup = db.cleanup;

    await insertCommunity(db.client, "cmt_routing_mix_d", "usr_routing_mix_d");
    await insertTursoBinding(db.client, "cdb_routing_mix_d", "cmt_routing_mix_d");

    expect(
      db.client.execute({
        sql: `
          INSERT INTO community_database_routing (
            community_id, backend, provisioning_state, shard_worker_id, binding_name, region,
            turso_database_binding_id, created_at, updated_at
          ) VALUES (
            'cmt_routing_mix_d', 'd1', 'ready', 'pirate-api-shard-0', 'D1_C00002', 'EEU',
            'cdb_routing_mix_d', ?1, ?1
          )
        `,
        args: [NOW],
      }),
    ).rejects.toThrow();
  });

  test("rejects backend values outside ('turso','d1')", async () => {
    const db = await createBindingDirectoryTestDatabase();
    cleanup = db.cleanup;

    await insertCommunity(db.client, "cmt_routing_bad_backend", "usr_routing_bad_backend");

    expect(
      db.client.execute({
        sql: `
          INSERT INTO community_database_routing (
            community_id, backend, provisioning_state, created_at, updated_at
          ) VALUES ('cmt_routing_bad_backend', 'cockroach', 'ready', ?1, ?1)
        `,
        args: [NOW],
      }),
    ).rejects.toThrow();
  });

  test("rejects provisioning_state values outside the documented set", async () => {
    const db = await createBindingDirectoryTestDatabase();
    cleanup = db.cleanup;

    await insertCommunity(db.client, "cmt_routing_bad_state", "usr_routing_bad_state");

    expect(
      db.client.execute({
        sql: `
          INSERT INTO community_database_routing (
            community_id, backend, provisioning_state, created_at, updated_at
          ) VALUES ('cmt_routing_bad_state', 'turso', 'pending', ?1, ?1)
        `,
        args: [NOW],
      }),
    ).rejects.toThrow();
  });

  test("rejects migrated_at set while backend is turso", async () => {
    const db = await createBindingDirectoryTestDatabase();
    cleanup = db.cleanup;

    await insertCommunity(db.client, "cmt_routing_turso_migrated", "usr_routing_turso_migrated");
    await insertTursoBinding(db.client, "cdb_routing_turso_migrated", "cmt_routing_turso_migrated");

    expect(
      db.client.execute({
        sql: `
          INSERT INTO community_database_routing (
            community_id, backend, provisioning_state, turso_database_binding_id,
            migrated_at, created_at, updated_at
          ) VALUES (
            'cmt_routing_turso_migrated', 'turso', 'ready', 'cdb_routing_turso_migrated',
            ?1, ?1, ?1
          )
        `,
        args: [NOW],
      }),
    ).rejects.toThrow();
  });

  test("rejects decommissioned_at set when provisioning_state is not decommissioned", async () => {
    const db = await createBindingDirectoryTestDatabase();
    cleanup = db.cleanup;

    await insertCommunity(db.client, "cmt_routing_decom_mismatch", "usr_routing_decom_mismatch");
    await insertTursoBinding(db.client, "cdb_routing_decom_mismatch", "cmt_routing_decom_mismatch");

    expect(
      db.client.execute({
        sql: `
          INSERT INTO community_database_routing (
            community_id, backend, provisioning_state, turso_database_binding_id,
            decommissioned_at, created_at, updated_at
          ) VALUES (
            'cmt_routing_decom_mismatch', 'turso', 'ready', 'cdb_routing_decom_mismatch',
            ?1, ?1, ?1
          )
        `,
        args: [NOW],
      }),
    ).rejects.toThrow();
  });

  test("accepts decommissioned_at when provisioning_state is decommissioned", async () => {
    const db = await createBindingDirectoryTestDatabase();
    cleanup = db.cleanup;

    await insertCommunity(db.client, "cmt_routing_decom_ok", "usr_routing_decom_ok");
    await insertTursoBinding(db.client, "cdb_routing_decom_ok", "cmt_routing_decom_ok");

    await db.client.execute({
      sql: `
        INSERT INTO community_database_routing (
          community_id, backend, provisioning_state, turso_database_binding_id,
          decommissioned_at, created_at, updated_at
        ) VALUES (
          'cmt_routing_decom_ok', 'turso', 'decommissioned', 'cdb_routing_decom_ok',
          ?1, ?1, ?1
        )
      `,
      args: [NOW],
    });

    const rows = await db.client.execute({
      sql: "SELECT provisioning_state, decommissioned_at FROM community_database_routing WHERE community_id = ?1",
      args: ["cmt_routing_decom_ok"],
    });
    expect(rows.rows).toEqual([{ provisioning_state: "decommissioned", decommissioned_at: NOW }]);
  });

  test("enforces the foreign key to communities(community_id)", async () => {
    const db = await createBindingDirectoryTestDatabase();
    cleanup = db.cleanup;

    expect(
      db.client.execute({
        sql: `
          INSERT INTO community_database_routing (
            community_id, backend, provisioning_state, created_at, updated_at
          ) VALUES ('cmt_routing_no_community', 'turso', 'ready', ?1, ?1)
        `,
        args: [NOW],
      }),
    ).rejects.toThrow();
  });

  test("enforces the foreign key to community_database_bindings(community_database_binding_id)", async () => {
    const db = await createBindingDirectoryTestDatabase();
    cleanup = db.cleanup;

    await insertCommunity(db.client, "cmt_routing_no_binding", "usr_routing_no_binding");

    expect(
      db.client.execute({
        sql: `
          INSERT INTO community_database_routing (
            community_id, backend, provisioning_state, turso_database_binding_id,
            created_at, updated_at
          ) VALUES (
            'cmt_routing_no_binding', 'turso', 'ready', 'cdb_does_not_exist', ?1, ?1
          )
        `,
        args: [NOW],
      }),
    ).rejects.toThrow();
  });

  test("rejects a d1 row with any d1 field null", async () => {
    const db = await createBindingDirectoryTestDatabase();
    cleanup = db.cleanup;

    await insertCommunity(db.client, "cmt_routing_d1_partial", "usr_routing_d1_partial");

    expect(
      db.client.execute({
        sql: `
          INSERT INTO community_database_routing (
            community_id, backend, provisioning_state, shard_worker_id, binding_name,
            created_at, updated_at
          ) VALUES (
            'cmt_routing_d1_partial', 'd1', 'ready', 'pirate-api-shard-0', 'D1_C00003', ?1, ?1
          )
        `,
        args: [NOW],
      }),
    ).rejects.toThrow();
  });
});
