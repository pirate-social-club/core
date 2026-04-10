#!/usr/bin/env bun

import fs from "node:fs/promises";
import path from "node:path";
import {
  assertNoModuleLinkage,
  bundleLitActionSource,
  findCriticalExpectedPlaceholders,
  parseOptionalPositiveInt,
  sourceByteLength
} from "./_lib/action-source.mjs";
import {
  DEFAULT_BASE_URL,
  asNonEmpty,
  createAccount,
  createUsageKey,
  ensureAction,
  ensureActionInGroup,
  ensureExclusivePkpInGroup,
  ensureGroup,
  ensurePkpInGroup,
  getLitActionCid,
  maybe,
  toCanonicalIpfsUri,
  waitForActionInGroup
} from "./_lib/lit-api.mjs";
import { getFamily, loadLitFamilies } from "./_lib/config.mjs";

function parseArgs(argv) {
  const args = {};
  const flags = new Set();
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2).trim();
    const value = (argv[index + 1] || "").trim();
    if (!key) continue;
    if (!value || value.startsWith("--")) {
      flags.add(key);
      continue;
    }
    args[key] = value;
    index += 1;
  }
  return { args, flags };
}

async function main() {
  const { args, flags } = parseArgs(process.argv.slice(2));
  const env = process.env;

  const filePath = path.resolve(asNonEmpty(args.file, "file"));
  const familyName = maybe(args.family);
  const pkpAddressOverride = maybe(args["pkp-address"]);
  const baseUrl = (maybe(args["base-url"]) || maybe(env.LIT_CHIPOTLE_API_BASE_URL) || DEFAULT_BASE_URL).replace(/\/+$/, "");
  const createAccountName = maybe(args["create-account-name"]);
  let accountApiKey = maybe(args["account-key"]) || maybe(env.LIT_CHIPOTLE_ACCOUNT_API_KEY) || maybe(env.LIT_ACCOUNT_API_KEY);
  let createdAccount = null;

  const shouldBundle = !flags.has("no-bundle");
  const allowPlaceholders = flags.has("allow-placeholders");
  const skipUsageKey = flags.has("skip-usage-key");
  const pruneOtherPkps = flags.has("prune-other-pkps");
  const maxBytes = parseOptionalPositiveInt(args["max-bytes"], "max-bytes");

  const rawSource = (await fs.readFile(filePath, "utf8")).replace(/\r\n/g, "\n");
  if (!rawSource.trim()) {
    throw new Error("Lit Action source file is empty");
  }

  const placeholderFields = findCriticalExpectedPlaceholders(rawSource);
  if (!allowPlaceholders && placeholderFields.length > 0) {
    throw new Error(
      `Lit Action source still has placeholder EXPECTED values (${placeholderFields.join(", ")}); stamp it with real constants first`
    );
  }

  let sourceCode = rawSource;
  let sourceBytes = sourceByteLength(rawSource);
  if (shouldBundle) {
    const bundled = await bundleLitActionSource(filePath, maxBytes);
    sourceCode = bundled.sourceCode;
    sourceBytes = bundled.sourceBytes;
  } else {
    assertNoModuleLinkage(sourceCode, "raw (--no-bundle)");
    if (maxBytes != null && sourceBytes > maxBytes) {
      throw new Error(`raw Lit Action exceeds max-bytes (${sourceBytes} > ${maxBytes})`);
    }
  }

  let defaultGroupName = null;
  let family = null;
  if (familyName) {
    family = getFamily(loadLitFamilies(), familyName, "dev");
    defaultGroupName = family.executeGroup;
  }

  const groupName = maybe(args["group-name"]) || defaultGroupName || "story-operator-aeneid-v1";
  const groupDescription = maybe(args["group-description"]) || `Lit Actions for ${groupName}`;
  const actionName = maybe(args["action-name"]) || path.basename(filePath).replace(/\.[^.]+$/, "");
  const actionDescription = maybe(args.description) || `Managed by scripts/lit/lit-action-sync.mjs for ${actionName}`;
  const usageKeyName = maybe(args["usage-key-name"]) || `${groupName}-${actionName}-usage`;
  const usageKeyDescription = maybe(args["usage-key-description"]) || `Execute ${actionName} in Lit group ${groupName}`;

  const cid = await getLitActionCid(baseUrl, sourceCode);
  if (!accountApiKey) {
    if (!createAccountName) {
      throw new Error("Missing Lit account API key: set --account-key, LIT_CHIPOTLE_ACCOUNT_API_KEY, or pass --create-account-name");
    }
    createdAccount = await createAccount(baseUrl, createAccountName);
    accountApiKey = createdAccount.apiKey;
  }

  const group = await ensureGroup({
    baseUrl,
    accountApiKey,
    groupName,
    groupDescription
  });
  const action = await ensureAction({
    baseUrl,
    accountApiKey,
    actionName,
    actionDescription,
    actionCid: cid
  });
  const binding = await ensureActionInGroup({
    baseUrl,
    accountApiKey,
    groupId: group.id,
    actionCid: cid,
    actionHash: action.actionHash
  });
  await waitForActionInGroup({
    baseUrl,
    accountApiKey,
    groupId: group.id,
    actionHash: action.actionHash
  });

  let pkpBinding = null;
  const pkpAddress = pkpAddressOverride || (family?.pkpAddress && family.pkpAddress !== "TBD" ? family.pkpAddress : null);
  if (pkpAddress) {
    pkpBinding = pruneOtherPkps
      ? await ensureExclusivePkpInGroup({
          baseUrl,
          accountApiKey,
          groupId: group.id,
          pkpAddress
        })
      : await ensurePkpInGroup({
          baseUrl,
          accountApiKey,
          groupId: group.id,
          pkpAddress
        });
  }

  let usageApiKey = null;
  if (!skipUsageKey) {
    usageApiKey = await createUsageKey({
      baseUrl,
      accountApiKey,
      name: usageKeyName,
      description: usageKeyDescription,
      groupId: group.id
    });
  }

  console.log(
    JSON.stringify(
      {
        baseUrl,
        account: createdAccount
          ? {
              created: true,
              walletAddress: createdAccount.walletAddress,
              apiKey: accountApiKey
            }
          : {
              created: false,
              walletAddress: null,
              apiKey: accountApiKey
            },
        group: {
          id: group.id,
          name: groupName,
          description: groupDescription,
          created: group.created
        },
        pkp: pkpAddress
          ? {
              family: familyName || null,
              address: pkpAddress,
              addedToGroup: Boolean(pkpBinding?.added),
              removedFromGroup: Array.isArray(pkpBinding?.removed) ? pkpBinding.removed : []
            }
          : null,
        action: {
          name: actionName,
          description: actionDescription,
          filePath,
          bundled: shouldBundle,
          sourceBytes,
          cid,
          ref: toCanonicalIpfsUri(cid),
          cidHash: action.actionHash,
          created: action.created,
          addedToGroup: binding.added
        },
        usageKey: skipUsageKey
          ? null
          : {
              name: usageKeyName,
              description: usageKeyDescription,
              value: usageApiKey,
              executeInGroups: [group.id]
            }
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[lit-action-sync] ${message}`);
  process.exit(1);
});
