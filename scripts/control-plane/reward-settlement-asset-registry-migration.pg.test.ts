import { SQL } from "bun";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { postgresMigrationStatements } from "../lib/postgres-migrations";

const ADMIN_URL =
  process.env.CONTROL_PLANE_MIGRATION_TEST_ADMIN_URL ??
  process.env.BOOKINGS_MIGRATION_TEST_ADMIN_URL;
const RUN = Boolean(ADMIN_URL);
const TEST_DB = "reward_settlement_asset_registry_test";
const RW_PASSWORD = "test-settlement-registry-rw";

const BASE_USDC = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
const SEPOLIA_USDC = "0x036cbd53842c5426634e7929541ec2318f3dcf7e";

function urlFor(options: { db?: string; user?: string; password?: string }): string {
  const url = new URL(ADMIN_URL as string);
  if (options.user !== undefined) url.username = options.user;
  if (options.password !== undefined) url.password = options.password;
  if (options.db !== undefined) url.pathname = `/${options.db}`;
  if (!url.searchParams.get("sslmode")) url.searchParams.set("sslmode", "disable");
  return url.toString();
}

function connect(options: { db?: string; user?: string; password?: string }): SQL {
  return new SQL({
    url: urlFor(options),
    tls: false,
    max: 1,
    connectionTimeout: 5,
  } as Record<string, unknown>);
}

async function applyMigration(sql: SQL, path: string): Promise<void> {
  for (const statement of postgresMigrationStatements(readFileSync(path, "utf8"))) {
    await sql.unsafe(statement);
  }
}

async function expectSqlState(sql: SQL, statement: string, expected: string): Promise<void> {
  let caught: { errno?: string } | undefined;
  try {
    await sql.unsafe(statement);
  } catch (error) {
    caught = error as { errno?: string };
  }
  expect(caught, `expected SQLSTATE ${expected}, got success`).toBeDefined();
  expect(caught?.errno).toBe(expected);
}

function assetInsert(chainId: number, address: string, decimals: number, policy: string): string {
  return `
    INSERT INTO reward_settlement_assets (
      chain_id, token_address, decimals, symbol, denomination_policy,
      status, admitted_at, admitted_by, authorization_reference
    ) VALUES (${chainId}, '${address}', ${decimals}, 'TOK', '${policy}', 'admitted', NOW(), 'test', 'test')
  `;
}

function railInsert(id: string, backend: string, vault: string | null, treasurySuffix: string): string {
  const vaultValue = vault === null ? "NULL" : `'${vault}'`;
  return `
    INSERT INTO reward_settlement_rails (
      reward_settlement_rail_id, environment, backend, chain_id, token_address,
      treasury_address, vault_address, operator_address, policy_version, status
    ) VALUES ('${id}', 'staging', '${backend}', 8453, '${BASE_USDC}',
      '0x${treasurySuffix.repeat(40)}', ${vaultValue}, '0x${"2".repeat(40)}', 'v1', 'active')
  `;
}

describe.skipIf(!RUN)("reward settlement asset registry migration 0236 (real Postgres)", () => {
  let db: SQL;

  beforeAll(async () => {
    const root = connect({});
    await root.unsafe(`DROP DATABASE IF EXISTS ${TEST_DB} WITH (FORCE)`);
    await root.unsafe(`CREATE DATABASE ${TEST_DB}`);
    await root.end();

    db = connect({ db: TEST_DB });
    await db.unsafe("DROP ROLE IF EXISTS control_plane_api_rw");
    await db.unsafe(
      `CREATE ROLE control_plane_api_rw LOGIN PASSWORD '${RW_PASSWORD}' NOSUPERUSER NOCREATEDB NOCREATEROLE`,
    );
    await db.unsafe("GRANT USAGE ON SCHEMA public TO control_plane_api_rw");
    await applyMigration(
      db,
      "db/control-plane/migrations/0236_control_plane_reward_settlement_asset_registry.sql",
    );
  });

  afterAll(async () => {
    await db?.end();
    const root = connect({});
    await root.unsafe(`DROP DATABASE IF EXISTS ${TEST_DB} WITH (FORCE)`).catch(() => undefined);
    await root.unsafe("DROP ROLE IF EXISTS control_plane_api_rw").catch(() => undefined);
    await root.end();
  });

  test("seeds exactly the two canonical USDC identities as admitted usd_par", async () => {
    const rows = await db.unsafe(
      "SELECT chain_id, token_address, decimals, symbol, denomination_policy, status FROM reward_settlement_assets ORDER BY chain_id",
    );
    expect(rows).toEqual([
      {
        chain_id: 8453,
        token_address: BASE_USDC,
        decimals: 6,
        symbol: "USDC",
        denomination_policy: "usd_par",
        status: "admitted",
      },
      {
        chain_id: 84532,
        token_address: SEPOLIA_USDC,
        decimals: 6,
        symbol: "USDC",
        denomination_policy: "usd_par",
        status: "admitted",
      },
    ]);
  });

  test("admission policy is frozen: usd_par only, decimals >= 2, lowercase address", async () => {
    await expectSqlState(db, assetInsert(1, `0x${"a".repeat(40)}`, 18, "priced"), "23514");
    await expectSqlState(db, assetInsert(1, `0x${"b".repeat(40)}`, 0, "usd_par"), "23514");
    await expectSqlState(db, assetInsert(1, `0x${"A".repeat(40)}`, 6, "usd_par"), "23514");
  });

  test("asset identity is immutable", async () => {
    await expectSqlState(
      db,
      "UPDATE reward_settlement_assets SET decimals = 8 WHERE chain_id = 8453",
      "P0001",
    );
    await expectSqlState(
      db,
      "UPDATE reward_settlement_assets SET admitted_by = 'rewritten' WHERE chain_id = 8453",
      "P0001",
    );
  });

  test("same-status updates may not rewrite lifecycle evidence", async () => {
    // Admitted row: quote cutoff cannot appear outside a retirement transition.
    await expectSqlState(
      db,
      "UPDATE reward_settlement_assets SET quote_cutoff_at = NOW() WHERE chain_id = 8453",
      "P0001",
    );
    // Suspended row: the suspension timestamp is fixed at transition time.
    await db.unsafe(
      "UPDATE reward_settlement_assets SET status = 'suspended', suspended_at = NOW() WHERE chain_id = 84532",
    );
    await expectSqlState(
      db,
      "UPDATE reward_settlement_assets SET suspended_at = NOW() + INTERVAL '1 hour' WHERE chain_id = 84532",
      "P0001",
    );
    await db.unsafe(
      "UPDATE reward_settlement_assets SET status = 'admitted', suspended_at = NULL WHERE chain_id = 84532",
    );
  });

  test("suspension requires its timestamp and supports re-admission", async () => {
    await expectSqlState(
      db,
      "UPDATE reward_settlement_assets SET status = 'suspended' WHERE chain_id = 84532",
      "23514",
    );
    await db.unsafe(
      "UPDATE reward_settlement_assets SET status = 'suspended', suspended_at = NOW() WHERE chain_id = 84532",
    );
    await db.unsafe(
      "UPDATE reward_settlement_assets SET status = 'admitted', suspended_at = NULL WHERE chain_id = 84532",
    );
    const [row] = await db.unsafe(
      "SELECT status, suspended_at FROM reward_settlement_assets WHERE chain_id = 84532",
    );
    expect(row).toEqual({ status: "admitted", suspended_at: null });
  });

  test("retirement is evidence-complete, preserves suspension history, and is terminal", async () => {
    await expectSqlState(
      db,
      "UPDATE reward_settlement_assets SET status = 'retired', retired_at = NOW() WHERE chain_id = 84532",
      "23514",
    );
    await db.unsafe(
      "UPDATE reward_settlement_assets SET status = 'suspended', suspended_at = NOW() WHERE chain_id = 84532",
    );
    // Retirement may not rewrite the inherited suspension timestamp.
    await expectSqlState(
      db,
      `UPDATE reward_settlement_assets
       SET status = 'retired', retired_at = NOW(), quote_cutoff_at = NOW(),
           suspended_at = NOW() + INTERVAL '1 hour'
       WHERE chain_id = 84532`,
      "P0001",
    );
    await db.unsafe(
      "UPDATE reward_settlement_assets SET status = 'retired', retired_at = NOW(), quote_cutoff_at = NOW() WHERE chain_id = 84532",
    );
    const [row] = await db.unsafe(
      "SELECT suspended_at IS NOT NULL AS kept FROM reward_settlement_assets WHERE chain_id = 84532",
    );
    expect(row).toEqual({ kept: true });
    await expectSqlState(
      db,
      "UPDATE reward_settlement_assets SET status = 'admitted', suspended_at = NULL, retired_at = NULL, quote_cutoff_at = NULL WHERE chain_id = 84532",
      "P0001",
    );
    await expectSqlState(
      db,
      "DELETE FROM reward_settlement_assets WHERE chain_id = 84532",
      "P0001",
    );
  });

  test("rails bind only registered assets and vault backends carry a vault", async () => {
    await expectSqlState(
      db,
      `INSERT INTO reward_settlement_rails (
        reward_settlement_rail_id, environment, backend, chain_id, token_address,
        treasury_address, vault_address, operator_address, policy_version, status
      ) VALUES ('rail_x', 'staging', 'local', 999, '0x${"c".repeat(40)}',
        '0x${"1".repeat(40)}', NULL, '0x${"2".repeat(40)}', 'v1', 'active')`,
      "23503",
    );
    await expectSqlState(db, railInsert("rail_y", "eoa_vault", null, "1"), "23514");
  });

  test("one active rail per environment and asset; rebinding retires first", async () => {
    await db.unsafe(railInsert("rail_1", "local", null, "1"));
    await expectSqlState(db, railInsert("rail_2", "local", null, "3"), "23505");
    await expectSqlState(
      db,
      `UPDATE reward_settlement_rails SET treasury_address = '0x${"9".repeat(40)}' WHERE reward_settlement_rail_id = 'rail_1'`,
      "P0001",
    );
    await db.unsafe(
      "UPDATE reward_settlement_rails SET status = 'retired' WHERE reward_settlement_rail_id = 'rail_1'",
    );
    await expectSqlState(
      db,
      "UPDATE reward_settlement_rails SET status = 'active' WHERE reward_settlement_rail_id = 'rail_1'",
      "P0001",
    );
    await db.unsafe(railInsert("rail_2", "local", null, "3"));
    await expectSqlState(
      db,
      "DELETE FROM reward_settlement_rails WHERE reward_settlement_rail_id = 'rail_1'",
      "P0001",
    );
  });

  test("the API role reads the registry but cannot mutate it", async () => {
    const rw = connect({ db: TEST_DB, user: "control_plane_api_rw", password: RW_PASSWORD });
    const [row] = await rw.unsafe("SELECT count(*)::int AS assets FROM reward_settlement_assets");
    expect(row).toEqual({ assets: 2 });
    await expectSqlState(rw, assetInsert(10, `0x${"d".repeat(40)}`, 6, "usd_par"), "42501");
    await expectSqlState(
      rw,
      "UPDATE reward_settlement_rails SET status = 'retired' WHERE status = 'active'",
      "42501",
    );
    await expectSqlState(
      rw,
      "DELETE FROM reward_settlement_assets WHERE chain_id = 8453",
      "42501",
    );
    await rw.end();
  });
});
