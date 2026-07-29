/**
 * Real-PostgreSQL integration coverage for the migration runner's invocation
 * lock. CI supplies CONTROL_PLANE_MIGRATION_TEST_ADMIN_URL.
 */
import { SQL } from "bun";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ADMIN_URL = process.env.CONTROL_PLANE_MIGRATION_TEST_ADMIN_URL;
const RUN = Boolean(ADMIN_URL);
const TEST_DB = "postgres_migration_lock_test";
let testRoot = "";
let rootA = "";
let rootB = "";

function urlFor(db: string): string {
  const url = new URL(ADMIN_URL as string);
  url.pathname = `/${db}`;
  if (!url.searchParams.get("sslmode")) url.searchParams.set("sslmode", "disable");
  return url.toString();
}

function connect(db = "postgres"): SQL {
  return new SQL({ url: urlFor(db), tls: false, max: 1, connectionTimeout: 5 } as Record<string, unknown>);
}

function spawnMigrator(root: string, label: string): ReturnType<typeof Bun.spawn> {
  return Bun.spawn(
    [
      "bun",
      "run",
      "scripts/control-plane/apply-postgres-migrations.ts",
      "--database-url-env",
      "MIGRATION_LOCK_TEST_URL",
      "--migrations",
      root,
      "--label",
      label,
    ],
    {
      env: { ...process.env, MIGRATION_LOCK_TEST_URL: urlFor(TEST_DB) },
      stdout: "pipe",
      stderr: "pipe",
    },
  );
}

async function waitForAdvisoryLock(db: SQL): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const rows = await db.unsafe(`
      SELECT 1
      FROM pg_locks
      WHERE locktype = 'advisory' AND granted
      LIMIT 1
    `);
    if (rows.length === 1) return;
    await Bun.sleep(25);
  }
  throw new Error("migration runner did not acquire its advisory lock");
}

async function waitForContendedAdvisoryLock(db: SQL): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const [row] = await db.unsafe(`
      SELECT
        COUNT(*) FILTER (WHERE granted)::int AS granted_count,
        COUNT(*) FILTER (WHERE NOT granted)::int AS waiting_count
      FROM pg_locks
      WHERE locktype = 'advisory'
    `) as { granted_count: number; waiting_count: number }[];
    if (row?.granted_count === 1 && row.waiting_count === 1) return;
    await Bun.sleep(25);
  }
  throw new Error("second migration runner did not wait on the advisory lock");
}

async function expectProcessSuccess(proc: ReturnType<typeof Bun.spawn>): Promise<void> {
  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  await proc.exited;
  expect(proc.exitCode, `runner exited non-zero:\n${stderr}\n${stdout}`).toBe(0);
}

describe.skipIf(!RUN)("Postgres migration invocation lock", () => {
  beforeAll(async () => {
    testRoot = mkdtempSync(join(tmpdir(), "pirate-postgres-migration-lock-"));
    rootA = join(testRoot, "root-a");
    rootB = join(testRoot, "root-b");
    mkdirSync(rootA);
    mkdirSync(rootB);

    writeFileSync(join(rootA, "lock_a001.sql"), `
      CREATE TABLE migration_lock_probe (
        event text PRIMARY KEY,
        backend_pid int NOT NULL,
        recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()
      );
      INSERT INTO migration_lock_probe(event, backend_pid)
      VALUES ('a-first', pg_backend_pid());
      SELECT pg_sleep(1);
    `);
    writeFileSync(join(rootA, "lock_a002.sql"), `
      INSERT INTO migration_lock_probe(event, backend_pid)
      VALUES ('a-second', pg_backend_pid());
    `);
    writeFileSync(join(rootB, "lock_b001.sql"), `
      INSERT INTO migration_lock_probe(event, backend_pid)
      VALUES ('b-first', pg_backend_pid());
    `);

    const admin = connect();
    await admin.unsafe(`DROP DATABASE IF EXISTS ${TEST_DB} WITH (FORCE)`);
    await admin.unsafe(`CREATE DATABASE ${TEST_DB}`);
    await admin.end();
  });

  afterAll(async () => {
    const admin = connect();
    await admin.unsafe(`DROP DATABASE IF EXISTS ${TEST_DB} WITH (FORCE)`).catch(() => {});
    await admin.end();
    if (testRoot) rmSync(testRoot, { recursive: true, force: true });
  });

  test("pins one backend and serializes independent migration roots", async () => {
    const inspection = connect(TEST_DB);
    const runnerA = spawnMigrator(rootA, "lock-root-a");
    await waitForAdvisoryLock(inspection);
    const runnerB = spawnMigrator(rootB, "lock-root-b");
    await waitForContendedAdvisoryLock(inspection);

    await Promise.all([expectProcessSuccess(runnerA), expectProcessSuccess(runnerB)]);

    const events = await inspection.unsafe(`
      SELECT event, backend_pid, recorded_at
      FROM migration_lock_probe
      ORDER BY recorded_at
    `) as { event: string; backend_pid: number; recorded_at: Date }[];
    await inspection.end();

    expect(events.map((row) => row.event)).toEqual(["a-first", "a-second", "b-first"]);
    expect(events[0]?.backend_pid).toBe(events[1]?.backend_pid);
    expect(events[2]?.backend_pid).not.toBe(events[0]?.backend_pid);
  });
});
