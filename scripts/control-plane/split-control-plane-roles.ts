#!/usr/bin/env bun

import { randomBytes } from "node:crypto";
import { applyControlPlaneSecurityHardening } from "../lib/control-plane-postgres-hardening";

type Options = {
  infisicalEnv: string;
  skipInfisical: boolean;
  allowMissingPgAudit: boolean;
};

function usage(): never {
  console.error(`Usage:
  bun scripts/control-plane/split-control-plane-roles.ts [--infisical-env ENV] [--skip-infisical] [--allow-missing-pgaudit]

Creates or rotates distinct Neon control-plane roles, transfers table ownership
to the migrator role, and updates Infisical secret paths to the intended split:

- /services/api -> CONTROL_PLANE_DATABASE_URL
- /services/control-plane -> CONTROL_PLANE_MIGRATOR_DATABASE_URL
- /local/control-plane -> CONTROL_PLANE_OWNER_DATABASE_URL

The script requires an owner-capable connection URL in either:

- CONTROL_PLANE_OWNER_DATABASE_URL, or
- CONTROL_PLANE_DATABASE_URL

Options:
  --skip-infisical             Skip writing generated URLs to Infisical.
  --allow-missing-pgaudit      Continue with grants and RLS if pgAudit cannot be configured.
`);
  process.exit(1);
}

function parseArgs(argv: string[]): Options {
  const options: Options = {
    infisicalEnv: "dev",
    skipInfisical: false,
    allowMissingPgAudit: false,
  };

  for (let index = 0; index < argv.length; ) {
    const arg = argv[index];
    const value = argv[index + 1];

    switch (arg) {
      case "--infisical-env":
        options.infisicalEnv = value ?? options.infisicalEnv;
        index += 2;
        break;
      case "--skip-infisical":
        options.skipInfisical = true;
        index += 1;
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

function sqlLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function runCommand(args: string[]): string {
  const result = Bun.spawnSync(args, {
    stdout: "pipe",
    stderr: "pipe",
  });
  const stdout = new TextDecoder().decode(result.stdout).trim();
  const stderr = new TextDecoder().decode(result.stderr).trim();

  if (result.exitCode !== 0) {
    throw new Error(stderr || stdout || `command failed: ${args.join(" ")}`);
  }

  return stdout;
}

function folderExists(path: string, name: string, infisicalEnv: string): boolean {
  const raw = runCommand([
    "rtk",
    "infisical",
    "secrets",
    "folders",
    "get",
    "--env",
    infisicalEnv,
    "--path",
    path,
    "-o",
    "json",
  ]);

  return new RegExp(`"folderName"\\s*:\\s*"${name}"`).test(raw);
}

function ensureFolder(path: string, name: string, infisicalEnv: string) {
  if (folderExists(path, name, infisicalEnv)) {
    return;
  }

  runCommand([
    "rtk",
    "infisical",
    "secrets",
    "folders",
    "create",
    "--env",
    infisicalEnv,
    "--path",
    path,
    "--name",
    name,
  ]);
}

function setSecret(path: string, name: string, value: string, infisicalEnv: string) {
  runCommand([
    "rtk",
    "infisical",
    "secrets",
    "set",
    "--env",
    infisicalEnv,
    "--path",
    path,
    `${name}=${value}`,
  ]);
}

function buildConnectionUrl(ownerUrl: string, username: string, password: string): string {
  const url = new URL(ownerUrl);
  url.username = username;
  url.password = password;
  return url.toString();
}

const options = parseArgs(process.argv.slice(2));
const ownerUrl = process.env.CONTROL_PLANE_OWNER_DATABASE_URL ?? process.env.CONTROL_PLANE_DATABASE_URL;

if (!ownerUrl) {
  console.error(
    "missing owner-capable connection string: expected CONTROL_PLANE_OWNER_DATABASE_URL or CONTROL_PLANE_DATABASE_URL",
  );
  process.exit(1);
}

const passwords = {
  migrator: randomBytes(24).toString("hex"),
  apiRw: randomBytes(24).toString("hex"),
  apiRo: randomBytes(24).toString("hex"),
  opsRo: randomBytes(24).toString("hex"),
};

const sql = new Bun.SQL(ownerUrl);
const dbName = (await sql<{ name: string }[]>`SELECT current_database() AS name`)[0]?.name;
const existingRoleRows = await sql<{ rolname: string }[]>`
  SELECT rolname
  FROM pg_roles
  WHERE rolname IN (
    'control_plane_migrator',
    'control_plane_api_rw',
    'control_plane_api_ro',
    'control_plane_ops_ro'
  )
`;
const existingRoles = new Set(existingRoleRows.map((row) => row.rolname));

if (!dbName) {
  await sql.end();
  throw new Error("failed to resolve current database name");
}

const roleStatements = [
  {
    name: "control_plane_migrator",
    password: passwords.migrator,
  },
  {
    name: "control_plane_api_rw",
    password: passwords.apiRw,
  },
  {
    name: "control_plane_api_ro",
    password: passwords.apiRo,
  },
  {
    name: "control_plane_ops_ro",
    password: passwords.opsRo,
  },
].map(({ name, password }) =>
  existingRoles.has(name)
    ? `ALTER ROLE ${name} WITH LOGIN PASSWORD ${sqlLiteral(password)} NOCREATEDB NOCREATEROLE NOINHERIT;`
    : `CREATE ROLE ${name} LOGIN PASSWORD ${sqlLiteral(password)} NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;`,
);

const ddl = `
${roleStatements.join("\n")}

GRANT control_plane_migrator TO neondb_owner;

REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT CONNECT ON DATABASE "${dbName}" TO control_plane_migrator, control_plane_api_rw, control_plane_api_ro, control_plane_ops_ro;
GRANT USAGE ON SCHEMA public TO control_plane_migrator, control_plane_api_rw, control_plane_api_ro, control_plane_ops_ro;
GRANT CREATE ON SCHEMA public TO control_plane_migrator;

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO control_plane_api_rw;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO control_plane_api_ro, control_plane_ops_ro;
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO control_plane_api_rw;
GRANT SELECT ON ALL SEQUENCES IN SCHEMA public TO control_plane_api_ro, control_plane_ops_ro;

DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT schemaname, tablename FROM pg_tables WHERE schemaname = 'public' LOOP
    EXECUTE format('ALTER TABLE %I.%I OWNER TO control_plane_migrator', r.schemaname, r.tablename);
  END LOOP;
END
$$;

SET ROLE control_plane_migrator;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO control_plane_api_rw;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO control_plane_api_ro, control_plane_ops_ro;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO control_plane_api_rw;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON SEQUENCES TO control_plane_api_ro, control_plane_ops_ro;
RESET ROLE;
`;

await sql.unsafe(ddl);
await applyControlPlaneSecurityHardening({
  sql,
  databaseName: dbName,
  allowMissingPgAudit: options.allowMissingPgAudit,
});
await sql.end();

const runtimeUrl = buildConnectionUrl(ownerUrl, "control_plane_api_rw", passwords.apiRw);
const migratorUrl = buildConnectionUrl(ownerUrl, "control_plane_migrator", passwords.migrator);
if (!options.skipInfisical) {
  ensureFolder("/", "local", options.infisicalEnv);
  ensureFolder("/local", "control-plane", options.infisicalEnv);

  setSecret("/local/control-plane", "CONTROL_PLANE_OWNER_DATABASE_URL", ownerUrl, options.infisicalEnv);
  setSecret(
    "/services/control-plane",
    "CONTROL_PLANE_MIGRATOR_DATABASE_URL",
    migratorUrl,
    options.infisicalEnv,
  );
  setSecret("/services/api", "CONTROL_PLANE_DATABASE_URL", runtimeUrl, options.infisicalEnv);
}

console.log(`control-plane role split complete
env: ${options.infisicalEnv}
database: ${dbName}
runtime_role: control_plane_api_rw
migrator_role: control_plane_migrator
readonly_roles: control_plane_api_ro, control_plane_ops_ro
runtime_url: ${runtimeUrl}
migrator_url: ${migratorUrl}
owner_url: ${ownerUrl}
infisical_updated: ${options.skipInfisical ? "no" : "yes"}
runtime_secret_path: ${options.skipInfisical ? "skipped" : "/services/api"}
migrator_secret_path: ${options.skipInfisical ? "skipped" : "/services/control-plane"}
owner_secret_path: ${options.skipInfisical ? "skipped" : "/local/control-plane"}`);
