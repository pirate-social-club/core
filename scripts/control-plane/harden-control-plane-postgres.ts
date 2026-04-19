#!/usr/bin/env bun

import { hardenControlPlanePostgres } from "../lib/control-plane-postgres-hardening";

type Options = {
  databaseUrlEnv: string;
  allowMissingPgAudit: boolean;
};

function usage(): never {
  console.error(`Usage:
  bun scripts/control-plane/harden-control-plane-postgres.ts [--database-url-env ENV_NAME] [--allow-missing-pgaudit]

Applies control-plane Postgres hardening required by the Neon ADR:

- enables pgAudit at the database level
- grants read-only access to schema_migrations for runtime roles
- enables FORCE RLS with explicit policies on crown-jewel tables

Options:
  --database-url-env ENV_NAME   Environment variable containing an owner-capable database URL.
                               Default: CONTROL_PLANE_OWNER_DATABASE_URL
  --allow-missing-pgaudit      Continue with grants and RLS if pgAudit cannot be configured.
  -h, --help                   Show this help text.`);
  process.exit(1);
}

function parseArgs(argv: string[]): Options {
  const options: Options = {
    databaseUrlEnv: "CONTROL_PLANE_OWNER_DATABASE_URL",
    allowMissingPgAudit: false,
  };

  for (let index = 0; index < argv.length; ) {
    const arg = argv[index];

    switch (arg) {
      case "--database-url-env":
        options.databaseUrlEnv = argv[index + 1] ?? options.databaseUrlEnv;
        index += 2;
        break;
      case "--allow-missing-pgaudit":
        options.allowMissingPgAudit = true;
        index += 1;
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

  return options;
}

const options = parseArgs(process.argv.slice(2));
const databaseUrl = process.env[options.databaseUrlEnv];

if (!databaseUrl) {
  console.error(`missing database url env var: ${options.databaseUrlEnv}`);
  process.exit(1);
}

const result = await hardenControlPlanePostgres({
  databaseUrl,
  logger: (line) => console.log(line),
  allowMissingPgAudit: options.allowMissingPgAudit,
});

console.log("");
console.log("control-plane hardening complete");
console.log(`database: ${result.databaseName}`);
console.log(`pgaudit_configured: ${result.pgauditConfigured ? "yes" : "no"}`);
if (result.pgauditError) {
  console.log(`pgaudit_error: ${result.pgauditError}`);
}
console.log(`schema_migrations_grant: ${result.schemaMigrationsGrantApplied ? "applied" : "skipped"}`);
console.log(`rls_hardened_tables: ${result.hardenedTables.length}`);
if (result.hardenedTables.length > 0) {
  console.log(`tables: ${result.hardenedTables.join(", ")}`);
}
if (result.missingTables.length > 0) {
  console.log(`missing_tables: ${result.missingTables.join(", ")}`);
}
