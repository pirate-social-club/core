#!/usr/bin/env bun

import { ENV_CONTRACT, requirednessApplies, requirednessLabel } from "./lib/infisical-env-contract";

type Options = {
  env: string;
  dryRun: boolean;
};

function usage(): never {
  console.error(`Usage:
  bun scripts/bootstrap-infisical.ts --env ENV [--dry-run]

Bootstraps Infisical folders and secrets from the contract defined in
scripts/lib/infisical-env-contract.ts.

For each secret in the contract that applies to the target environment,
this script:
  1. Ensures the parent folders exist
  2. Reads the corresponding env var from the current process
  3. Writes the secret to Infisical if the env var is set

Set env vars before running:
  CONTROL_PLANE_DATABASE_URL=... CONTROL_PLANE_MIGRATOR_DATABASE_URL=... \\
  bun scripts/bootstrap-infisical.ts --env dev

Options:
  --env ENV       Infisical environment slug
  --dry-run       Print what would be done without making changes
  -h, --help      Show this help text`);
  process.exit(1);
}

function parseArgs(argv: string[]): Options {
  const options: Options = { env: "", dryRun: false };

  for (let i = 0; i < argv.length; ) {
    const arg = argv[i];
    const value = argv[i + 1];
    switch (arg) {
      case "--env":
        options.env = value ?? "";
        i += 2;
        break;
      case "--dry-run":
        options.dryRun = true;
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

function runCommand(args: string[]): { stdout: string; exitCode: number } {
  const result = Bun.spawnSync(["rtk", "infisical", ...args], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const stdout = new TextDecoder().decode(result.stdout).trim();
  return { stdout, exitCode: result.exitCode };
}

function folderExists(path: string, name: string, env: string): boolean {
  const { stdout, exitCode } = runCommand([
    "secrets", "folders", "get",
    "--env", env, "--path", path, "-o", "json",
  ]);
  if (exitCode !== 0) return false;
  return new RegExp(`"folderName"\\s*:\\s*"${name}"`).test(stdout);
}

function ensureFolder(path: string, name: string, env: string, dryRun: boolean) {
  if (folderExists(path, name, env)) return;
  if (dryRun) {
    console.log(`  would create folder ${path}/${name}`);
    return;
  }
  runCommand(["secrets", "folders", "create", "--env", env, "--path", path, "--name", name]);
  console.log(`  created folder ${path}/${name}`);
}

function setSecret(path: string, name: string, value: string, env: string, dryRun: boolean) {
  if (dryRun) {
    console.log(`  would set ${path} ${name}`);
    return;
  }
  const tempFile = `/tmp/infisical-bootstrap-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  Bun.write(tempFile, value);
  runCommand(["secrets", "set", "--env", env, "--path", path, `${name}=@${tempFile}`]);
  Bun.file(tempFile).unlink?.();
  console.log(`  set ${path} ${name}`);
}

const options = parseArgs(process.argv.slice(2));

const applicableFolders = ENV_CONTRACT.folders.filter(
  (f) => requirednessApplies(f.requiredness, options.env),
);

const applicableSecrets = ENV_CONTRACT.secrets.filter(
  (s) => requirednessApplies(s.requiredness, options.env),
);

console.log(`bootstrap-infisical env=${options.env} dry-run=${options.dryRun}`);
console.log(`${applicableFolders.length} folders, ${applicableSecrets.length} secrets in contract`);
console.log("");

const folderPaths = new Set<string>();
for (const folder of applicableFolders) {
  folderPaths.add(folder.path);
}

const ensuredFolders = new Set<string>();
for (const folderPath of folderPaths) {
  if (folderPath === "/") continue;
  const parts = folderPath.split("/").filter(Boolean);
  let currentPath = "";
  for (const part of parts) {
    const parent = currentPath || "/";
    currentPath = currentPath ? `${currentPath}/${part}` : `/${part}`;
    if (!ensuredFolders.has(currentPath)) {
      ensureFolder(parent, part, options.env, options.dryRun);
      ensuredFolders.add(currentPath);
    }
  }
}

console.log("");
console.log("secrets:");

let provided = 0;
let skipped = 0;

for (const spec of applicableSecrets) {
  const value = process.env[spec.key];
  if (!value) {
    const label = requirednessLabel(spec.requiredness);
    console.log(`  skip  ${spec.path} ${spec.key} (env var not set, ${label})`);
    skipped++;
    continue;
  }

  const validationError = spec.validate ? spec.validate(value) : null;
  if (validationError) {
    console.log(`  skip  ${spec.path} ${spec.key} (validation: ${validationError})`);
    skipped++;
    continue;
  }

  setSecret(spec.path, spec.key, value, options.env, options.dryRun);
  provided++;
}

console.log("");
console.log(`provided: ${provided}, skipped: ${skipped}`);
console.log("");
console.log("validate with:");
console.log(`  bun scripts/check-infisical-env.ts --env ${options.env} --connect`);
