#!/usr/bin/env bun

import { resolve } from "node:path";
import {
  isSecretProfile,
  WRANGLER_MANAGED_CONFIG_NAMES,
  wranglerApiOptionalSecretNames,
  wranglerApiRequiredSecretNames,
  type SecretProfile,
} from "../lib/infisical-env-contract";

type Options = {
  apiDir: string;
  workerName: string;
  wranglerEnv: string;
  profile: Exclude<SecretProfile, "all">;
  allowExtra: boolean;
};

type WranglerSecret = {
  name?: string;
  type?: string;
};

function usage(exitCode = 1): never {
  console.error(`Usage:
  bun scripts/infisical/check-wrangler-api-secrets.ts [--api-dir PATH] [--worker-name NAME] [--wrangler-env ENV] [--profile PROFILE] [--allow-extra]

Audits Cloudflare Worker secret names for the API worker.

PROFILE: core, happy-path, commerce. Default: happy-path.

Options:
  --api-dir PATH       API service directory. Default: ../api/services/api from core.
  --worker-name NAME   Cloudflare Worker name. Default: pirate-api-core.
  --wrangler-env ENV   Wrangler environment. Omit for top-level production worker.
  --profile PROFILE    Secret profile to require. Default: happy-path.
  --allow-extra        Warn instead of failing on unmanaged extra secrets.
  -h, --help           Show this help text.`);
  process.exit(exitCode);
}

function parseArgs(argv: string[]): Options {
  const options: Options = {
    apiDir: resolve(process.cwd(), "../api/services/api"),
    workerName: "pirate-api-core",
    wranglerEnv: "",
    profile: "happy-path",
    allowExtra: false,
  };

  for (let index = 0; index < argv.length; ) {
    const arg = argv[index];
    const value = argv[index + 1];

    switch (arg) {
      case "--api-dir":
        options.apiDir = resolve(value ?? "");
        index += 2;
        break;
      case "--worker-name":
        options.workerName = value ?? "";
        index += 2;
        break;
      case "--wrangler-env":
        options.wranglerEnv = value ?? "";
        index += 2;
        break;
      case "--profile":
        if (!isSecretProfile(value) || value === "all") {
          console.error(`invalid profile: ${value ?? ""}`);
          usage();
        }
        options.profile = value;
        index += 2;
        break;
      case "--allow-extra":
        options.allowExtra = true;
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

  if (!options.apiDir || !options.workerName) {
    usage();
  }

  return options;
}

function runWranglerSecretList(options: Options): WranglerSecret[] {
  const wrangler = resolve(options.apiDir, "node_modules/.bin/wrangler");
  const args = ["secret", "list", "--name", options.workerName, "--format", "json"];
  if (options.wranglerEnv) {
    args.push("--env", options.wranglerEnv);
  }

  const result = Bun.spawnSync([wrangler, ...args], {
    cwd: options.apiDir,
    stdout: "pipe",
    stderr: "pipe",
  });
  const stdout = new TextDecoder().decode(result.stdout).trim();
  const stderr = new TextDecoder().decode(result.stderr).trim();

  if (result.exitCode !== 0) {
    if (stderr) console.error(stderr);
    if (stdout) console.error(stdout);
    process.exit(result.exitCode);
  }

  const parsed = JSON.parse(stdout || "[]") as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error("wrangler secret list did not return an array");
  }
  return parsed as WranglerSecret[];
}

function sorted(values: Iterable<string>): string[] {
  return Array.from(values).sort((left, right) => left.localeCompare(right));
}

const options = parseArgs(process.argv.slice(2));
const requiredNames = new Set(wranglerApiRequiredSecretNames(options.profile));
const optionalNames = new Set(wranglerApiOptionalSecretNames(options.profile));
const managedConfigNames = new Set<string>(WRANGLER_MANAGED_CONFIG_NAMES);
const allowedNames = new Set([...requiredNames, ...optionalNames]);
const liveNames = new Set(
  runWranglerSecretList(options)
    .map((secret) => String(secret.name ?? "").trim())
    .filter(Boolean),
);

const missingRequired = sorted([...requiredNames].filter((name) => !liveNames.has(name)));
const extraNames = sorted([...liveNames].filter((name) => !allowedNames.has(name)));
const managedConfigAsSecrets = extraNames.filter((name) => managedConfigNames.has(name));
const unmanagedExtra = extraNames.filter((name) => !managedConfigNames.has(name));

console.log("wrangler API secret audit");
console.log(`worker_name: ${options.workerName}`);
console.log(`wrangler_env: ${options.wranglerEnv || "<top-level>"}`);
console.log(`profile: ${options.profile}`);
console.log(`live_secret_count: ${liveNames.size}`);
console.log("");

if (missingRequired.length > 0) {
  console.log("missing required:");
  for (const name of missingRequired) console.log(`- ${name}`);
}

if (managedConfigAsSecrets.length > 0) {
  console.log("managed config present as secrets:");
  for (const name of managedConfigAsSecrets) console.log(`- ${name}`);
}

if (unmanagedExtra.length > 0) {
  console.log("unmanaged extra secrets:");
  for (const name of unmanagedExtra) console.log(`- ${name}`);
}

const hasExtraFailure = extraNames.length > 0 && !options.allowExtra;
if (missingRequired.length > 0 || hasExtraFailure) {
  console.log("");
  console.log("status: fail");
  process.exit(1);
}

if (extraNames.length > 0) {
  console.log("");
  console.log("status: warn");
  process.exit(0);
}

console.log("status: ok");
