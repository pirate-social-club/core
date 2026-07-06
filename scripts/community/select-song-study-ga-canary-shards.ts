#!/usr/bin/env bun

import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

type Options = {
  concurrency: number;
  cwd: string;
  env: string;
  limit: number;
  minAttempts: number;
  top: number;
  wranglerConfig: string;
};

type Candidate = {
  db: string;
  ok: boolean;
  error?: string;
  status: "candidate_source" | "unprovisioned" | "error";
  attempt_rows: number;
  attempts_24h: number;
  attempts_7d: number;
  distinct_users: number;
  distinct_posts: number;
  last_attempt_at: string | null;
  m1118: number;
  m1119: number;
  m1120: number;
  m1121: number;
};

function usage(exitCode = 1): never {
  console.error(`Usage:
  bun scripts/community/select-song-study-ga-canary-shards.ts [options]

Read-only production D1 scan. Ranks shards for the 1121 canary by:
- real song_study_attempt rows present;
- low recent write activity;
- missing GA migrations still visible.

Options:
  --wrangler-config PATH   Path to services/community-d1-shard/wrangler.jsonc
                           Default: ../api/services/community-d1-shard/wrangler.jsonc
  --cwd PATH               Directory to run wrangler from. Default: dirname(wrangler-config)
  --env NAME               Wrangler env. Default: production
  --concurrency N          Parallel D1 probes. Default: 6
  --limit N                Limit discovered DBs, useful for sampling.
  --min-attempts N         Minimum attempt rows for canary candidates. Default: 1
  --top N                  Number of ranked candidates to print. Default: 20`);
  process.exit(exitCode);
}

function parseArgs(argv: string[]): Options {
  const options: Options = {
    concurrency: 6,
    cwd: "",
    env: "production",
    limit: 0,
    minAttempts: 1,
    top: 20,
    wranglerConfig: resolve("../api/services/community-d1-shard/wrangler.jsonc"),
  };

  for (let index = 0; index < argv.length;) {
    const arg = argv[index];
    switch (arg) {
      case "--concurrency":
        options.concurrency = Number(argv[index + 1] ?? "");
        index += 2;
        break;
      case "--cwd":
        options.cwd = resolve(argv[index + 1] ?? "");
        index += 2;
        break;
      case "--env":
        options.env = String(argv[index + 1] ?? "").trim();
        index += 2;
        break;
      case "--limit":
        options.limit = Number(argv[index + 1] ?? "");
        index += 2;
        break;
      case "--min-attempts":
        options.minAttempts = Number(argv[index + 1] ?? "");
        index += 2;
        break;
      case "--top":
        options.top = Number(argv[index + 1] ?? "");
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
  for (const [name, value] of [
    ["--concurrency", options.concurrency],
    ["--limit", options.limit],
    ["--min-attempts", options.minAttempts],
    ["--top", options.top],
  ] as const) {
    if (!Number.isInteger(value) || value < 0 || (name !== "--limit" && value < 1)) {
      throw new Error(`${name} must be a positive integer`);
    }
  }
  return options;
}

async function discoverDbs(options: Options): Promise<string[]> {
  const config = await readFile(options.wranglerConfig, "utf8");
  const dbs = [
    ...new Set(
      [...config.matchAll(/"database_name": "(community-d1-pool-\d{4}-prod)"/g)].map((match) => match[1]),
    ),
  ].sort();
  return options.limit > 0 ? dbs.slice(0, options.limit) : dbs;
}

function parseWranglerJson(output: string): unknown[] {
  const clean = output.replace(/\u001b\[[0-9;]*m/g, "");
  const match = clean.match(/(^|\n)\s*(\[\s*\{[\s\S]*\])\s*$/);
  if (!match) throw new Error(`No JSON result array found in wrangler output: ${clean.slice(0, 500)}`);
  return JSON.parse(match[2]) as unknown[];
}

async function wranglerJson(options: Options, db: string, sql: string): Promise<any[]> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      const { stdout, stderr } = await execFileAsync(
        "bunx",
        ["wrangler", "d1", "execute", db, "--env", options.env, "--remote", "--json", "--command", sql],
        { cwd: options.cwd, maxBuffer: 1024 * 1024 * 4, timeout: 90_000 },
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

async function inspectShard(options: Options, db: string): Promise<Candidate> {
  const tableSql = `
    SELECT
      (SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='schema_migrations') AS has_schema_migrations,
      (SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='song_study_attempt') AS has_attempt
  `;
  const cutoff24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const cutoff7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const sql = `
SELECT
  (SELECT COUNT(*) FROM song_study_attempt) AS attempt_rows,
  (SELECT COUNT(*) FROM song_study_attempt WHERE created_at >= '${cutoff24h}') AS attempts_24h,
  (SELECT COUNT(*) FROM song_study_attempt WHERE created_at >= '${cutoff7d}') AS attempts_7d,
  (SELECT COUNT(DISTINCT user_id) FROM song_study_attempt) AS distinct_users,
  (SELECT COUNT(DISTINCT post_id) FROM song_study_attempt) AS distinct_posts,
  (SELECT MAX(created_at) FROM song_study_attempt) AS last_attempt_at,
  (SELECT COUNT(*) FROM schema_migrations WHERE migration_name='1118_song_study_review_sessions.sql') AS m1118,
  (SELECT COUNT(*) FROM schema_migrations WHERE migration_name='1119_song_streaks.sql') AS m1119,
  (SELECT COUNT(*) FROM schema_migrations WHERE migration_name='1120_restore_rights_review_cases.sql') AS m1120,
  (SELECT COUNT(*) FROM schema_migrations WHERE migration_name='1121_song_study_attempt_identity.sql') AS m1121`;
  try {
    const tablePayload = await wranglerJson(options, db, tableSql);
    const tableRow = tablePayload?.[0]?.results?.[0];
    const hasSchemaMigrations = Number(tableRow?.has_schema_migrations ?? 0) === 1;
    const hasAttempt = Number(tableRow?.has_attempt ?? 0) === 1;
    if (!hasSchemaMigrations || !hasAttempt) {
      return {
        db,
        ok: true,
        status: "unprovisioned",
        attempt_rows: 0,
        attempts_24h: 0,
        attempts_7d: 0,
        distinct_users: 0,
        distinct_posts: 0,
        last_attempt_at: null,
        m1118: 0,
        m1119: 0,
        m1120: 0,
        m1121: 0,
      };
    }
    const payload = await wranglerJson(options, db, sql);
    const row = payload?.[0]?.results?.[0];
    if (!payload?.[0]?.success || !row) throw new Error("inspection_failed");
    return {
      db,
      ok: true,
      status: "candidate_source",
      attempt_rows: Number(row.attempt_rows ?? 0),
      attempts_24h: Number(row.attempts_24h ?? 0),
      attempts_7d: Number(row.attempts_7d ?? 0),
      distinct_users: Number(row.distinct_users ?? 0),
      distinct_posts: Number(row.distinct_posts ?? 0),
      last_attempt_at: typeof row.last_attempt_at === "string" ? row.last_attempt_at : null,
      m1118: Number(row.m1118 ?? 0),
      m1119: Number(row.m1119 ?? 0),
      m1120: Number(row.m1120 ?? 0),
      m1121: Number(row.m1121 ?? 0),
    };
  } catch (error) {
    return {
      db,
      ok: false,
      status: "error",
      error: error instanceof Error ? error.message : String(error),
      attempt_rows: 0,
      attempts_24h: 0,
      attempts_7d: 0,
      distinct_users: 0,
      distinct_posts: 0,
      last_attempt_at: null,
      m1118: 0,
      m1119: 0,
      m1120: 0,
      m1121: 0,
    };
  }
}

function rankCandidates(results: Candidate[], minAttempts: number): Candidate[] {
  return results
    .filter((candidate) => candidate.status === "candidate_source" && candidate.attempt_rows >= minAttempts)
    .sort((a, b) =>
      a.attempts_24h - b.attempts_24h
      || a.attempts_7d - b.attempts_7d
      || a.attempt_rows - b.attempt_rows
      || a.db.localeCompare(b.db)
    );
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const dbs = await discoverDbs(options);
  const results: Candidate[] = [];
  let next = 0;

  async function worker(): Promise<void> {
    for (;;) {
      const index = next;
      next += 1;
      if (index >= dbs.length) return;
      const result = await inspectShard(options, dbs[index]);
      results[index] = result;
      console.error(`${index + 1}/${dbs.length} ${result.ok ? "ok" : "fail"} ${result.db} attempts=${result.attempt_rows} 24h=${result.attempts_24h}`);
    }
  }

  await Promise.all(Array.from({ length: options.concurrency }, () => worker()));
  const candidates = rankCandidates(results, options.minAttempts);
  const failures = results.filter((result) => !result.ok);
  console.log(JSON.stringify({
    checked: results.length,
    failed: failures.length,
    initialized: results.filter((result) => result.status === "candidate_source").length,
    unprovisioned: results.filter((result) => result.status === "unprovisioned").length,
    with_attempts: results.filter((result) => result.status === "candidate_source" && result.attempt_rows > 0).length,
    top_candidates: candidates.slice(0, options.top),
    failures: failures.slice(0, 20),
  }, null, 2));
  if (failures.length > 0) process.exitCode = 1;
}

await main();
