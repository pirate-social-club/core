#!/usr/bin/env bun

import {
  isSecretProfile,
  WRANGLER_MANAGED_CONFIG_NAMES,
  wranglerApiOptionalSecretNames,
  wranglerApiRequiredSecretNames,
  type SecretProfile,
} from "../lib/infisical-env-contract";

type Kind = "required" | "optional" | "managed-config";

function usage(): never {
  console.error(`Usage:
  bun scripts/infisical/print-wrangler-api-secret-names.ts --profile PROFILE --kind KIND

PROFILE: core, happy-path, commerce
KIND: required, optional, managed-config`);
  process.exit(1);
}

function parseArgs(argv: string[]): { profile: Exclude<SecretProfile, "all">; kind: Kind } {
  let profile = "";
  let kind = "";

  for (let i = 0; i < argv.length; ) {
    const arg = argv[i];
    const value = argv[i + 1];
    switch (arg) {
      case "--profile":
        profile = value ?? "";
        i += 2;
        break;
      case "--kind":
        kind = value ?? "";
        i += 2;
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

  if (!isSecretProfile(profile) || profile === "all") {
    console.error(`invalid profile: ${profile}`);
    usage();
  }
  if (kind !== "required" && kind !== "optional" && kind !== "managed-config") {
    console.error(`invalid kind: ${kind}`);
    usage();
  }

  return { profile, kind };
}

const options = parseArgs(process.argv.slice(2));
const names = options.kind === "required"
  ? wranglerApiRequiredSecretNames(options.profile)
  : options.kind === "optional"
    ? wranglerApiOptionalSecretNames(options.profile)
    : Array.from(WRANGLER_MANAGED_CONFIG_NAMES);

for (const name of names) {
  console.log(name);
}
