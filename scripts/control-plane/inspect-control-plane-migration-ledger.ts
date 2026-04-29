#!/usr/bin/env bun

import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

type Options = {
  databaseUrlEnv: string;
  migrationsDir: string;
  limit: number;
};

type MigrationRow = {
  migration_name: string;
  migration_label: string | null;
  checksum: string;
  applied_at: string | null;
};

function usage(exitCode = 1): never {
  console.error(`Usage:
  bun scripts/control-plane/inspect-control-plane-migration-ledger.ts [--database-url-env NAME] [--migrations DIR] [--limit N]

Read-only inspection of a Postgres control-plane schema_migrations ledger.

Environment:
  CONTROL_PLANE_DATABASE_URL       Default database URL env var.

Options:
  --database-url-env NAME          Env var containing the database URL.
                                   Default: CONTROL_PLANE_DATABASE_URL.
  --migrations DIR                Migration directory. Default: db/control-plane/migrations.
  --limit N                       Max names to print per category. Default: 120.
  -h, --help                      Show this help text.`);
  process.exit(exitCode);
}

function parseArgs(argv: string[]): Options {
  const options: Options = {
    databaseUrlEnv: "CONTROL_PLANE_DATABASE_URL",
    migrationsDir: "db/control-plane/migrations",
    limit: 120,
  };

  for (let index = 0; index < argv.length; ) {
    const arg = argv[index];
    const value = argv[index + 1];

    switch (arg) {
      case "--database-url-env":
        options.databaseUrlEnv = String(value ?? "").trim();
        index += 2;
        break;
      case "--migrations":
        options.migrationsDir = String(value ?? "").trim();
        index += 2;
        break;
      case "--limit": {
        const parsed = Number(value);
        if (!Number.isInteger(parsed) || parsed <= 0) usage();
        options.limit = parsed;
        index += 2;
        break;
      }
      case "-h":
      case "--help":
        usage(0);
        break;
      default:
        console.error(`unknown argument: ${arg}`);
        usage();
    }
  }

  if (!options.databaseUrlEnv || !options.migrationsDir) usage();
  return options;
}

function requireEnv(name: string): string {
  const value = String(process.env[name] ?? "").trim();
  if (!value) {
    console.error(`missing database url env var: ${name}`);
    process.exit(1);
  }
  return value;
}

function checksum(contents: string): string {
  return createHash("sha256").update(contents).digest("hex");
}

function listExpected(migrationsDir: string): Array<{ migrationName: string; checksum: string }> {
  const absoluteDir = resolve(migrationsDir);
  return readdirSync(absoluteDir)
    .filter((entry) => entry.endsWith(".sql"))
    .sort()
    .map((migrationName) => ({
      migrationName,
      checksum: checksum(readFileSync(resolve(absoluteDir, migrationName), "utf8")),
    }));
}

function printList(title: string, values: string[], limit: number): void {
  console.log(`${title}: ${values.length}`);
  for (const value of values.slice(0, limit)) {
    console.log(`- ${value}`);
  }
  if (values.length > limit) {
    console.log(`... ${values.length - limit} more`);
  }
  console.log("");
}

const options = parseArgs(process.argv.slice(2));
const databaseUrl = requireEnv(options.databaseUrlEnv);
const expected = listExpected(options.migrationsDir);
const expectedByName = new Map(expected.map((entry) => [entry.migrationName, entry.checksum] as const));
const db = new Bun.SQL(databaseUrl);

let rows: MigrationRow[];
let databaseName = "";
let currentUser = "";
let host = "";
try {
  const identityRows = await db<{ current_database: string; current_user: string; inet_server_addr: string | null }[]>`
    SELECT current_database(), current_user, inet_server_addr()::text
  `;
  databaseName = identityRows[0]?.current_database ?? "";
  currentUser = identityRows[0]?.current_user ?? "";
  host = identityRows[0]?.inet_server_addr ?? "";
  rows = await db<MigrationRow[]>`
    SELECT migration_name, migration_label, checksum, applied_at::text
    FROM schema_migrations
    ORDER BY migration_name ASC
  `;
} finally {
  await db.end();
}

const actualByName = new Map(rows.map((row) => [row.migration_name, row] as const));
const matching = expected
  .filter((entry) => actualByName.get(entry.migrationName)?.checksum === entry.checksum)
  .map((entry) => entry.migrationName);
const missing = expected
  .filter((entry) => !actualByName.has(entry.migrationName))
  .map((entry) => entry.migrationName);
const mismatched = expected
  .filter((entry) => actualByName.has(entry.migrationName) && actualByName.get(entry.migrationName)?.checksum !== entry.checksum)
  .map((entry) => entry.migrationName);
const unexpected = rows
  .map((row) => row.migration_name)
  .filter((name) => !expectedByName.has(name))
  .sort();
const missingByChecksum = new Map(
  expected
    .filter((entry) => !actualByName.has(entry.migrationName))
    .map((entry) => [entry.checksum, entry.migrationName] as const),
);
const checksumRenameCandidates = rows
  .filter((row) => !expectedByName.has(row.migration_name))
  .map((row) => ({
    actualName: row.migration_name,
    expectedName: missingByChecksum.get(row.checksum) ?? "",
  }))
  .filter((row) => row.expectedName)
  .sort((left, right) => left.expectedName.localeCompare(right.expectedName));
const missingWithoutChecksumMatch = missing
  .filter((name) => !rows.some((row) => row.checksum === expectedByName.get(name)));
const unexpectedWithoutChecksumMatch = unexpected
  .filter((name) => {
    const checksumValue = actualByName.get(name)?.checksum ?? "";
    return !missingByChecksum.has(checksumValue);
  });

console.log("control-plane migration ledger");
console.log(`database: ${databaseName}`);
console.log(`user: ${currentUser}`);
console.log(`server_addr: ${host}`);
console.log(`expected_migrations: ${expected.length}`);
console.log(`recorded_migrations: ${rows.length}`);
console.log(`matching: ${matching.length}`);
console.log(`missing: ${missing.length}`);
console.log(`mismatched: ${mismatched.length}`);
console.log(`unexpected: ${unexpected.length}`);
console.log(`checksum_rename_candidates: ${checksumRenameCandidates.length}`);
console.log(`missing_without_checksum_match: ${missingWithoutChecksumMatch.length}`);
console.log(`unexpected_without_checksum_match: ${unexpectedWithoutChecksumMatch.length}`);
console.log("");

printList("matching_names", matching, options.limit);
printList("missing_names", missing, options.limit);
printList("mismatched_names", mismatched, options.limit);
printList("unexpected_names", unexpected, options.limit);
console.log(`checksum_rename_candidates: ${checksumRenameCandidates.length}`);
for (const row of checksumRenameCandidates.slice(0, options.limit)) {
  console.log(`- ${row.actualName} -> ${row.expectedName}`);
}
if (checksumRenameCandidates.length > options.limit) {
  console.log(`... ${checksumRenameCandidates.length - options.limit} more`);
}
console.log("");
printList("missing_without_checksum_match", missingWithoutChecksumMatch, options.limit);
printList("unexpected_without_checksum_match", unexpectedWithoutChecksumMatch, options.limit);

console.log("recorded_ledger:");
for (const row of rows.slice(0, options.limit)) {
  const checksumPrefix = row.checksum ? `${row.checksum.slice(0, 12)}...` : "";
  console.log(`- ${row.migration_name} label=${row.migration_label ?? ""} checksum=${checksumPrefix} applied_at=${row.applied_at ?? ""}`);
}
if (rows.length > options.limit) {
  console.log(`... ${rows.length - options.limit} more`);
}
