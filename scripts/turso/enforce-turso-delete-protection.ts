#!/usr/bin/env bun

import { TursoPlatformClient } from "../lib/turso-platform";

type Options = {
  groupName: string | null;
  includeDefaultGroup: boolean;
  dryRun: boolean;
};

function usage(): never {
  console.error(`Usage:
  bun scripts/turso/enforce-turso-delete-protection.ts [--group-name NAME] [--include-default-group] [--dry-run]

Enables Turso delete protection on groups and databases in the configured organization.

Environment:
  TURSO_PLATFORM_API_TOKEN   Required.
  TURSO_ORGANIZATION_SLUG    Required.

Options:
  --group-name NAME          Limit enforcement to a single group.
  --include-default-group    Include the Turso system default group.
  --dry-run                  Report drift without writing changes.
  -h, --help                 Show this help text.`);
  process.exit(1);
}

function parseArgs(argv: string[]): Options {
  const options: Options = {
    groupName: null,
    includeDefaultGroup: false,
    dryRun: false,
  };

  for (let index = 0; index < argv.length; ) {
    const arg = argv[index];

    switch (arg) {
      case "--group-name":
        options.groupName = String(argv[index + 1] ?? "").trim() || null;
        index += 2;
        break;
      case "--include-default-group":
        options.includeDefaultGroup = true;
        index += 1;
        break;
      case "--dry-run":
        options.dryRun = true;
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

function requireEnv(name: string): string {
  const value = String(process.env[name] ?? "").trim();
  if (!value) {
    console.error(`missing required env var: ${name}`);
    process.exit(1);
  }
  return value;
}

const options = parseArgs(process.argv.slice(2));
const organizationSlug = requireEnv("TURSO_ORGANIZATION_SLUG");
const apiToken = requireEnv("TURSO_PLATFORM_API_TOKEN");

const platform = new TursoPlatformClient({
  apiToken,
});

const allGroups = await platform.listGroups(organizationSlug);
const groups = allGroups.filter((group) => {
  if (options.groupName) {
    return group.name === options.groupName;
  }
  if (!options.includeDefaultGroup && group.name === "default") {
    return false;
  }
  return true;
});

if (options.groupName && groups.length === 0) {
  console.error(`group not found: ${options.groupName}`);
  process.exit(1);
}

let groupUpdatedCount = 0;
let databaseCheckedCount = 0;
let databaseUpdatedCount = 0;

for (const group of groups) {
  if (group.deleteProtection !== true) {
    console.log(`${options.dryRun ? "would_enable" : "enable"} group delete protection: ${group.name}`);
    if (!options.dryRun) {
      await platform.updateGroupConfiguration({
        organizationSlug,
        groupName: group.name,
        deleteProtection: true,
      });
    }
    groupUpdatedCount += 1;
  }

  const databases = await platform.listDatabases({
    organizationSlug,
    groupName: group.name,
  });

  for (const database of databases) {
    databaseCheckedCount += 1;
    if (database.deleteProtection === true) {
      continue;
    }

    console.log(
      `${options.dryRun ? "would_enable" : "enable"} database delete protection: ${group.name}/${database.name}`,
    );
    if (!options.dryRun) {
      await platform.updateDatabaseConfiguration({
        organizationSlug,
        databaseName: database.name,
        deleteProtection: true,
      });
    }
    databaseUpdatedCount += 1;
  }
}

console.log("");
console.log("turso delete protection enforcement complete");
console.log(`organization: ${organizationSlug}`);
console.log(`groups_checked: ${groups.length}`);
console.log(`groups_updated: ${groupUpdatedCount}`);
console.log(`databases_checked: ${databaseCheckedCount}`);
console.log(`databases_updated: ${databaseUpdatedCount}`);
console.log(`mode: ${options.dryRun ? "dry-run" : "apply"}`);
