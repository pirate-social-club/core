#!/usr/bin/env bun

import { resolve } from "node:path";
import { applyPostgresMigrations } from "../lib/postgres-migrations";

type Options = {
  databaseUrlEnv: string;
  migrationsDir: string;
  label: string;
};

function usage(): never {
  console.error(`Usage:
  bun scripts/control-plane/apply-postgres-migrations.ts --database-url-env ENV_NAME --migrations DIR [--label NAME]

Applies PostgreSQL-compatible .sql migrations in lexicographic order and records
successful applications in schema_migrations.

Options:
  --database-url-env ENV_NAME   Environment variable containing the database URL.
  --migrations DIR             Directory containing .sql migration files.
  --label NAME                 Optional logical label stored with each applied migration.
  -h, --help                   Show this help text.`);
  process.exit(1);
}

function parseArgs(argv: string[]): Options {
  let databaseUrlEnv = "";
  let migrationsDir = "";
  let label = "";

  for (let index = 0; index < argv.length; ) {
    const arg = argv[index];

    switch (arg) {
      case "--database-url-env":
        databaseUrlEnv = argv[index + 1] ?? "";
        index += 2;
        break;
      case "--migrations":
        migrationsDir = argv[index + 1] ?? "";
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

  if (!databaseUrlEnv || !migrationsDir) {
    usage();
  }

  return {
    databaseUrlEnv,
    migrationsDir: resolve(migrationsDir),
    label: label || migrationsDir.split("/").pop() || "migrations",
  };
}

const options = parseArgs(process.argv.slice(2));
const databaseUrl = process.env[options.databaseUrlEnv];

if (!databaseUrl) {
  console.error(`missing database url env var: ${options.databaseUrlEnv}`);
  process.exit(1);
}

const result = await applyPostgresMigrations({
  databaseUrl,
  migrationsDir: options.migrationsDir,
  label: options.label,
  logger: (line) => console.log(line),
});

console.log("");
console.log("migration run complete");
console.log(`label: ${result.label}`);
console.log(`applied: ${result.applied}`);
console.log(`skipped: ${result.skipped}`);
