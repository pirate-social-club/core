/**
 * Real-Postgres integration test for the global `bookings` migration root (b0001…).
 *
 * Runs ONLY when BOOKINGS_MIGRATION_TEST_ADMIN_URL is set (CI provisions PostgreSQL 17 and passes an
 * owner/superuser URL via the service's published port). It never hard-codes a host/container IP, never
 * prints credentials, and leaves no database/roles/rows behind. The local-sandbox published-port quirk
 * is irrelevant to CI.
 *
 * Shape: bootstrap extension + roles AS OWNER, run the REAL runner AS the non-superuser migrator, then
 * assert ledger/replay/grants/default-privileges/constraints, and tear everything down.
 */
import { SQL } from "bun";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

const ADMIN_URL = process.env.BOOKINGS_MIGRATION_TEST_ADMIN_URL;
const RUN = Boolean(ADMIN_URL);
const TEST_DB = "bookings_migration_test";
const MIGRATIONS_DIR = "db/bookings/migrations";

const MIG_PW = "test-migrator-pw";
const RW_PW = "test-rw-pw";
const RO_PW = "test-ro-pw";

// Build a same-cluster URL for a specific db/user without string-concatenating credentials.
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
// Assert the SPECIFIC PostgreSQL SQLSTATE (bun surfaces it on err.errno) so a missing table (42P01) or
// other unexpected error can never masquerade as a constraint/permission success.
const SQLSTATE = { check: "23514", notNull: "23502", exclusion: "23P01", permission: "42501" } as const;
async function expectRejected(sql: SQL, statement: string, sqlstate: string): Promise<void> {
  let caught: { errno?: string } | undefined;
  try { await sql.unsafe(statement); } catch (e) { caught = e as { errno?: string }; }
  expect(caught, `expected rejection with SQLSTATE ${sqlstate}, got success`).toBeDefined();
  expect(caught?.errno, `expected SQLSTATE ${sqlstate}`).toBe(sqlstate);
}

const EXPECTED_MIGRATIONS = [
  "b0001_bookings_global_schema.sql",
  "b0002_booking_settlement_review.sql",
];

// The exact table set the bookings migrations must create in the bookings schema.
const EXPECTED_TABLES = [
  "attendance_heartbeats", "attendance_sessions", "availability_exceptions", "availability_rules",
  "bookings", "holds", "host_slot_locks", "payment_intents", "price_rules", "profiles", "settlement_effects",
];

// Run the actual migration runner as the non-superuser migrator; returns {applied, skipped}.
async function runMigrator(): Promise<{ applied: number; skipped: number }> {
  const env = {
    ...process.env,
    CONTROL_PLANE_MIGRATOR_DATABASE_URL: urlFor({ db: TEST_DB, user: "control_plane_migrator", password: MIG_PW }),
  };
  const proc = Bun.spawn(
    ["bun", "run", "scripts/control-plane/apply-postgres-migrations.ts",
     "--database-url-env", "CONTROL_PLANE_MIGRATOR_DATABASE_URL",
     "--migrations", MIGRATIONS_DIR, "--label", "bookings"],
    { env, stdout: "pipe", stderr: "pipe" },
  );
  const out = await new Response(proc.stdout).text();
  const err = await new Response(proc.stderr).text();
  await proc.exited;
  expect(proc.exitCode, `runner exited non-zero:\n${err}`).toBe(0);
  return {
    applied: Number(out.match(/applied:\s*(\d+)/)?.[1] ?? "-1"),
    skipped: Number(out.match(/skipped:\s*(\d+)/)?.[1] ?? "-1"),
  };
}

describe.skipIf(!RUN)("bookings global migration (real Postgres)", () => {
  beforeAll(async () => {
    // Fresh, isolated database so teardown leaves nothing behind.
    const root = connect({});
    await root.unsafe(`DROP DATABASE IF EXISTS ${TEST_DB} WITH (FORCE)`);
    await root.unsafe(`CREATE DATABASE ${TEST_DB}`);
    await root.end();
    // Owner bootstrap inside the test db: extension + roles + the intended (non-superuser) migrator privileges.
    const db = connect({ db: TEST_DB });
    await db.unsafe(`CREATE EXTENSION IF NOT EXISTS btree_gist`);
    for (const [role, pw] of [["control_plane_migrator", MIG_PW], ["control_plane_api_rw", RW_PW], ["control_plane_api_ro", RO_PW]] as const) {
      await db.unsafe(`DROP ROLE IF EXISTS ${role}`);
      await db.unsafe(`CREATE ROLE ${role} LOGIN PASSWORD '${pw}' NOSUPERUSER NOCREATEDB NOCREATEROLE`);
    }
    await db.unsafe(`GRANT CREATE ON DATABASE ${TEST_DB} TO control_plane_migrator`);
    // CREATE on public lets the migrator own the shared public.schema_migrations ledger (PG15+ no longer
    // grants this by default). On the real control-plane DB the migrator already holds it. No role
    // membership is granted to the migrator: owning the bookings tables is sufficient to GRANT privileges
    // to the runtime roles, so the privilege model stays production-shaped.
    await db.unsafe(`GRANT CREATE, USAGE ON SCHEMA public TO control_plane_migrator`);
    await db.end();
  });

  afterAll(async () => {
    const root = connect({});
    await root.unsafe(`DROP DATABASE IF EXISTS ${TEST_DB} WITH (FORCE)`).catch(() => {});
    for (const role of ["control_plane_migrator", "control_plane_api_rw", "control_plane_api_ro"]) {
      await root.unsafe(`DROP ROLE IF EXISTS ${role}`).catch(() => {});
    }
    await root.end();
  });

  test("btree_gist is installed (version-agnostic)", async () => {
    const db = connect({ db: TEST_DB });
    const rows = await db.unsafe(`SELECT 1 FROM pg_extension WHERE extname = 'btree_gist'`);
    await db.end();
    expect(rows.length).toBe(1);
  });

  test("first apply applies the expected migrations with labeled ledger rows", async () => {
    const { applied, skipped } = await runMigrator();
    expect(applied).toBe(EXPECTED_MIGRATIONS.length);
    expect(skipped).toBe(0);
    const db = connect({ db: TEST_DB });
    const led = await db.unsafe(`SELECT migration_name, migration_label FROM public.schema_migrations WHERE migration_label = 'bookings' ORDER BY migration_name`);
    await db.end();
    expect(led.map((row: { migration_name: string }) => row.migration_name)).toEqual(EXPECTED_MIGRATIONS);
    for (const row of led) expect(row.migration_label).toBe("bookings");
  });

  test("replay is idempotent", async () => {
    const { applied, skipped } = await runMigrator();
    expect(applied).toBe(0);
    expect(skipped).toBe(EXPECTED_MIGRATIONS.length);
  });

  test("exactly the expected tables exist, all owned by the migrator", async () => {
    const db = connect({ db: TEST_DB });
    const rows = await db.unsafe(`SELECT tablename, tableowner FROM pg_tables WHERE schemaname = 'bookings' ORDER BY tablename`);
    await db.end();
    expect(rows.map((r: { tablename: string }) => r.tablename)).toEqual(EXPECTED_TABLES);
    for (const r of rows) expect(r.tableowner).toBe("control_plane_migrator");
  });

  test("RW role has full CRUD", async () => {
    const rw = connect({ db: TEST_DB, user: "control_plane_api_rw", password: RW_PW });
    await rw.unsafe(`INSERT INTO bookings.profiles(host_user_id,host_timezone,base_price_cents,default_slot_duration_seconds) VALUES('crud','UTC',5000,1800)`);
    const sel = await rw.unsafe(`SELECT host_user_id FROM bookings.profiles WHERE host_user_id='crud'`);
    expect(sel.length).toBe(1);
    await rw.unsafe(`UPDATE bookings.profiles SET base_price_cents=6000 WHERE host_user_id='crud'`);
    await rw.unsafe(`DELETE FROM bookings.profiles WHERE host_user_id='crud'`);
    await rw.end();
  });

  test("RO role can SELECT but not INSERT/UPDATE/DELETE", async () => {
    const rw = connect({ db: TEST_DB, user: "control_plane_api_rw", password: RW_PW });
    await rw.unsafe(`INSERT INTO bookings.profiles(host_user_id,host_timezone,base_price_cents,default_slot_duration_seconds) VALUES('roprobe','UTC',5000,1800)`);
    await rw.end();
    const ro = connect({ db: TEST_DB, user: "control_plane_api_ro", password: RO_PW });
    const sel = await ro.unsafe(`SELECT host_user_id FROM bookings.profiles WHERE host_user_id='roprobe'`);
    expect(sel.length).toBe(1);
    await expectRejected(ro, `INSERT INTO bookings.profiles(host_user_id,host_timezone,base_price_cents,default_slot_duration_seconds) VALUES('ro2','UTC',5000,1800)`, SQLSTATE.permission);
    await expectRejected(ro, `UPDATE bookings.profiles SET base_price_cents=1 WHERE host_user_id='roprobe'`, SQLSTATE.permission);
    await expectRejected(ro, `DELETE FROM bookings.profiles WHERE host_user_id='roprobe'`, SQLSTATE.permission);
    await ro.end();
    const rw2 = connect({ db: TEST_DB, user: "control_plane_api_rw", password: RW_PW });
    await rw2.unsafe(`DELETE FROM bookings.profiles WHERE host_user_id='roprobe'`);
    await rw2.end();
  });

  test("default privileges reach a later migrator-owned table, then clean up", async () => {
    const mig = connect({ db: TEST_DB, user: "control_plane_migrator", password: MIG_PW });
    await mig.unsafe(`CREATE TABLE bookings._probe (id TEXT PRIMARY KEY)`);
    try {
      const rw = connect({ db: TEST_DB, user: "control_plane_api_rw", password: RW_PW });
      await rw.unsafe(`INSERT INTO bookings._probe(id) VALUES('x')`); // default privilege => RW write
      await rw.end();
      const ro = connect({ db: TEST_DB, user: "control_plane_api_ro", password: RO_PW });
      const sel = await ro.unsafe(`SELECT id FROM bookings._probe`); // default privilege => RO read
      expect(sel.length).toBe(1);
      await expectRejected(ro, `INSERT INTO bookings._probe(id) VALUES('y')`, SQLSTATE.permission);
      await ro.end();
    } finally {
      await mig.unsafe(`DROP TABLE bookings._probe`);
      await mig.end();
    }
  });

  test("schema constraints reject invalid rows and accept valid ones", async () => {
    const rw = connect({ db: TEST_DB, user: "control_plane_api_rw", password: RW_PW });
    await rw.unsafe(`INSERT INTO bookings.profiles(host_user_id,host_timezone,base_price_cents,default_slot_duration_seconds) VALUES('h','UTC',5000,1800) ON CONFLICT DO NOTHING`);
    await rw.unsafe(`INSERT INTO bookings.holds(hold_id,host_user_id,booker_user_id,slot_start_utc,slot_end_utc,price_cents,status,expires_at_utc) VALUES('hld','h','b','2026-07-01 09:00:00+00','2026-07-01 10:00:00+00',5000,'active',now() + interval '10 minutes') ON CONFLICT DO NOTHING`);
    // availability weekday cardinality + range (cardinality() rejects empty arrays where array_length() would not)
    await expectRejected(rw, `INSERT INTO bookings.availability_rules(rule_id,host_user_id,by_weekday,start_local,end_local,slot_duration_seconds) VALUES('r1','h','{}','09:00','17:00',1800)`, SQLSTATE.check);
    await expectRejected(rw, `INSERT INTO bookings.availability_rules(rule_id,host_user_id,by_weekday,start_local,end_local,slot_duration_seconds) VALUES('r2','h','{7}','09:00','17:00',1800)`, SQLSTATE.check);
    await rw.unsafe(`INSERT INTO bookings.availability_rules(rule_id,host_user_id,by_weekday,start_local,end_local,slot_duration_seconds) VALUES('r3','h','{1,5}','09:00','17:00',1800)`);
    await expectRejected(rw, `INSERT INTO bookings.availability_rules(rule_id,host_user_id,by_weekday,start_local,end_local,slot_duration_seconds,effective_from_utc,effective_until_utc) VALUES('r4','h','{1}','09:00','17:00',1800,'2026-07-02 00:00:00+00','2026-07-01 00:00:00+00')`, SQLSTATE.check);
    // price-rule weekday (empty + out-of-range) and time window (half-specified + fully-specified-but-reversed)
    await expectRejected(rw, `INSERT INTO bookings.price_rules(price_rule_id,host_user_id,match_weekday,price_cents) VALUES('pw0','h','{}',6000)`, SQLSTATE.check);
    await expectRejected(rw, `INSERT INTO bookings.price_rules(price_rule_id,host_user_id,match_weekday,price_cents) VALUES('pw7','h','{7}',6000)`, SQLSTATE.check);
    await expectRejected(rw, `INSERT INTO bookings.price_rules(price_rule_id,host_user_id,match_local_start,price_cents) VALUES('p1','h','18:00',6000)`, SQLSTATE.check);
    await expectRejected(rw, `INSERT INTO bookings.price_rules(price_rule_id,host_user_id,match_local_start,match_local_end,price_cents) VALUES('prev','h','20:00','18:00',6000)`, SQLSTATE.check);
    await rw.unsafe(`INSERT INTO bookings.price_rules(price_rule_id,host_user_id,match_weekday,match_local_start,match_local_end,price_cents) VALUES('pok','h','{1,5}','18:00','20:00',6000)`);
    // fee snapshot mandatory (omitting the fee columns violates NOT NULL)
    await expectRejected(rw, `INSERT INTO bookings.payment_intents(payment_intent_id,hold_id,chain_id,token_address,token_decimals,token_symbol,recipient_address,amount_atomic,gross_cents,quote_expires_at,hold_expires_at,status,created_at,updated_at) VALUES('pi1','hld',84532,'0xt',6,'USDC','0xr',1000000,5000,now(),now(),'active',now(),now())`, SQLSTATE.notNull);
    // fee snapshot must balance to gross_cents
    await expectRejected(rw, `INSERT INTO bookings.payment_intents(payment_intent_id,hold_id,chain_id,token_address,token_decimals,token_symbol,recipient_address,amount_atomic,gross_cents,platform_fee_bps,platform_fee_cents,host_payout_cents,quote_expires_at,hold_expires_at,status,created_at,updated_at) VALUES('pi2','hld',84532,'0xt',6,'USDC','0xr',1000000,5000,1000,10,90,now(),now(),'active',now(),now())`, SQLSTATE.check);
    await rw.unsafe(`INSERT INTO bookings.payment_intents(payment_intent_id,hold_id,chain_id,token_address,token_decimals,token_symbol,recipient_address,amount_atomic,gross_cents,platform_fee_bps,platform_fee_cents,host_payout_cents,quote_expires_at,hold_expires_at,status,created_at,updated_at) VALUES('pi3','hld',84532,'0xt',6,'USDC','0xr',1000000,5000,1000,500,4500,now(),now(),'active',now(),now())`);
    // settlement-review shape: pending reviews require disputed state, reason, opened_at, and no resolution
    await rw.unsafe(`INSERT INTO bookings.bookings(booking_id,host_user_id,booker_user_id,slot_start_utc,slot_end_utc,gross_cents,platform_fee_bps,platform_fee_cents,host_payout_cents,status,created_at,updated_at) VALUES('b1','h','b','2026-07-02 09:00:00+00','2026-07-02 10:00:00+00',5000,1000,500,4500,'confirmed',now(),now())`);
    await expectRejected(rw, `UPDATE bookings.bookings SET status='disputed', settlement_review_status='pending', settlement_review_reason='attendance_ambiguous' WHERE booking_id='b1'`, SQLSTATE.check);
    await rw.unsafe(`UPDATE bookings.bookings SET status='disputed', settlement_review_status='pending', settlement_review_reason='attendance_ambiguous', settlement_review_opened_at=now(), settlement_review_version=settlement_review_version+1 WHERE booking_id='b1'`);
    // slot exclusion (btree_gist): adjacent accepted, overlap rejected
    await rw.unsafe(`INSERT INTO bookings.host_slot_locks(lock_id,host_user_id,slot_start_utc,slot_end_utc,status) VALUES('l1','h','2026-07-01 09:00:00+00','2026-07-01 10:00:00+00','active')`);
    await expectRejected(rw, `INSERT INTO bookings.host_slot_locks(lock_id,host_user_id,slot_start_utc,slot_end_utc,status) VALUES('l2','h','2026-07-01 09:30:00+00','2026-07-01 10:30:00+00','active')`, SQLSTATE.exclusion);
    await rw.unsafe(`INSERT INTO bookings.host_slot_locks(lock_id,host_user_id,slot_start_utc,slot_end_utc,status) VALUES('l3','h','2026-07-01 10:00:00+00','2026-07-01 11:00:00+00','active')`);
    await rw.end();
  });
});
