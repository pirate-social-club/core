#!/usr/bin/env bun

import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const TARGET_MIGRATIONS = [
  "1118_song_study_review_sessions.sql",
  "1119_song_streaks.sql",
  "1120_restore_rights_review_cases.sql",
  "1121_song_study_attempt_identity.sql",
] as const;

type Options = {
  confirmTimeTravel: boolean;
  cwd: string;
  dbs: string[];
  env: string;
  execute: boolean;
  limit: number | null;
  migrationsDir: string;
  resumeFile: string | null;
  wranglerConfig: string;
};

type ProbeRow = {
  has_schema_migrations: number;
  migrations_recorded: string;
  migration_checksums: string;
  m1118: number;
  m1119: number;
  m1120: number;
  m1121: number;
  has_days: number;
  has_streaks: number;
  has_attempt: number;
  has_review_session_id: number;
  has_idempotency_key: number;
  has_idem_unique: number;
  has_old_attempt_unique: number;
  attempt_rows: number;
  attempt_fingerprint: string;
  orphaned_attempts: number;
};

type ShardResult = {
  before?: ProbeRow;
  db: string;
  error?: string;
  after?: ProbeRow;
  applied: string[];
  skipped: string[];
  ok: boolean;
  status: "schema_ready" | "schema_not_ready" | "unprovisioned" | "error";
};

function usage(exitCode = 1): never {
  console.error(`Usage:
  bun scripts/community/apply-song-study-ga-d1-migrations.ts [options]

Default mode is read-only verification.

Options:
  --wrangler-config PATH   Path to services/community-d1-shard/wrangler.jsonc
                           Default: ../api/services/community-d1-shard/wrangler.jsonc
  --cwd PATH               Directory to run wrangler from. Default: dirname(wrangler-config)
  --migrations-dir PATH    Community-template migrations dir. Default: db/community-template/migrations
  --env NAME               Wrangler env. Default: production
  --db NAME                Target one D1 database. Repeatable.
  --limit N                Limit discovered DBs, useful for dry-run sampling.
  --resume-file PATH       JSON status file. Existing passed DBs are skipped.
  --execute                Apply missing migrations. Without this, verify only.
  --confirm-time-travel    Required with --execute; confirms D1 Time Travel restore is available.

Examples:
  # Read-only fleet verification
  bun scripts/community/apply-song-study-ga-d1-migrations.ts

  # Canary apply to one explicit shard
  bun scripts/community/apply-song-study-ga-d1-migrations.ts \\
    --db community-d1-pool-0001-prod \\
    --resume-file /tmp/song-study-ga-canary.json \\
    --confirm-time-travel \\
    --execute`);
  process.exit(exitCode);
}

function parseArgs(argv: string[]): Options {
  const options: Options = {
    confirmTimeTravel: false,
    cwd: "",
    dbs: [],
    env: "production",
    execute: false,
    limit: null,
    migrationsDir: resolve("db/community-template/migrations"),
    resumeFile: null,
    wranglerConfig: resolve("../api/services/community-d1-shard/wrangler.jsonc"),
  };

  for (let index = 0; index < argv.length;) {
    const arg = argv[index];
    switch (arg) {
      case "--confirm-time-travel":
        options.confirmTimeTravel = true;
        index += 1;
        break;
      case "--cwd":
        options.cwd = resolve(argv[index + 1] ?? "");
        index += 2;
        break;
      case "--db":
        options.dbs.push(String(argv[index + 1] ?? "").trim());
        index += 2;
        break;
      case "--env":
        options.env = String(argv[index + 1] ?? "").trim();
        index += 2;
        break;
      case "--execute":
        options.execute = true;
        index += 1;
        break;
      case "--limit":
        options.limit = Number(argv[index + 1] ?? "");
        index += 2;
        break;
      case "--migrations-dir":
        options.migrationsDir = resolve(argv[index + 1] ?? "");
        index += 2;
        break;
      case "--resume-file":
        options.resumeFile = resolve(argv[index + 1] ?? "");
        index += 2;
        break;
      case "--wrangler-config":
        options.wranglerConfig = resolve(argv[index + 1] ?? "");
        index += 2;
        break;
      case "-h":
      case "--help":
        usage(0);
        break;
      default:
        console.error(`unknown argument: ${arg}`);
        usage();
    }
  }

  if (!options.cwd) options.cwd = dirname(options.wranglerConfig);
  if (!options.env) usage();
  if (options.limit !== null && (!Number.isInteger(options.limit) || options.limit < 1)) usage();
  if (options.dbs.some((db) => !/^community-d1-pool-\d{4}-prod$/.test(db))) {
    throw new Error("--db must be a production community pool database name");
  }
  if (options.execute) {
    if (!options.confirmTimeTravel) {
      throw new Error("--execute requires --confirm-time-travel");
    }
    if (options.dbs.length === 0 && !options.resumeFile) {
      throw new Error("--execute fleet mode requires --resume-file");
    }
  }
  return options;
}

async function discoverDbs(options: Options): Promise<string[]> {
  if (options.dbs.length > 0) return [...new Set(options.dbs)].sort();
  const config = await readFile(options.wranglerConfig, "utf8");
  const dbs = [
    ...new Set(
      [...config.matchAll(/"database_name": "(community-d1-pool-\d{4}-prod)"/g)].map((match) => match[1]),
    ),
  ].sort();
  return options.limit === null ? dbs : dbs.slice(0, options.limit);
}

async function loadResume(file: string | null): Promise<Map<string, ShardResult>> {
  if (!file) return new Map();
  try {
    const raw = await readFile(file, "utf8");
    const parsed = JSON.parse(raw) as { results?: ShardResult[] };
    return new Map((parsed.results ?? []).map((result) => [result.db, result]));
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return new Map();
    }
    throw error;
  }
}

async function saveResume(file: string | null, results: ShardResult[]): Promise<void> {
  if (!file) return;
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify({ updated_at: new Date().toISOString(), results }, null, 2)}\n`);
}

function parseWranglerJson(output: string): unknown[] {
  const clean = output.replace(/\u001b\[[0-9;]*m/g, "");
  const match = clean.match(/(^|\n)\s*(\[\s*\{[\s\S]*\])\s*$/);
  if (!match) throw new Error(`No JSON result array found in wrangler output: ${clean.slice(0, 500)}`);
  return JSON.parse(match[2]) as unknown[];
}

async function wranglerJson(options: Options, db: string, args: string[]): Promise<any[]> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      const { stdout, stderr } = await execFileAsync(
        "bunx",
        ["wrangler", "d1", "execute", db, "--env", options.env, "--remote", "--json", ...args],
        { cwd: options.cwd, maxBuffer: 1024 * 1024 * 8, timeout: 120_000 },
      );
      return parseWranglerJson(`${stderr}\n${stdout}`) as any[];
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message : String(error);
      if (!isTransientWranglerError(message) || attempt === 4) break;
      await delay(1_000 * attempt * attempt);
    }
  }
  throw lastError;
}

function isTransientWranglerError(message: string): boolean {
  return /rate.?limit|timeout|timed out|ECONNRESET|ETIMEDOUT|EAI_AGAIN|fetch failed|network/iu.test(message);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

async function probe(options: Options, db: string): Promise<ProbeRow> {
  const tablePayload = await wranglerJson(options, db, ["--command", `
    SELECT
      (SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='schema_migrations') AS has_schema_migrations,
      (SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='song_study_attempt') AS has_attempt
  `]);
  const tableRow = tablePayload?.[0]?.results?.[0];
  if (Number(tableRow?.has_schema_migrations ?? 0) !== 1 || Number(tableRow?.has_attempt ?? 0) !== 1) {
    throw new Error("unprovisioned_shard");
  }
  const sql = `
SELECT
  (SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='schema_migrations') AS has_schema_migrations,
  (SELECT COALESCE(GROUP_CONCAT(migration_name, ','), '') FROM schema_migrations WHERE migration_name IN (${TARGET_MIGRATIONS.map((name) => `'${name}'`).join(", ")})) AS migrations_recorded,
  (SELECT COALESCE(GROUP_CONCAT(migration_name || ':' || checksum, ','), '') FROM schema_migrations WHERE migration_name IN (${TARGET_MIGRATIONS.map((name) => `'${name}'`).join(", ")})) AS migration_checksums,
  (SELECT COUNT(*) FROM schema_migrations WHERE migration_name='1118_song_study_review_sessions.sql') AS m1118,
  (SELECT COUNT(*) FROM schema_migrations WHERE migration_name='1119_song_streaks.sql') AS m1119,
  (SELECT COUNT(*) FROM schema_migrations WHERE migration_name='1120_restore_rights_review_cases.sql') AS m1120,
  (SELECT COUNT(*) FROM schema_migrations WHERE migration_name='1121_song_study_attempt_identity.sql') AS m1121,
  (SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='song_engagement_days') AS has_days,
  (SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='song_streaks') AS has_streaks,
  (SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='song_study_attempt') AS has_attempt,
  (SELECT COUNT(*) FROM pragma_table_info('song_study_attempt') WHERE name='review_session_id') AS has_review_session_id,
  (SELECT COUNT(*) FROM pragma_table_info('song_study_attempt') WHERE name='idempotency_key') AS has_idempotency_key,
  (SELECT COUNT(*) FROM pragma_index_list('song_study_attempt') il
    WHERE il."unique" = 1
      AND (
        SELECT GROUP_CONCAT(name, ',')
        FROM (SELECT name FROM pragma_index_info(il.name) ORDER BY seqno)
      ) = 'user_id,idempotency_key'
  ) AS has_idem_unique,
  (SELECT COUNT(*) FROM pragma_index_list('song_study_attempt') il
    WHERE il."unique" = 1
      AND (
        SELECT GROUP_CONCAT(name, ',')
        FROM (SELECT name FROM pragma_index_info(il.name) ORDER BY seqno)
      ) = 'user_id,exercise_id,attempt_number'
  ) AS has_old_attempt_unique,
  (SELECT COUNT(*) FROM song_study_attempt) AS attempt_rows,
  (SELECT COUNT(*) FROM song_study_attempt a
    WHERE NOT EXISTS (
      SELECT 1
      FROM song_study_review_state s
      WHERE s.user_id = a.user_id
        AND s.post_id = a.post_id
        AND s.line_id = a.line_id
        AND s.exercise_type = a.exercise_type
        AND s.target_language = a.target_language
    )
  ) AS orphaned_attempts`;
  const payload = await wranglerJson(options, db, ["--command", sql]);
  const row = payload?.[0]?.results?.[0];
  if (!payload?.[0]?.success || !row) throw new Error("probe_failed");
  return {
    ...(row as Omit<ProbeRow, "attempt_fingerprint">),
    attempt_fingerprint: await readAttemptFingerprint(options, db),
  };
}

async function readAttemptFingerprint(options: Options, db: string): Promise<string> {
  const hash = createHash("sha256");
  const pageSize = 500;
  let offset = 0;
  for (;;) {
    const sql = `
      SELECT id, idempotency_key, outcome, fsrs_rating, attempt_number
      FROM song_study_attempt
      ORDER BY id
      LIMIT ${pageSize} OFFSET ${offset}
    `;
    const payload = await wranglerJson(options, db, ["--command", sql]);
    const rows = payload?.[0]?.results ?? [];
    if (!Array.isArray(rows) || rows.length === 0) break;
    for (const row of rows) {
      hash.update(String(row.id ?? ""));
      hash.update("|");
      hash.update(String(row.idempotency_key ?? ""));
      hash.update("|");
      hash.update(String(row.outcome ?? ""));
      hash.update("|");
      hash.update(String(row.fsrs_rating ?? ""));
      hash.update("|");
      hash.update(String(row.attempt_number ?? ""));
      hash.update("\n");
    }
    if (rows.length < pageSize) break;
    offset += pageSize;
  }
  return hash.digest("hex");
}

async function expectedChecksums(options: Options): Promise<Map<string, string>> {
  const checksums = new Map<string, string>();
  for (const migration of TARGET_MIGRATIONS) {
    const sql = await readFile(resolve(options.migrationsDir, migration), "utf8");
    checksums.set(migration, createHash("sha256").update(sql).digest("hex"));
  }
  return checksums;
}

function parseRecordedChecksums(row: ProbeRow): Map<string, string> {
  const checksums = new Map<string, string>();
  for (const entry of row.migration_checksums.split(",").filter(Boolean)) {
    const separator = entry.indexOf(":");
    if (separator <= 0) continue;
    checksums.set(entry.slice(0, separator), entry.slice(separator + 1));
  }
  return checksums;
}

function schemaOk(row: ProbeRow): boolean {
  return row.has_schema_migrations === 1
    && row.m1118 === 1
    && row.m1119 === 1
    && row.m1120 === 1
    && row.m1121 === 1
    && row.has_days === 1
    && row.has_streaks === 1
    && row.has_attempt === 1
    && row.has_review_session_id === 0
    && row.has_idempotency_key === 1
    && row.has_idem_unique === 1
    && row.has_old_attempt_unique === 0;
}

function splitSqlStatements(sql: string): string[] {
  return sql
    .split(";")
    .map((statement) => statement.trim())
    .filter(Boolean)
    .map((statement) => `${statement};`);
}

function isForeignKeysPragma(statement: string): boolean {
  return /^PRAGMA\s+foreign_keys\s*=\s*(?:ON|OFF)\s*;?$/iu.test(statement.trim());
}

function disablesForeignKeys(statement: string): boolean {
  return /^PRAGMA\s+foreign_keys\s*=\s*OFF\s*;?$/iu.test(statement.trim());
}

async function applyMigration(options: Options, db: string, migrationName: string): Promise<void> {
  const path = resolve(options.migrationsDir, migrationName);
  const sql = await readFile(path, "utf8");
  const checksum = createHash("sha256").update(sql).digest("hex");
  const statements = splitSqlStatements(sql);
  const disableFk = statements.some(disablesForeignKeys);
  const body = statements.filter((statement) => !isForeignKeysPragma(statement));
  const ledger = `INSERT INTO schema_migrations (migration_name, migration_label, checksum) VALUES ('${migrationName}', 'community-template', '${checksum}');`;
  // Remote D1 rejects explicit BEGIN/COMMIT in wrangler-uploaded SQL files.
  // Wrangler executes the file with all-or-original behavior; keep the ledger
  // insert in the same file so schema and schema_migrations move together.
  const transactionalSql = `${body.join("\n")}\n${ledger}`;
  const file = `/tmp/song-study-ga-${db}-${migrationName}.sql`;
  await writeFile(file, `${transactionalSql}\n`);
  if (disableFk) {
    await wranglerJson(options, db, ["--command", "PRAGMA foreign_keys = OFF"]);
  }
  try {
    await wranglerJson(options, db, ["--file", file]);
  } finally {
    if (disableFk) {
      try {
        await wranglerJson(options, db, ["--command", "PRAGMA foreign_keys = ON"]);
      } catch (error) {
        console.warn(`warning ${db} failed to restore foreign_keys pragma after ${migrationName}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }
}

async function processShard(options: Options, db: string, expected: Map<string, string>): Promise<ShardResult> {
  const result: ShardResult = { db, applied: [], skipped: [], ok: false, status: "schema_not_ready" };
  try {
    const before = await probe(options, db);
    result.before = before;
    const recorded = new Set(before.migrations_recorded.split(",").filter(Boolean));
    const recordedChecksums = parseRecordedChecksums(before);
    for (const migration of TARGET_MIGRATIONS) {
      if (recorded.has(migration)) {
        const expectedChecksum = expected.get(migration);
        const recordedChecksum = recordedChecksums.get(migration);
        if (!expectedChecksum || recordedChecksum !== expectedChecksum) {
          throw new Error(`schema_migration_checksum_mismatch:${migration}`);
        }
        result.skipped.push(migration);
        continue;
      }
      if (!options.execute) {
        result.applied.push(`would_apply:${migration}`);
        continue;
      }
      await applyMigration(options, db, migration);
      result.applied.push(migration);
    }
    if (result.applied.length === 0 && schemaOk(before)) {
      result.after = before;
      result.ok = true;
      result.status = "schema_ready";
      return result;
    }
    const after = await probe(options, db);
    result.after = after;
    result.ok = schemaOk(after)
      && before.attempt_rows === after.attempt_rows
      && before.attempt_fingerprint === after.attempt_fingerprint;
    if (!result.ok && !options.execute) {
      result.error = "schema_not_ready";
    } else if (!result.ok) {
      result.error = "post_apply_verification_failed";
    }
    if (result.ok) result.status = "schema_ready";
  } catch (error) {
    if (error instanceof Error && error.message === "unprovisioned_shard") {
      result.ok = true;
      result.status = "unprovisioned";
      result.skipped.push("unprovisioned_shard");
      return result;
    }
    result.status = "error";
    result.error = error instanceof Error ? error.message : String(error);
  }
  return result;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const dbs = await discoverDbs(options);
  const expected = await expectedChecksums(options);
  const resume = await loadResume(options.resumeFile);
  const results: ShardResult[] = [...resume.values()];
  const completed = new Set(results.filter((result) => result.ok).map((result) => result.db));

  for (const db of dbs) {
    if (completed.has(db)) {
      console.error(`skip ok ${db}`);
      continue;
    }
    const result = await processShard(options, db, expected);
    const existingIndex = results.findIndex((entry) => entry.db === db);
    if (existingIndex >= 0) results[existingIndex] = result;
    else results.push(result);
    await saveResume(options.resumeFile, results);
    console.error(`${result.ok ? "ok" : "fail"} ${db}`);
    if (options.execute && !result.ok) {
      console.error(JSON.stringify(result, null, 2));
      break;
    }
  }

  const checked = results.length;
  const passed = results.filter((result) => result.ok).length;
  const failed = results.filter((result) => !result.ok).length;
  const schemaReady = results.filter((result) => result.status === "schema_ready").length;
  const unprovisioned = results.filter((result) => result.status === "unprovisioned").length;
  console.log(JSON.stringify({ execute: options.execute, checked, passed, failed, schemaReady, unprovisioned, results }, null, 2));
  if (failed > 0 || passed !== checked) process.exitCode = 1;
}

await main();
