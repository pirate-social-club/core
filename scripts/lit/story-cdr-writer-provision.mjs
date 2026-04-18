#!/usr/bin/env bun

import path from "node:path";
import { bundleLitActionSource } from "./_lib/action-source.mjs";

async function loadHelpers() {
  const config = await import("./_lib/config.mjs");
  const api = await import("./_lib/lit-api.mjs");
  return {
    getFamily: config.getFamily,
    loadLitFamilies: config.loadLitFamilies,
    repoRoot: config.repoRoot,
    DEFAULT_BASE_URL: api.DEFAULT_BASE_URL,
    asNonEmpty: api.asNonEmpty,
    createWallet: api.createWallet,
    createUsageKey: api.createUsageKey,
    ensureAction: api.ensureAction,
    ensureActionInGroup: api.ensureActionInGroup,
    ensureGroup: api.ensureGroup,
    ensurePkpInGroup: api.ensurePkpInGroup,
    getLitActionCid: api.getLitActionCid,
    litApiRequest: api.litApiRequest,
    maybe: api.maybe,
    waitForActionInGroup: api.waitForActionInGroup,
  };
}

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2).trim();
    const value = (argv[index + 1] || "").trim();
    if (!key || !value || value.startsWith("--")) continue;
    args[key] = value;
    index += 1;
  }
  return args;
}

async function main() {
  const {
    DEFAULT_BASE_URL,
    asNonEmpty,
    createWallet,
    createUsageKey,
    ensureAction,
    ensureActionInGroup,
    ensureGroup,
    ensurePkpInGroup,
    getFamily,
    getLitActionCid,
    litApiRequest,
    loadLitFamilies,
    maybe,
    repoRoot,
    waitForActionInGroup,
  } = await loadHelpers();

  const args = parseArgs(process.argv.slice(2));
  const envName = maybe(args.env) || "dev";
  const familyName = maybe(args.family) || "story-cdr-writer";
  const accountApiKey = maybe(args["account-key"]) || maybe(process.env.LIT_CHIPOTLE_ACCOUNT_API_KEY);
  if (!accountApiKey) {
    throw new Error("Missing Lit account API key: set --account-key or LIT_CHIPOTLE_ACCOUNT_API_KEY");
  }
  const baseUrl = (maybe(args["base-url"]) || maybe(process.env.LIT_CHIPOTLE_API_BASE_URL) || DEFAULT_BASE_URL).replace(/\/+$/, "");

  const families = loadLitFamilies();
  const family = getFamily(families, familyName, envName);
  const group = await ensureGroup({
    baseUrl,
    accountApiKey,
    groupName: family.executeGroup,
    groupDescription: `Lit Actions for ${family.executeGroup}`,
  });

  const explicitPkpAddress = maybe(args["pkp-address"]);
  const wallet = explicitPkpAddress ? null : await createWallet(baseUrl, accountApiKey);
  const pkpAddress = explicitPkpAddress || asNonEmpty(
    wallet?.wallet_address || wallet?.walletAddress || wallet?.pkp_address || wallet?.pkpAddress || wallet?.id,
    "wallet address",
  );
  await ensurePkpInGroup({
    baseUrl,
    accountApiKey,
    groupId: group.id,
    pkpAddress,
  });

  const usageKeyName = maybe(args["usage-key-name"]) || `${family.executeGroup}-bootstrap-usage`;
  const usageKeyDescription = maybe(args["usage-key-description"]) || `Bootstrap ${familyName} in ${family.executeGroup}`;
  const usageApiKey = await createUsageKey({
    baseUrl,
    accountApiKey,
    name: usageKeyName,
    description: usageKeyDescription,
    groupId: group.id,
  });

  const probeFile = path.resolve(repoRoot, "lit-actions/probes/get-public-key.js");
  const { sourceCode } = await bundleLitActionSource(probeFile, undefined);
  const probeCid = await getLitActionCid(baseUrl, sourceCode);
  const probeAction = await ensureAction({
    baseUrl,
    accountApiKey,
    actionName: "probe-get-public-key",
    actionDescription: `Managed by story-cdr-writer-provision for ${familyName}`,
    actionCid: probeCid,
  });
  await ensureActionInGroup({
    baseUrl,
    accountApiKey,
    groupId: group.id,
    actionCid: probeCid,
    actionHash: probeAction.actionHash,
  });
  await waitForActionInGroup({
    baseUrl,
    accountApiKey,
    groupId: group.id,
    actionHash: probeAction.actionHash,
  });
  const execution = await litApiRequest({
    baseUrl,
    path: "/core/v1/lit_action",
    method: "POST",
    apiKey: usageApiKey,
    body: {
      code: sourceCode,
      js_params: { pkpId: pkpAddress },
      jsParams: { pkpId: pkpAddress },
    },
  });
  const parsed = typeof execution.response === "string" ? JSON.parse(execution.response) : execution.response;
  if (!parsed || parsed.ok !== true || !parsed.publicKey) {
    throw new Error(`lit_probe_invalid_response:${JSON.stringify(execution).slice(0, 1000)}`);
  }

  console.log(
    JSON.stringify(
      {
        family: familyName,
        env: envName,
        baseUrl,
        executeGroup: family.executeGroup,
        groupId: group.id,
        pkpAddress,
        pkpPublicKey: String(parsed.publicKey),
        usageKeyEnvVar: family.usageKeyEnvVar,
        usageApiKey,
        walletCreated: !explicitPkpAddress,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[story-cdr-writer-provision] ${message}`);
  process.exit(1);
});
