#!/usr/bin/env bun

type Options = {
  apiUrl: string;
  adminAsUserId: string;
  communityIds: string[];
  execute: boolean;
  revert: boolean;
};

const PILOT_COMMUNITIES: { id: string; label: string }[] = [
  { id: "cmt_358e886a684241f0ab29649f80e43cfa", label: "🇲🇦 Morocco" },
  { id: "cmt_f4093c6c16f745df90f2196c1bcac925", label: "🇦🇪 UAE" },
  { id: "cmt_e7e6d5f2db6642ea929a2d6ade44b7fe", label: "🇪🇸 Spain" },
  { id: "cmt_be418c4fee43425f9c864ceb0247f6a2", label: "🇻🇳 Vietnam" },
  { id: "cmt_75e95eb8ad464f9fa101625748489141", label: "🇸🇦 Saudi Arabia" },
];

function usage(exitCode = 1): never {
  console.error(`Usage:
  rtk infisical run --env prod --path /services/api -- \\
    rtk bun scripts/community/create-pilot-anonymous-test-posts.ts [options]

  Creates one anonymous thread_stable test post per pilot community to verify
  the end-to-end anonymous posting surface.

Environment:
  PIRATE_ADMIN_TOKEN       Injected by infisical run.

Options:
  --api-url URL             Pirate API base URL. Default: https://api.pirate.sc
  --admin-as-user-id ID     User ID for x-admin-as-user-id header. Required.
  --community-id ID         Target community. Repeatable.
                            Defaults to the 5 pilot countries.
  --revert                  Delete the test posts instead of creating them.
  --execute                 Apply the action. Omit for dry-run.
  -h, --help                Show this help text.`);
  process.exit(exitCode);
}

function requireOptionValue(arg: string, value: string | undefined): string {
  if (value == null || value === "") {
    console.error(`${arg} requires a value`);
    usage();
  }
  if (value.startsWith("-")) {
    console.error(`${arg} value must not start with '-' (got '${value}')`);
    usage();
  }
  return value;
}

function parseArgs(argv: string[]): Options {
  const options: Options = {
    apiUrl: "https://api.pirate.sc",
    adminAsUserId: "",
    communityIds: [],
    execute: false,
    revert: false,
  };

  for (let index = 0; index < argv.length;) {
    const arg = argv[index];
    const value = argv[index + 1];

    switch (arg) {
      case "--api-url":
        options.apiUrl = requireOptionValue(arg, value);
        index += 2;
        break;
      case "--admin-as-user-id":
        options.adminAsUserId = requireOptionValue(arg, value);
        index += 2;
        break;
      case "--community-id":
        options.communityIds.push(requireOptionValue(arg, value));
        index += 2;
        break;
      case "--execute":
        options.execute = true;
        index += 1;
        break;
      case "--revert":
        options.revert = true;
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

  if (!options.adminAsUserId) {
    console.error("--admin-as-user-id is required");
    usage();
  }
  options.communityIds = options.communityIds.length > 0
    ? options.communityIds
    : PILOT_COMMUNITIES.map((p) => p.id);
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
const adminToken = requireEnv("PIRATE_ADMIN_TOKEN");

const targetCommunities = options.communityIds;
const pilotLabel = (id: string) =>
  PILOT_COMMUNITIES.find((p) => p.id === id)?.label ?? id;

const action = options.revert ? "delete test posts" : "create test posts";
console.log(`pilot anonymous test post: ${action}`);
console.log(`mode: ${options.execute ? "execute" : "dry-run"}`);
console.log(`api_url: ${options.apiUrl}`);
console.log(`admin_as_user_id: ${options.adminAsUserId}`);
console.log(`target_communities: ${targetCommunities.length}`);
console.log("");

let created = 0;
let deleted = 0;
let failed = 0;

for (const communityId of targetCommunities) {
  const label = `${communityId} ${pilotLabel(communityId)}`;
  const idempotencyKey = `pilot-anon-test-${communityId.replace(/^cmt_/, "")}`;

  if (options.revert) {
    const postId = `pst_${communityId.replace(/^cmt_/, "")}`;
    console.log(`${options.execute ? "  -> " : "DRY "} ${label} delete post ${postId}`);
    if (!options.execute) continue;

    const response = await fetch(`${options.apiUrl}/posts/${postId}`, {
      method: "DELETE",
      headers: {
        "x-admin-token": adminToken,
        "x-admin-as-user-id": options.adminAsUserId,
      },
    });
    if (response.ok || response.status === 404) {
      deleted += 1;
      console.log(`  ok ${label} ${response.status === 404 ? "already_deleted" : "deleted"}`);
    } else {
      failed += 1;
      const body = await response.text().catch(() => "");
      console.log(`FAIL ${label} ${response.status} ${body.slice(0, 200)}`);
    }
    continue;
  }

  console.log(`${options.execute ? "  -> " : "DRY "} ${label} idempotency_key=${idempotencyKey}`);
  if (!options.execute) continue;

  const response = await fetch(`${options.apiUrl}/communities/${communityId}/posts`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-admin-token": adminToken,
      "x-admin-as-user-id": options.adminAsUserId,
    },
    body: JSON.stringify({
      post_type: "text",
      identity_mode: "anonymous",
      anonymous_scope: "thread_stable",
      title: "Pilot anonymous thread-stable test",
      body: "This is a pilot test post to verify anonymous thread-stable posting is working correctly for country board communities.",
      idempotency_key: idempotencyKey,
    }),
  });

  if (response.ok || response.status === 201 || response.status === 202) {
    created += 1;
    const body = await response.json().catch(() => null) as Record<string, unknown> | null;
    const postId = String(body?.["id"] ?? body?.["post_id"] ?? "unknown");
    const identityMode = String(body?.["identity_mode"] ?? "unknown");
    const anonymousLabel = String(body?.["anonymous_label"] ?? "unknown");
    const status = String(body?.["status"] ?? "unknown");
    console.log(`  ok ${label} post_id=${postId} identity_mode=${identityMode} anonymous_label=${anonymousLabel} status=${status}`);
  } else {
    failed += 1;
    const body = await response.text().catch(() => "");
    console.log(`FAIL ${label} ${response.status} ${body.slice(0, 300)}`);
  }
}

console.log("");
console.log(`pilot anonymous test post ${action} complete`);
if (options.revert) {
  console.log(`deleted: ${deleted}`);
} else {
  console.log(`created: ${created}`);
}
console.log(`failed: ${failed}`);

process.exit(failed > 0 ? 1 : 0);