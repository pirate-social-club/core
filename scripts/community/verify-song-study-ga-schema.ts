#!/usr/bin/env bun

import { Database } from "bun:sqlite";

const REQUIRED_MIGRATIONS = [
  "1118_song_study_review_sessions.sql",
  "1119_song_streaks.sql",
  "1120_restore_rights_review_cases.sql",
  "1121_song_study_attempt_identity.sql",
];

const REQUIRED_TABLES = [
  "song_engagement_days",
  "song_streaks",
  "song_study_attempt",
  "song_study_review_state",
];

type Options = {
  dbPath: string;
  json: boolean;
};

export type SongStudyGaSchemaCheck = {
  ok: boolean;
  name: string;
  detail: string;
};

function usage(exitCode = 1): never {
  console.error(`Usage:
  bun scripts/community/verify-song-study-ga-schema.ts --db PATH [--json]

Verifies one SQLite/libSQL community database has the Study due-review/streak GA schema:
- migrations 1118, 1119, 1120, and 1121 recorded in schema_migrations
- song_engagement_days and song_streaks exist
- song_study_attempt no longer has review_session_id
- song_study_attempt keeps UNIQUE(user_id, idempotency_key)
- song_study_attempt has no UNIQUE(user_id, exercise_id, attempt_number)

Use this against a local mirror/export of one community shard, or as the exact SQL predicate
to reproduce through D1 inspection tooling during canary/fleet rollout.`);
  process.exit(exitCode);
}

function parseArgs(argv: string[]): Options {
  let dbPath = "";
  let json = false;

  for (let index = 0; index < argv.length;) {
    const arg = argv[index];
    switch (arg) {
      case "--db":
        dbPath = argv[index + 1] ?? "";
        index += 2;
        break;
      case "--json":
        json = true;
        index += 1;
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

  if (!dbPath) usage();
  return { dbPath, json };
}

function stringRows(db: Database, sql: string): string[] {
  return db.query<{ value: string }, []>(sql).all().map((row) => row.value);
}

function tableExists(db: Database, table: string): boolean {
  const row = db.query<{ count: number }, [string]>(
    "SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table' AND name = ?1",
  ).get(table);
  return Number(row?.count ?? 0) > 0;
}

function uniqueColumnSets(db: Database, table: string): string[][] {
  const indexes = db.query<{ name: string; unique: number }, [string]>(`PRAGMA index_list(${table})`).all(table);
  return indexes
    .filter((index) => Number(index.unique) === 1)
    .map((index) => db.query<{ name: string }, []>(`PRAGMA index_info(${JSON.stringify(index.name)})`).all().map((row) => row.name))
    .sort((a, b) => a.join(",").localeCompare(b.join(",")));
}

function hasColumnSet(sets: string[][], expected: string[]): boolean {
  return sets.some((set) => set.length === expected.length && set.every((value, index) => value === expected[index]));
}

function hasColumnSuperset(sets: string[][], expected: string[]): boolean {
  return sets.some((set) => expected.every((value) => set.includes(value)));
}

export function checksForSongStudyGaSchema(db: Database): SongStudyGaSchemaCheck[] {
  const checks: SongStudyGaSchemaCheck[] = [];

  if (!tableExists(db, "schema_migrations")) {
    return [{
      ok: false,
      name: "schema_migrations",
      detail: "schema_migrations table is missing",
    }];
  }

  const migrations = new Set(stringRows(db, "SELECT migration_name AS value FROM schema_migrations"));
  for (const migration of REQUIRED_MIGRATIONS) {
    checks.push({
      ok: migrations.has(migration),
      name: `migration:${migration}`,
      detail: migrations.has(migration) ? "recorded" : "missing from schema_migrations",
    });
  }

  for (const table of REQUIRED_TABLES) {
    const exists = tableExists(db, table);
    checks.push({
      ok: exists,
      name: `table:${table}`,
      detail: exists ? "exists" : "missing",
    });
  }

  if (!tableExists(db, "song_study_attempt")) return checks;

  const columns = stringRows(db, "SELECT name AS value FROM pragma_table_info('song_study_attempt')");
  checks.push({
    ok: !columns.includes("review_session_id"),
    name: "song_study_attempt.review_session_id",
    detail: columns.includes("review_session_id") ? "column still exists" : "column absent",
  });

  const uniqueSets = uniqueColumnSets(db, "song_study_attempt");
  checks.push({
    ok: hasColumnSet(uniqueSets, ["user_id", "idempotency_key"]),
    name: "song_study_attempt.unique_idempotency",
    detail: `unique sets: ${uniqueSets.map((set) => `[${set.join(", ")}]`).join(", ") || "none"}`,
  });
  checks.push({
    ok: !hasColumnSuperset(uniqueSets, ["user_id", "exercise_id", "attempt_number"]),
    name: "song_study_attempt.old_attempt_number_unique",
    detail: hasColumnSuperset(uniqueSets, ["user_id", "exercise_id", "attempt_number"])
      ? "attempt-number unique constraint still exists"
      : "old unique constraint absent",
  });

  return checks;
}

function main(): void {
  const options = parseArgs(process.argv.slice(2));
  const db = new Database(options.dbPath, { readonly: true });
  try {
    const checks = checksForSongStudyGaSchema(db);
    const ok = checks.every((check) => check.ok);
    if (options.json) {
      console.log(JSON.stringify({ ok, db: options.dbPath, checks }, null, 2));
    } else {
      for (const check of checks) {
        console.log(`${check.ok ? "ok " : "ERR"} ${check.name}: ${check.detail}`);
      }
      console.log(ok ? "song study GA schema verified" : "song study GA schema verification failed");
    }
    if (!ok) process.exitCode = 1;
  } finally {
    db.close();
  }
}

if (import.meta.main) {
  main();
}
