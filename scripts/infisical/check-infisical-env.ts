#!/usr/bin/env bun

import {
  ENV_CONTRACT,
  isSecretProfile,
  profileSecretIds,
  requirednessApplies,
  requirednessLabel,
  secretId,
  type Requiredness,
  type SecretProfile,
} from "../lib/infisical-env-contract";

type Options = {
  env: string;
  profile: SecretProfile;
  connect: boolean;
  verbose: boolean;
  allowExtra: boolean;
};

type CheckResult = {
  status: "ok" | "missing" | "empty" | "invalid" | "auth_failed" | "error" | "skip";
  message: string;
};

type SecretRead = {
  path: string;
  key: string;
  value: string | null;
};

const HUMAN_SET_REQUIRED_PLACEHOLDER = "__HUMAN_SET_REQUIRED__";

function usage(): never {
  console.error(`Usage:
  bun scripts/infisical/check-infisical-env.ts --env ENV [--profile PROFILE] [--connect] [--verbose] [--allow-extra]

Checks the Infisical environment against the secret contract defined in
scripts/lib/infisical-env-contract.ts.

Options:
  --env ENV       Infisical environment slug
  --profile       Secret profile to validate: all, core, happy-path, commerce
                  Default: all
  --connect       Validate database identity, host consistency, and privilege shape
                  for *_DATABASE_URL secrets. This checks that the secret contract is
                  met (correct roles, correct grants), not that the application works.
  --verbose       Show deferred/optional secrets and skipped cross-path checks
  --allow-extra   Do not fail on live Infisical folders/secrets outside this contract.
                  Use only for one-off inventory, not production readiness gates.
  -h, --help      Show this help text`);
  process.exit(1);
}

function parseArgs(argv: string[]): Options {
  const options: Options = { env: "", profile: "all", connect: false, verbose: false, allowExtra: false };

  for (let i = 0; i < argv.length; ) {
    const arg = argv[i];
    const value = argv[i + 1];
    switch (arg) {
      case "--env":
        options.env = value ?? "";
        i += 2;
        break;
      case "--profile":
        if (!isSecretProfile(value)) {
          console.error(`invalid profile: ${value ?? ""}`);
          usage();
        }
        options.profile = value;
        i += 2;
        break;
      case "--connect":
        options.connect = true;
        i += 1;
        break;
      case "--verbose":
        options.verbose = true;
        i += 1;
        break;
      case "--allow-extra":
        options.allowExtra = true;
        i += 1;
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

  if (!options.env) {
    console.error("--env is required");
    usage();
  }

  return options;
}

function runInfisical(args: string[]): { stdout: string; stderr: string; exitCode: number } {
  const result = Bun.spawnSync(["rtk", "infisical", ...args], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const stdout = new TextDecoder().decode(result.stdout).trim();
  const stderr = new TextDecoder().decode(result.stderr).trim();
  return { stdout, stderr, exitCode: result.exitCode };
}

function checkEnvironmentExists(env: string): CheckResult {
  const { exitCode, stdout, stderr } = runInfisical([
    "secrets",
    "folders",
    "get",
    "--env",
    env,
    "--path",
    "/",
    "-o",
    "json",
  ]);
  if (exitCode !== 0) {
    const combined = `${stdout} ${stderr}`;
    if (combined.includes("not found") || combined.includes("404")) {
      return { status: "missing", message: `environment '${env}' does not exist in Infisical` };
    }
    return { status: "error", message: `failed to check environment: ${combined.slice(0, 120)}` };
  }
  return { status: "ok", message: `environment '${env}' exists` };
}

function listFolders(env: string, path: string): string[] {
  const { stdout, exitCode } = runInfisical([
    "secrets",
    "folders",
    "get",
    "--env",
    env,
    "--path",
    path,
    "-o",
    "json",
  ]);
  if (exitCode !== 0) return [];
  try {
    const parsed = JSON.parse(stdout);
    return (Array.isArray(parsed) ? parsed : []).map(
      (f: { folderName?: string }) => f.folderName ?? "",
    ).filter(Boolean);
  } catch {
    return [];
  }
}

function readSecret(env: string, path: string, key: string): string | null {
  const { stdout, exitCode } = runInfisical([
    "secrets",
    "get",
    key,
    "--env",
    env,
    "--path",
    path,
    "-o",
    "json",
  ]);
  if (exitCode !== 0) return null;
  try {
    const parsed = JSON.parse(stdout);
    if (Array.isArray(parsed) && parsed.length > 0) {
      const val = parsed[0]?.secretValue;
      if (val && val !== "*not found*") return val;
    }
    return null;
  } catch {
    return null;
  }
}

function listSecretKeys(env: string, path: string): string[] {
  const { stdout, exitCode } = runInfisical([
    "secrets",
    "--env",
    env,
    "--path",
    path,
    "-o",
    "json",
  ]);
  if (exitCode !== 0) return [];
  try {
    const parsed = JSON.parse(stdout);
    return (Array.isArray(parsed) ? parsed : [])
      .map((secret: { secretKey?: string }) => secret.secretKey ?? "")
      .filter(Boolean)
      .sort();
  } catch {
    return [];
  }
}

function isPlaceholderValue(value: string): boolean {
  return value === HUMAN_SET_REQUIRED_PLACEHOLDER;
}

function buildFolderPathMap(env: string): Set<string> {
  const paths = new Set<string>();
  paths.add("/");

  const roots = listFolders(env, "/");
  for (const root of roots) {
    paths.add(`/${root}`);
    const children = listFolders(env, `/${root}`);
    for (const child of children) {
      paths.add(`/${root}/${child}`);
    }
  }

  return paths;
}

function envAllowsLocalDevOnly(env: string): boolean {
  return env === "dev";
}

function folderAllowedInEnv(requiredness: Requiredness, env: string): boolean {
  if (requiredness === "deferred") return true;
  return requirednessApplies(requiredness, env) || (envAllowsLocalDevOnly(env) && requiredness === "required_for_hosted");
}

function secretAllowedInEnv(requiredness: Requiredness, env: string): boolean {
  if (envAllowsLocalDevOnly(env)) return true;
  return requiredness === "deferred" || requirednessApplies(requiredness, env);
}

async function testDatabaseConnection(url: string): Promise<{
  connected: boolean;
  currentUser?: string;
  currentDatabase?: string;
  error?: string;
}> {
  try {
    const sql = new Bun.SQL(url);
    const rows = await sql.unsafe(
      "SELECT current_user, current_database()",
    ) as Array<{ current_user: string; current_database: string }>;
    await sql.end();
    if (rows.length > 0) {
      return {
        connected: true,
        currentUser: rows[0].current_user,
        currentDatabase: rows[0].current_database,
      };
    }
    return { connected: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("password authentication failed")) {
      return { connected: false, error: "password authentication failed" };
    }
    return { connected: false, error: message.slice(0, 120) };
  }
}

async function checkMigratorCapabilities(url: string): Promise<CheckResult> {
  try {
    const sql = new Bun.SQL(url);
    const privRows = await sql.unsafe(
      "SELECT has_schema_privilege(current_user, 'public', 'CREATE') as can_create_schema, " +
      "has_table_privilege(current_user, 'schema_migrations', 'INSERT') as can_insert, " +
      "has_table_privilege(current_user, 'schema_migrations', 'SELECT') as can_select"
    ) as Array<{ can_create_schema: boolean; can_insert: boolean; can_select: boolean }>;
    await sql.end();

    if (privRows.length === 0) {
      return { status: "error", message: "could not query role privileges" };
    }

    const privs = privRows[0];
    if (!privs.can_create_schema) {
      return { status: "error", message: "migrator role lacks CREATE on public schema" };
    }
    if (!privs.can_select) {
      return { status: "error", message: "migrator role cannot SELECT on schema_migrations" };
    }
    if (!privs.can_insert) {
      return { status: "error", message: "migrator role cannot INSERT on schema_migrations" };
    }
    return { status: "ok", message: "migrator role has DDL + DML on schema_migrations" };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { status: "error", message: `migrator privilege check failed: ${message.slice(0, 120)}` };
  }
}

async function checkRuntimeRwCapabilities(url: string): Promise<CheckResult> {
  try {
    const sql = new Bun.SQL(url);
    const requiredTables = [
      "users",
      "auth_provider_links",
      "verification_sessions",
      "user_attestations",
      "identity_nullifiers",
      "communities",
      "community_database_bindings",
      "community_db_credentials",
      "community_gate_rules",
      "community_post_projections",
      "comment_projections",
      "namespace_verification_sessions",
      "namespace_verifications",
      "namespace_verification_evidence_bundles",
      "namespace_verification_assertions",
      "namespace_verification_capabilities",
      "jobs",
      "audit_log",
      "user_agents",
      "agent_handles",
    ];
    const values = requiredTables.map((tableName) => `('${tableName}')`).join(", ");
    const privRows = await sql.unsafe(`
      WITH required_tables(table_name) AS (VALUES ${values})
      SELECT
        table_name,
        to_regclass(format('public.%I', table_name)) IS NOT NULL AS table_exists,
        CASE
          WHEN to_regclass(format('public.%I', table_name)) IS NULL THEN false
          ELSE has_table_privilege(current_user, format('public.%I', table_name), 'SELECT')
        END AS can_select,
        CASE
          WHEN to_regclass(format('public.%I', table_name)) IS NULL THEN false
          ELSE has_table_privilege(current_user, format('public.%I', table_name), 'INSERT')
        END AS can_insert,
        CASE
          WHEN to_regclass(format('public.%I', table_name)) IS NULL THEN false
          ELSE has_table_privilege(current_user, format('public.%I', table_name), 'UPDATE')
        END AS can_update,
        CASE
          WHEN to_regclass(format('public.%I', table_name)) IS NULL THEN false
          ELSE has_table_privilege(current_user, format('public.%I', table_name), 'DELETE')
        END AS can_delete
      FROM required_tables
      ORDER BY table_name
    `) as Array<{
      table_name: string;
      table_exists: boolean;
      can_select: boolean;
      can_insert: boolean;
      can_update: boolean;
      can_delete: boolean;
    }>;
    const schemaRows = await sql.unsafe(
      "SELECT has_schema_privilege(current_user, 'public', 'CREATE') as can_create_schema",
    ) as Array<{ can_create_schema: boolean }>;
    await sql.end();

    if (schemaRows.length === 0 || privRows.length === 0) {
      return { status: "error", message: "could not query role privileges" };
    }

    if (schemaRows[0].can_create_schema) {
      return { status: "error", message: "runtime role has CREATE on public schema (expected DML-only)" };
    }

    const missingTables = privRows
      .filter((row) => !row.table_exists)
      .map((row) => row.table_name);
    if (missingTables.length > 0) {
      return { status: "error", message: `runtime required tables missing: ${missingTables.join(", ")}` };
    }

    const missingDml = privRows
      .filter((row) => !row.can_select || !row.can_insert || !row.can_update || !row.can_delete)
      .map((row) => {
        const missing = [
          !row.can_select ? "SELECT" : null,
          !row.can_insert ? "INSERT" : null,
          !row.can_update ? "UPDATE" : null,
          !row.can_delete ? "DELETE" : null,
        ].filter(Boolean).join("/");
        return `${row.table_name}(${missing})`;
      });
    if (missingDml.length > 0) {
      return { status: "error", message: `runtime role lacks DML on ${missingDml.join(", ")}` };
    }

    return { status: "ok", message: "runtime role has DML on happy-path tables and no schema CREATE" };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { status: "error", message: `runtime role check failed: ${message.slice(0, 120)}` };
  }
}

const options = parseArgs(process.argv.slice(2));

let totalErrors = 0;
let totalWarnings = 0;

console.log(`\ninfisical environment doctor`);
console.log(`env: ${options.env}`);
console.log(`profile: ${options.profile}`);
console.log(`connect: ${options.connect}`);
console.log(`allow_extra: ${options.allowExtra}`);
console.log("");

// 1. Check environment exists
const envResult = checkEnvironmentExists(options.env);
if (envResult.status !== "ok") {
  console.log(`FAIL  ${envResult.message}`);
  process.exit(1);
}
console.log(`  ok   environment '${options.env}' exists`);

// 2. Check folders
console.log("");
console.log("folders:");

const existingPaths = buildFolderPathMap(options.env);

for (const folder of ENV_CONTRACT.folders) {
  if (!requirednessApplies(folder.requiredness, options.env) && !options.verbose) continue;

  const exists = existingPaths.has(folder.path);
  const applies = requirednessApplies(folder.requiredness, options.env);
  const label = requirednessLabel(folder.requiredness);

  if (exists) {
    console.log(`  ok   ${folder.path}`);
  } else if (applies) {
    console.log(`FAIL  ${folder.path} missing (${label})`);
    totalErrors++;
  } else if (options.verbose) {
    console.log(`  --   ${folder.path} missing (${label})`);
  }
}

if (!options.allowExtra) {
  const allowedFolderPaths = new Set(
    ENV_CONTRACT.folders
      .filter((folder) => folderAllowedInEnv(folder.requiredness, options.env))
      .map((folder) => folder.path),
  );
  const unexpectedFolders = Array.from(existingPaths)
    .filter((path) => path !== "/" && !allowedFolderPaths.has(path))
    .sort();

  for (const path of unexpectedFolders) {
    console.log(`FAIL  ${path} unexpected live folder for env '${options.env}'`);
    totalErrors++;
  }
}

// 3. Check secrets
console.log("");
console.log("secrets:");

const secretReads: SecretRead[] = [];
const selectedSecretIds = profileSecretIds(options.profile);

for (const spec of ENV_CONTRACT.secrets) {
  if (selectedSecretIds && !selectedSecretIds.has(secretId(spec.path, spec.key))) continue;

  const applies = requirednessApplies(spec.requiredness, options.env);
  const label = requirednessLabel(spec.requiredness);

  if (!applies && !options.verbose) continue;

  const value = readSecret(options.env, spec.path, spec.key);
  secretReads.push({ path: spec.path, key: spec.key, value });

  if (value === null) {
    if (applies) {
      console.log(`FAIL  ${spec.path} ${spec.key} missing (${label})`);
      totalErrors++;
    } else if (options.verbose) {
      console.log(`  --   ${spec.path} ${spec.key} missing (${label})`);
    }
    continue;
  }

  if (value.length === 0) {
    if (applies) {
      console.log(`FAIL  ${spec.path} ${spec.key} empty (${label})`);
      totalErrors++;
    } else if (options.verbose) {
      console.log(`WARN  ${spec.path} ${spec.key} empty (${label})`);
      totalWarnings++;
    }
    continue;
  }

  if (isPlaceholderValue(value)) {
    if (applies) {
      console.log(`FAIL  ${spec.path} ${spec.key} invalid: human-set placeholder (${label})`);
      totalErrors++;
    } else if (options.verbose) {
      console.log(`WARN  ${spec.path} ${spec.key} invalid: human-set placeholder (${label})`);
      totalWarnings++;
    }
    continue;
  }

  const validationError = spec.validate ? spec.validate(value) : null;
  if (validationError) {
    if (applies) {
      console.log(`FAIL  ${spec.path} ${spec.key} invalid: ${validationError} (${label})`);
      totalErrors++;
    } else if (options.verbose) {
      console.log(`WARN  ${spec.path} ${spec.key} invalid: ${validationError} (${label})`);
      totalWarnings++;
    }
    continue;
  }

  console.log(`  ok   ${spec.path} ${spec.key}`);
}

// 4. Check live Infisical drift against the whole contract, not just the selected profile.
if (!options.allowExtra) {
  console.log("");
  console.log("live drift:");

  let driftCount = 0;
  const declaredSecrets = new Map(
    ENV_CONTRACT.secrets.map((spec) => [secretId(spec.path, spec.key), spec]),
  );

  const pathsToInspect = Array.from(existingPaths)
    .filter((path) => path !== "/")
    .sort();

  for (const path of pathsToInspect) {
    for (const key of listSecretKeys(options.env, path)) {
      const spec = declaredSecrets.get(secretId(path, key));
      if (!spec) {
        console.log(`FAIL  ${path} ${key} undeclared live secret`);
        totalErrors++;
        driftCount++;
        continue;
      }

      if (!secretAllowedInEnv(spec.requiredness, options.env)) {
        console.log(`FAIL  ${path} ${key} not allowed in env '${options.env}' (${requirednessLabel(spec.requiredness)})`);
        totalErrors++;
        driftCount++;
      }
    }
  }

  if (driftCount === 0) {
    console.log("  ok   no undeclared or disallowed live secrets");
  }
} else if (options.verbose) {
  console.log("");
  console.log("live drift:");
  console.log("  --   skipped (--allow-extra)");
}

// 5. Cross-path consistency checks
console.log("");
console.log("cross-path checks:");

const secretsMap = new Map<string, { path: string; value: string | null }>();
for (const read of secretReads) {
  secretsMap.set(`${read.key}__${read.path}`, { path: read.path, value: read.value });
}

for (const check of ENV_CONTRACT.crossPathChecks) {
  const result = check.check(secretsMap);
  if (result.status === "fail") {
    console.log(`FAIL  ${check.description}: ${result.message}`);
    totalErrors++;
  } else if (result.status === "skip") {
    if (options.verbose) {
      console.log(`  --   ${check.description} (${result.message})`);
    }
  } else {
    console.log(`  ok   ${check.description}`);
  }
}

// 6. --connect mode
if (options.connect) {
  console.log("");
  console.log("database connections:");

  const dbSecrets = secretReads.filter(
    (r) => r.key.endsWith("_DATABASE_URL") && r.value !== null,
  );

  const roleChecks: Array<{
    key: string;
    url: string;
    expectedRole: string;
    capabilityCheck: (url: string) => Promise<CheckResult>;
  }> = [];

  for (const read of dbSecrets) {
    const { stdout, exitCode } = runInfisical([
      "secrets",
      "get",
      read.key,
      "--env",
      options.env,
      "--path",
      read.path,
      "-o",
      "json",
    ]);
    if (exitCode !== 0) continue;

    let urlValue: string;
    try {
      const parsed = JSON.parse(stdout);
      urlValue = parsed[0]?.secretValue;
      if (!urlValue || urlValue === "*not found*") continue;
    } catch {
      continue;
    }

    let expectedRole: string;
    try {
      expectedRole = new URL(urlValue).username;
    } catch {
      continue;
    }

    let capabilityCheck: (url: string) => Promise<CheckResult>;
    if (expectedRole === "control_plane_migrator") {
      capabilityCheck = checkMigratorCapabilities;
    } else if (expectedRole === "control_plane_api_rw") {
      capabilityCheck = checkRuntimeRwCapabilities;
    } else {
      capabilityCheck = async () => ({ status: "ok", message: "no capability check for this role" });
    }

    roleChecks.push({ key: read.key, url: urlValue, expectedRole, capabilityCheck });
  }

  for (const { key, url, expectedRole, capabilityCheck } of roleChecks) {
    const result = await testDatabaseConnection(url);

    if (!result.connected) {
      console.log(`FAIL  ${key}: connection failed - ${result.error}`);
      totalErrors++;
      continue;
    }

    const roleMatches = result.currentUser === expectedRole;
    if (!roleMatches) {
      console.log(
        `FAIL  ${key}: connected as '${result.currentUser}', expected '${expectedRole}'`,
      );
      totalErrors++;
    } else {
      console.log(
        `  ok   ${key}: connected as '${result.currentUser}' on '${result.currentDatabase}'`,
      );
    }

    const capResult = await capabilityCheck(url);
    if (capResult.status !== "ok") {
      console.log(`FAIL  ${key} capability: ${capResult.message}`);
      totalErrors++;
    } else {
      console.log(`  ok   ${key} capability: ${capResult.message}`);
    }
  }
}

// Summary
console.log("");
if (totalErrors === 0 && totalWarnings === 0) {
  console.log("all checks passed");
} else {
  if (totalErrors > 0) {
    console.log(`${totalErrors} error(s)`);
  }
  if (totalWarnings > 0) {
    console.log(`${totalWarnings} warning(s)`);
  }
}

process.exit(totalErrors > 0 ? 1 : 0);
