#!/usr/bin/env bun

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { basename, resolve } from "node:path";

type Options = {
  databaseUrlEnv: string;
  migrationPath: string;
  label: string;
};

function usage(): never {
  console.error(`Usage:
  bun scripts/control-plane/apply-single-postgres-migration.ts --database-url-env ENV_NAME --migration FILE [--label NAME]

Applies one PostgreSQL-compatible .sql migration and records it in schema_migrations.
Unrelated schema_migrations checksum drift is intentionally ignored.`);
  process.exit(1);
}

function parseArgs(argv: string[]): Options {
  let databaseUrlEnv = "";
  let migrationPath = "";
  let label = "";

  for (let index = 0; index < argv.length; ) {
    const arg = argv[index];
    switch (arg) {
      case "--database-url-env":
        databaseUrlEnv = argv[index + 1] ?? "";
        index += 2;
        break;
      case "--migration":
        migrationPath = argv[index + 1] ?? "";
        index += 2;
        break;
      case "--label":
        label = argv[index + 1] ?? "";
        index += 2;
        break;
      case "-h":
      case "--help":
        usage();
        break;
      default:
        console.error(`unknown argument: ${arg}`);
        usage();
    }
  }

  if (!databaseUrlEnv || !migrationPath) {
    usage();
  }

  return {
    databaseUrlEnv,
    migrationPath: resolve(migrationPath),
    label: label || "control-plane",
  };
}

function checksum(contents: string): string {
  return createHash("sha256").update(contents).digest("hex");
}

function normalizeSql(contents: string): string {
  return contents.replace(/^\s*PRAGMA\s+foreign_keys\s*=\s*ON\s*;\s*$/gim, "").trim();
}

const options = parseArgs(process.argv.slice(2));
const databaseUrl = process.env[options.databaseUrlEnv];
if (!databaseUrl) {
  console.error(`missing database url env var: ${options.databaseUrlEnv}`);
  process.exit(1);
}

const migrationName = basename(options.migrationPath);
const rawSql = readFileSync(options.migrationPath, "utf8");
const migrationSql = normalizeSql(rawSql);
const migrationChecksum = checksum(rawSql);
const sql = new Bun.SQL(databaseUrl);

try {
  await sql.unsafe(`
CREATE TABLE IF NOT EXISTS schema_migrations (
  migration_name TEXT PRIMARY KEY,
  migration_label TEXT NOT NULL,
  checksum TEXT NOT NULL,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
)
`);

  const existing = await sql<{ checksum: string }[]>`
    SELECT checksum
    FROM schema_migrations
    WHERE migration_name = ${migrationName}
    LIMIT 1
  `;
  const existingChecksum = existing[0]?.checksum ?? "";
  if (existingChecksum) {
    if (existingChecksum !== migrationChecksum) {
      throw new Error(`checksum mismatch for already applied migration: ${migrationName}`);
    }
    console.log(`skip  ${migrationName}`);
    process.exit(0);
  }

  console.log(`apply ${migrationName}`);
  await sql.begin(async (tx) => {
    if (migrationSql) {
      await tx.unsafe(migrationSql);
    }

    await tx`
      INSERT INTO schema_migrations (migration_name, migration_label, checksum)
      VALUES (${migrationName}, ${options.label}, ${migrationChecksum})
    `;
  });

  console.log("");
  console.log("single migration run complete");
  console.log(`label: ${options.label}`);
  console.log(`applied: ${migrationName}`);
} finally {
  await sql.end();
}
