#!/usr/bin/env bun

import { TursoPlatformClient } from "./lib/turso-platform";

type BindingRow = {
  group_name: string;
};

type Options = {
  groupName: string | null;
  allOrphans: boolean;
  includeDefaultGroup: boolean;
  dryRun: boolean;
};

function usage(): never {
  console.error(`Usage:
  bun scripts/cleanup-orphaned-turso-resources.ts (--group-name NAME | --all-orphans) [--include-default-group] [--dry-run]

Deletes Turso groups and databases that have no control-plane binding rows.

Environment:
  CONTROL_PLANE_DATABASE_URL  Required.
  TURSO_PLATFORM_API_TOKEN    Required.
  TURSO_ORGANIZATION_SLUG     Required.

Options:
  --group-name NAME           Delete one specific orphaned group.
  --all-orphans               Delete every orphaned group in the org.
  --include-default-group     Allow the Turso system default group to be considered.
  --dry-run                   Report candidates without deleting them.
  -h, --help                  Show this help text.`);
  process.exit(1);
}

function parseArgs(argv: string[]): Options {
  const options: Options = {
    groupName: null,
    allOrphans: false,
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
      case "--all-orphans":
        options.allOrphans = true;
        index += 1;
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

  if ((options.groupName ? 1 : 0) + (options.allOrphans ? 1 : 0) !== 1) {
    console.error("provide exactly one of --group-name or --all-orphans");
    usage();
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
const controlPlaneDatabaseUrl = requireEnv("CONTROL_PLANE_DATABASE_URL");
const organizationSlug = requireEnv("TURSO_ORGANIZATION_SLUG");
const apiToken = requireEnv("TURSO_PLATFORM_API_TOKEN");

const platform = new TursoPlatformClient({
  apiToken,
});

const db = new Bun.SQL(controlPlaneDatabaseUrl);

try {
  const bindingRows = await db<BindingRow[]>`
    SELECT DISTINCT group_name
    FROM community_database_bindings
    WHERE group_name IS NOT NULL
  `;

  const boundGroups = new Set(bindingRows.map((row) => row.group_name));
  const allGroups = await platform.listGroups(organizationSlug);
  const visibleGroups = allGroups.filter((group) => {
    if (!options.includeDefaultGroup && group.name === "default") {
      return false;
    }
    if (options.groupName) {
      return group.name === options.groupName;
    }
    return true;
  });

  if (options.groupName && visibleGroups.length === 0) {
    console.error(`group not found: ${options.groupName}`);
    process.exit(1);
  }

  const orphanGroups = visibleGroups.filter((group) => !boundGroups.has(group.name));

  if (options.groupName && orphanGroups.length === 0) {
    console.error(`group is not orphaned in the control plane: ${options.groupName}`);
    process.exit(1);
  }

  let deletedGroupCount = 0;
  let deletedDatabaseCount = 0;

  for (const group of orphanGroups) {
    const databases = await platform.listDatabases({
      organizationSlug,
      groupName: group.name,
    });

    console.log(`${options.dryRun ? "would_delete" : "delete"} orphaned group: ${group.name}`);
    for (const database of databases) {
      console.log(
        `${options.dryRun ? "would_delete" : "delete"} orphaned database: ${group.name}/${database.name}`,
      );
    }

    if (options.dryRun) {
      deletedGroupCount += 1;
      deletedDatabaseCount += databases.length;
      continue;
    }

    if (group.deleteProtection === true) {
      await platform.updateGroupConfiguration({
        organizationSlug,
        groupName: group.name,
        deleteProtection: false,
      });
    }

    for (const database of databases) {
      if (database.deleteProtection === true) {
        await platform.updateDatabaseConfiguration({
          organizationSlug,
          databaseName: database.name,
          deleteProtection: false,
        });
      }

      await platform.deleteDatabase({
        organizationSlug,
        databaseName: database.name,
      });
      deletedDatabaseCount += 1;
    }

    await platform.deleteGroup({
      organizationSlug,
      groupName: group.name,
    });
    deletedGroupCount += 1;
  }

  console.log("");
  console.log("turso orphan cleanup complete");
  console.log(`organization: ${organizationSlug}`);
  console.log(`orphan_groups: ${orphanGroups.length}`);
  console.log(`groups_${options.dryRun ? "planned" : "deleted"}: ${deletedGroupCount}`);
  console.log(`databases_${options.dryRun ? "planned" : "deleted"}: ${deletedDatabaseCount}`);
  console.log(`mode: ${options.dryRun ? "dry-run" : "apply"}`);
} finally {
  await db.end();
}
