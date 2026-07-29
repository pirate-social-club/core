import { SQL } from "bun";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { applyPostgresMigrations } from "../lib/postgres-migrations";

const ADMIN_URL = process.env.CONTROL_PLANE_MIGRATION_TEST_ADMIN_URL;
const RUN = Boolean(ADMIN_URL);
const TEST_DB = "promotion_shadow_migration_test";

function urlFor(db: string): string {
  const url = new URL(ADMIN_URL as string);
  url.pathname = `/${db}`;
  if (!url.searchParams.get("sslmode")) url.searchParams.set("sslmode", "disable");
  return url.toString();
}

function connect(db = "postgres"): SQL {
  return new SQL({ url: urlFor(db), tls: false, max: 4, connectionTimeout: 5 } as Record<string, unknown>);
}

async function expectSqlState(sql: SQL, statement: string, state: string): Promise<void> {
  let caught: { errno?: string } | undefined;
  try {
    await sql.unsafe(statement);
  } catch (error) {
    caught = error as { errno?: string };
  }
  expect(caught?.errno).toBe(state);
}

describe.skipIf(!RUN)("promotion shadow migration", () => {
  beforeAll(async () => {
    const admin = connect();
    await admin.unsafe(`DROP DATABASE IF EXISTS ${TEST_DB} WITH (FORCE)`);
    await admin.unsafe(`CREATE DATABASE ${TEST_DB}`);
    await admin.end();
    await applyPostgresMigrations({
      databaseUrl: urlFor(TEST_DB),
      migrationsDir: "db/promotion/migrations",
      label: "promotion-shadow",
    });
  });

  afterAll(async () => {
    const admin = connect();
    await admin.unsafe(`DROP DATABASE IF EXISTS ${TEST_DB} WITH (FORCE)`).catch(() => {});
    await admin.end();
  });

  test("is explicitly versioned and contains no rc_id column", async () => {
    const db = connect(TEST_DB);
    const [metadata] = await db.unsafe(`
      SELECT schema_version FROM promotion_shadow.schema_metadata
    `) as { schema_version: number }[];
    const forbidden = await db.unsafe(`
      SELECT table_name
      FROM information_schema.columns
      WHERE table_schema = 'promotion_shadow' AND column_name = 'rc_id'
    `);
    await db.end();
    expect(metadata?.schema_version).toBe(1);
    expect(forbidden).toHaveLength(0);
  });

  test("requires shadow IDs and a positive explicit lease epoch", async () => {
    const db = connect(TEST_DB);
    await expectSqlState(
      db,
      `INSERT INTO promotion_shadow.candidates
       (candidate_id, web_sha, api_sha, core_sha, manifest)
       VALUES ('rc_forbidden', 'w', 'a', 'c', '{}')`,
      "23514",
    );
    await db.unsafe(`
      INSERT INTO promotion_shadow.candidates
      (candidate_id, web_sha, api_sha, core_sha, manifest)
      VALUES ('shc_schema_test', 'w', 'a', 'c', '{}')
    `);
    await expectSqlState(
      db,
      `INSERT INTO promotion_shadow.promoter_leases
       (lane, owner, fencing_token, acquired_at, heartbeat_at, expires_at)
       VALUES ('shadow', 'runner', 1, clock_timestamp(), clock_timestamp(), clock_timestamp() + interval '1 minute')`,
      "23502",
    );
    await db.end();
  });

  test("enforces single-flight, delivery idempotency, and intentional reruns", async () => {
    const db = connect(TEST_DB);
    await db.unsafe(`
      INSERT INTO promotion_shadow.gate_deliveries
      (delivery_id, candidate_id, gate_id, gate_version, source_run_id, source_run_attempt, classified_as)
      VALUES ('delivery_1', 'shc_schema_test', 'schema', 1, 'run-1', 1, 'attempt')
    `);
    const insert = (id: string, attempt: number, delivery: string | null, status = "running") => `
      INSERT INTO promotion_shadow.attestation_attempts
      (attempt_id, delivery_id, candidate_id, gate_id, gate_version, attempt_no,
       status, result, completed_at)
      VALUES (
        '${id}', ${delivery === null ? "NULL" : `'${delivery}'`},
        'shc_schema_test', 'schema', 1, ${attempt}, '${status}',
        ${status === "terminal" ? "'pass'" : "NULL"},
        ${status === "terminal" ? "clock_timestamp()" : "NULL"}
      )
    `;
    await db.unsafe(insert("att_1", 1, "delivery_1"));
    await expectSqlState(db, insert("att_concurrent", 2, null), "23505");
    await db.unsafe(`
      UPDATE promotion_shadow.attestation_attempts
      SET status = 'terminal', result = 'pass', completed_at = clock_timestamp()
      WHERE attempt_id = 'att_1'
    `);
    await expectSqlState(
      db,
      `INSERT INTO promotion_shadow.gate_deliveries
       (delivery_id, candidate_id, gate_id, gate_version, source_run_id, source_run_attempt, classified_as)
       VALUES ('delivery_duplicate', 'shc_schema_test', 'schema', 1, 'run-1', 1, 'observation')`,
      "23505",
    );
    await db.unsafe(`
      INSERT INTO promotion_shadow.gate_deliveries
      (delivery_id, candidate_id, gate_id, gate_version, source_run_id, source_run_attempt, classified_as)
      VALUES ('delivery_2', 'shc_schema_test', 'schema', 1, 'run-1', 2, 'attempt')
    `);
    await db.unsafe(insert("att_rerun", 2, "delivery_2", "terminal"));
    await db.end();
  });

  test("rejects impossible completion time and stores shadow decisions", async () => {
    const db = connect(TEST_DB);
    await expectSqlState(
      db,
      `INSERT INTO promotion_shadow.attestation_attempts
       (attempt_id, candidate_id, gate_id, gate_version, attempt_no, status, result,
        started_at, completed_at)
       VALUES ('att_time', 'shc_schema_test', 'time', 1, 1, 'terminal', 'pass',
               clock_timestamp(), clock_timestamp() - interval '1 minute')`,
      "23514",
    );
    await db.unsafe(`
      INSERT INTO promotion_shadow.shadow_decisions
      (decision_id, candidate_id, scenario, decision, hypothetical_deployed_sha, decided_at)
      VALUES ('decision_1', 'shc_schema_test', 'p95-v1', 'admitted', 'abc', clock_timestamp())
    `);
    const decisions = await db.unsafe(`SELECT decision FROM promotion_shadow.shadow_decisions`);
    await db.end();
    expect(decisions).toHaveLength(1);
  });
});
