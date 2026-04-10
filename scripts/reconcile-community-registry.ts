#!/usr/bin/env bun

import { createRuntimeStore } from "../references/templates/api-worker-auth-first-slice/src/runtime";
import type { Env } from "../references/templates/api-worker-auth-first-slice/src/types/env";

function usage(): never {
  console.error("Usage: bun scripts/reconcile-community-registry.ts [--community-id ID|--all-pending]");
  process.exit(1);
}

let communityId = "";
let allPending = false;
for (let index = 2; index < process.argv.length; ) {
  const arg = process.argv[index];
  const value = process.argv[index + 1];
  if (arg === "--community-id") {
    communityId = value || "";
    index += 2;
    continue;
  }
  if (arg === "--all-pending") {
    allPending = true;
    index += 1;
    continue;
  }
  usage();
}

if (!communityId && !allPending) {
  usage();
}

const env = process.env as unknown as Env;
const store = createRuntimeStore(env);
if (allPending) {
  const rows = await store.listCommunitiesRequiringRegistryAttention();
  console.log(
    JSON.stringify(
      rows.map((row) => ({
        community_id: row.community_id,
        provisioning_state: row.provisioning_state,
        registry_publication_state: row.registry_publication_state,
        registry_attempt_id: row.registry_attempt_id,
        registry_publication_job_id: row.registry_publication_job_id,
        registry_error_code: row.registry_error_code,
        updated_at: row.updated_at,
      })),
      null,
      2,
    ),
  );
  process.exit(0);
}
const community = await store.getCommunityById(communityId);
const refs = await store.getCommunityRegistryTableRefByCommunityId(communityId);

if (!community) {
  throw new Error(`community_not_found:${communityId}`);
}

console.log(
  JSON.stringify(
    {
      community_id: community.community_id,
      registry_publication_state: community.registry_publication_state,
      registry_error_code: community.registry_error_code,
      registry_attempt_id: community.registry_attempt_id,
      refs,
      reconcile_supported: false,
      note: "Phase 1 only records current registry state; live Tableland reconciliation is not implemented yet.",
    },
    null,
    2,
  ),
);
