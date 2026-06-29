/**
 * Real-Postgres integration test for the operator_credentials control-plane migration (0123).
 *
 * Runs ONLY when CONTROL_PLANE_MIGRATION_TEST_ADMIN_URL (or the shared bookings admin URL) is set;
 * CI provisions PostgreSQL and passes an owner/superuser URL. It never hard-codes a host, never
 * prints credentials, and leaves no database/roles behind.
 *
 * Proves the credential table is an INDEPENDENT security boundary: the schema-wide default
 * privileges (which grant the API runtime full write on every new table) are present, yet 0123's
 * REVOKE plus narrow GRANT leave control_plane_api_rw able only to SELECT and to UPDATE the single
 * last_used_at column — never to mint, rescope, reactivate, or erase a credential. Issuance stays
 * with the owning migrator role.
 */
import { SQL } from "bun";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

const ADMIN_URL =
  process.env.CONTROL_PLANE_MIGRATION_TEST_ADMIN_URL ?? process.env.BOOKINGS_MIGRATION_TEST_ADMIN_URL;
const RUN = Boolean(ADMIN_URL);
const TEST_DB = "operator_credentials_migration_test";
const MIGRATION_FILE = "db/control-plane/migrations/0123_control_plane_operator_credentials.sql";

const MIG_PW = "test-migrator-pw";
const RW_PW = "test-rw-pw";
const RO_PW = "test-ro-pw";
const OPS_PW = "test-ops-pw";

function urlFor(opts: { db?: string; user?: string; password?: string }): string {
  const u = new URL(ADMIN_URL as string);
  if (opts.user !== undefined) u.username = opts.user;
  if (opts.password !== undefined) u.password = opts.password;
  if (opts.db !== undefined) u.pathname = `/${opts.db}`;
  if (!u.searchParams.get("sslmode")) u.searchParams.set("sslmode", "disable");
  return u.toString();
}
function connect(opts: { db?: string; user?: string; password?: string }): SQL {
  return new SQL({ url: urlFor(opts), tls: false, max: 1, connectionTimeout: 5 } as Record<string, unknown>);
}
const SQLSTATE = { check: "23514", notNull: "23502", unique: "23505", permission: "42501" } as const;
async function expectRejected(sql: SQL, statement: string, sqlstate: string): Promise<void> {
  let caught: { errno?: string } | undefined;
  try { await sql.unsafe(statement); } catch (e) { caught = e as { errno?: string }; }
  expect(caught, `expected rejection with SQLSTATE ${sqlstate}, got success`).toBeDefined();
  expect(caught?.errno, `expected SQLSTATE ${sqlstate}`).toBe(sqlstate);
}

// A valid row for SELECT/UPDATE probes (inserted as migrator).
const VALID_ROW = `INSERT INTO operator_credentials
  (operator_credential_id, operator_actor_id, label, secret_hash, secret_hash_algo, secret_hash_version,
   scopes_json, status, created_at, expires_at)
  VALUES ('opc_seed','svc_seed','seed','hash_seed','sha256',1,'["bookings:settlement:resolve"]','active',
          '2026-06-28T00:00:00Z','2026-07-28T00:00:00Z')`;

describe.skipIf(!RUN)("operator_credentials migration 0123 (real Postgres)", () => {
  beforeAll(async () => {
    const root = connect({});
    await root.unsafe(`DROP DATABASE IF EXISTS ${TEST_DB} WITH (FORCE)`);
    await root.unsafe(`CREATE DATABASE ${TEST_DB}`);
    await root.end();

    const db = connect({ db: TEST_DB });
    for (const [role, pw] of [
      ["control_plane_migrator", MIG_PW], ["control_plane_api_rw", RW_PW],
      ["control_plane_api_ro", RO_PW], ["control_plane_ops_ro", OPS_PW],
    ] as const) {
      await db.unsafe(`DROP ROLE IF EXISTS ${role}`);
      await db.unsafe(`CREATE ROLE ${role} LOGIN PASSWORD '${pw}' NOSUPERUSER NOCREATEDB NOCREATEROLE`);
    }
    await db.unsafe(`GRANT CREATE, USAGE ON SCHEMA public TO control_plane_migrator`);
    for (const role of ["control_plane_api_rw", "control_plane_api_ro", "control_plane_ops_ro"]) {
      await db.unsafe(`GRANT USAGE ON SCHEMA public TO ${role}`);
    }
    // Replicate the PRODUCTION exposure: default privileges for the migrator role grant the runtime
    // full write on every new table. 0123 must override this for operator_credentials.
    await db.unsafe(
      `ALTER DEFAULT PRIVILEGES FOR ROLE control_plane_migrator IN SCHEMA public ` +
      `GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO control_plane_api_rw`,
    );
    await db.unsafe(
      `ALTER DEFAULT PRIVILEGES FOR ROLE control_plane_migrator IN SCHEMA public ` +
      `GRANT SELECT ON TABLES TO control_plane_api_ro, control_plane_ops_ro`,
    );
    await db.end();

    // Apply 0123 AS the migrator (so the table is migrator-owned and subject to the default privileges),
    // statement by statement (its comments contain no semicolons).
    const sql = await Bun.file(MIGRATION_FILE).text();
    const statements = sql
      .split("\n").filter((l) => !l.trimStart().startsWith("--")).join("\n")
      .split(";").map((s) => s.trim()).filter(Boolean);
    const mig = connect({ db: TEST_DB, user: "control_plane_migrator", password: MIG_PW });
    for (const stmt of statements) await mig.unsafe(stmt);
    await mig.unsafe(VALID_ROW);
    await mig.end();
  });

  afterAll(async () => {
    const root = connect({});
    await root.unsafe(`DROP DATABASE IF EXISTS ${TEST_DB} WITH (FORCE)`).catch(() => {});
    for (const role of ["control_plane_api_rw", "control_plane_api_ro", "control_plane_ops_ro", "control_plane_migrator"]) {
      await root.unsafe(`DROP ROLE IF EXISTS ${role}`).catch(() => {});
    }
    await root.end();
  });

  test("table is owned by the migrator", async () => {
    const db = connect({ db: TEST_DB });
    const r = await db.unsafe(`SELECT tableowner FROM pg_tables WHERE tablename='operator_credentials'`);
    expect(r[0]?.tableowner).toBe("control_plane_migrator");
    await db.end();
  });

  test("default privileges DID grant the runtime write on a sibling table (the exposure is real)", async () => {
    const mig = connect({ db: TEST_DB, user: "control_plane_migrator", password: MIG_PW });
    await mig.unsafe(`CREATE TABLE _probe (id TEXT PRIMARY KEY)`);
    try {
      const rw = connect({ db: TEST_DB, user: "control_plane_api_rw", password: RW_PW });
      await rw.unsafe(`INSERT INTO _probe(id) VALUES('x')`); // default privilege => RW write
      await rw.end();
    } finally {
      await mig.unsafe(`DROP TABLE _probe`);
      await mig.end();
    }
  });

  test("API runtime (api_rw) can SELECT and UPDATE only last_used_at — never mint/rescope/reactivate/erase", async () => {
    const rw = connect({ db: TEST_DB, user: "control_plane_api_rw", password: RW_PW });
    const sel = await rw.unsafe(`SELECT operator_credential_id, status FROM operator_credentials WHERE operator_credential_id='opc_seed'`);
    expect(sel.length).toBe(1);
    // throttled last_used_at touch is the ONLY permitted write
    await rw.unsafe(`UPDATE operator_credentials SET last_used_at='2026-06-28T01:00:00Z' WHERE operator_credential_id='opc_seed'`);
    // mint
    await expectRejected(rw, `INSERT INTO operator_credentials
      (operator_credential_id, operator_actor_id, label, secret_hash, secret_hash_algo, secret_hash_version, scopes_json, status, created_at, expires_at)
      VALUES ('opc_evil','svc','x','h2','sha256',1,'["bookings:settlement:resolve"]','active','2026-06-28T00:00:00Z','2026-07-28T00:00:00Z')`, SQLSTATE.permission);
    // rescope
    await expectRejected(rw, `UPDATE operator_credentials SET scopes_json='["*"]' WHERE operator_credential_id='opc_seed'`, SQLSTATE.permission);
    // reactivate (clear revocation)
    await expectRejected(rw, `UPDATE operator_credentials SET status='active', revoked_at=NULL WHERE operator_credential_id='opc_seed'`, SQLSTATE.permission);
    // erase
    await expectRejected(rw, `DELETE FROM operator_credentials WHERE operator_credential_id='opc_seed'`, SQLSTATE.permission);
    await rw.end();
  });

  test("read-only roles can SELECT but not write", async () => {
    for (const [user, pw] of [["control_plane_api_ro", RO_PW], ["control_plane_ops_ro", OPS_PW]] as const) {
      const ro = connect({ db: TEST_DB, user, password: pw });
      const sel = await ro.unsafe(`SELECT operator_credential_id FROM operator_credentials WHERE operator_credential_id='opc_seed'`);
      expect(sel.length).toBe(1);
      await expectRejected(ro, `UPDATE operator_credentials SET last_used_at='2026-06-28T02:00:00Z' WHERE operator_credential_id='opc_seed'`, SQLSTATE.permission);
      await expectRejected(ro, `DELETE FROM operator_credentials WHERE operator_credential_id='opc_seed'`, SQLSTATE.permission);
      await ro.end();
    }
  });

  test("migrator (issuer) retains full write", async () => {
    const mig = connect({ db: TEST_DB, user: "control_plane_migrator", password: MIG_PW });
    await mig.unsafe(`INSERT INTO operator_credentials
      (operator_credential_id, operator_actor_id, label, secret_hash, secret_hash_algo, secret_hash_version, scopes_json, status, created_at, expires_at)
      VALUES ('opc_mig','svc','m','h_mig','sha256',1,'[]','active','2026-06-28T00:00:00Z','2026-07-28T00:00:00Z')`);
    await mig.unsafe(`DELETE FROM operator_credentials WHERE operator_credential_id='opc_mig'`);
    await mig.end();
  });

  test("schema constraints reject invalid rows", async () => {
    const mig = connect({ db: TEST_DB, user: "control_plane_migrator", password: MIG_PW });
    const base = (over: string) => `INSERT INTO operator_credentials
      (operator_credential_id, operator_actor_id, label, secret_hash, secret_hash_algo, secret_hash_version, scopes_json, status, created_at, expires_at${over ? `, ${over.split("=")[0]}` : ""})
      VALUES ('opc_x','svc','x','h_x','sha256',1,'[]','active','2026-06-28T00:00:00Z','2026-07-28T00:00:00Z'${over ? `, ${over.split("=")[1]}` : ""})`;
    // active row cannot carry revoked_at
    await expectRejected(mig, base("revoked_at='2026-06-28T05:00:00Z'"), SQLSTATE.check);
    // expiry must be after creation
    await expectRejected(mig, `INSERT INTO operator_credentials
      (operator_credential_id, operator_actor_id, label, secret_hash, secret_hash_algo, secret_hash_version, scopes_json, status, created_at, expires_at)
      VALUES ('opc_exp','svc','x','h_exp','sha256',1,'[]','active','2026-07-28T00:00:00Z','2026-06-28T00:00:00Z')`, SQLSTATE.check);
    // superseded must pair with rotated_at and require revoked status
    await expectRejected(mig, `INSERT INTO operator_credentials
      (operator_credential_id, operator_actor_id, label, secret_hash, secret_hash_algo, secret_hash_version, scopes_json, status, created_at, expires_at, superseded_by_credential_id)
      VALUES ('opc_sup','svc','x','h_sup','sha256',1,'[]','active','2026-06-28T00:00:00Z','2026-07-28T00:00:00Z','opc_seed')`, SQLSTATE.check);
    // duplicate secret_hash rejected
    await expectRejected(mig, `INSERT INTO operator_credentials
      (operator_credential_id, operator_actor_id, label, secret_hash, secret_hash_algo, secret_hash_version, scopes_json, status, created_at, expires_at)
      VALUES ('opc_dup','svc','x','hash_seed','sha256',1,'[]','active','2026-06-28T00:00:00Z','2026-07-28T00:00:00Z')`, SQLSTATE.unique);
    await mig.end();
  });
});
