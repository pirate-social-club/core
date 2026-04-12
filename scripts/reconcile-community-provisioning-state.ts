#!/usr/bin/env bun

import { reconcileCommunityProvisioningState } from "./lib/community-provisioning-reconcile";

type Options = {
  communityIds: string[];
  allErrorCommunities: boolean;
  dryRun: boolean;
};

function usage(): never {
  console.error(`Usage:
  bun scripts/reconcile-community-provisioning-state.ts [options]

Promotes communities from provisioning_state=error to provisioning_state=active
when the active binding/credential shape is sane.

Environment:
  CONTROL_PLANE_DATABASE_URL   Required.

Options:
  --community-id ID            Reconcile a specific community. Repeatable.
  --all-error-communities      Reconcile every active error community.
  --dry-run                    Report eligible communities without writing.
  -h, --help                   Show this help text.`);
  process.exit(1);
}

function parseArgs(argv: string[]): Options {
  const options: Options = {
    communityIds: [],
    allErrorCommunities: false,
    dryRun: false,
  };

  for (let index = 0; index < argv.length; ) {
    const arg = argv[index];

    switch (arg) {
      case "--community-id":
        options.communityIds.push(String(argv[index + 1] ?? "").trim());
        index += 2;
        break;
      case "--all-error-communities":
        options.allErrorCommunities = true;
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

const result = await reconcileCommunityProvisioningState({
  controlPlaneDatabaseUrl: requireEnv("CONTROL_PLANE_DATABASE_URL"),
  communityIds: options.communityIds,
  allErrorCommunities: options.allErrorCommunities,
  dryRun: options.dryRun,
});

console.log("community provisioning reconciliation complete");
console.log(`checked_communities: ${result.checkedCommunityCount}`);
console.log(`promoted_communities: ${result.promotedCommunityCount}`);

for (const community of result.communities) {
  console.log(`${community.status} community_id=${community.communityId} reason=${community.reason}`);
}
