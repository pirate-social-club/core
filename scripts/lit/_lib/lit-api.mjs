import { execFileSync } from "node:child_process";
import Hash from "ipfs-only-hash";

const DEFAULT_BASE_URL = "https://api.dev.litprotocol.com";
const DEFAULT_PAGE_SIZE = 200;
const IPFS_CID_RE = /^(Qm[1-9A-HJ-NP-Za-km-z]{44}|bafy[a-z2-7]{20,})$/;

function maybe(value) {
  const trimmed = String(value || "").trim();
  return trimmed || undefined;
}

function asNonEmpty(value, label) {
  const normalized = maybe(value);
  if (!normalized) {
    throw new Error(`${label} is required`);
  }
  return normalized;
}

function buildUrl(baseUrl, requestPath, query = {}) {
  const url = new URL(requestPath, `${baseUrl.replace(/\/+$/, "")}/`);
  for (const [key, value] of Object.entries(query)) {
    if (value == null || value === "") continue;
    url.searchParams.set(key, String(value));
  }
  return url.toString();
}

async function litApiRequest({ baseUrl, path, method = "GET", apiKey, body, query }) {
  const response = await fetch(buildUrl(baseUrl, path, query), {
    method,
    headers: {
      ...(apiKey ? { "x-api-key": apiKey } : {}),
      ...(body !== undefined ? { "content-type": "application/json" } : {})
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });

  const raw = await response.text();
  if (!response.ok) {
    throw new Error(`lit_api_http_error:${path}:${response.status}:${raw.slice(0, 500)}`);
  }

  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

async function createAccount(baseUrl, accountName) {
  const payload = await litApiRequest({
    baseUrl,
    path: "/core/v1/new_account",
    method: "POST",
    body: {
      account_name: accountName,
      account_description: `Created by scripts/lit/lit-action-sync.mjs for ${accountName}`,
      initial_balance: "0"
    }
  });

  const apiKey = maybe(payload.api_key);
  if (!apiKey) {
    throw new Error("lit_new_account_missing_api_key");
  }

  return {
    apiKey,
    walletAddress: maybe(payload.wallet_address) || null
  };
}

function extractIpfsCid(value) {
  const trimmed = String(value || "").trim();
  if (!trimmed) return null;
  const lower = trimmed.toLowerCase();

  if (lower.startsWith("ipfs://ipfs/")) {
    const cid = trimmed.slice("ipfs://ipfs/".length).trim();
    return IPFS_CID_RE.test(cid) ? cid : null;
  }
  if (lower.startsWith("ipfs://")) {
    const cid = trimmed.slice("ipfs://".length).trim();
    return IPFS_CID_RE.test(cid) ? cid : null;
  }
  if (IPFS_CID_RE.test(trimmed)) {
    return trimmed;
  }
  return null;
}

function toCanonicalIpfsUri(value) {
  const cid = extractIpfsCid(value);
  if (!cid) {
    throw new Error(`invalid_ipfs_cid:${value}`);
  }
  return `ipfs://${cid}`;
}

function hashActionCid(cid) {
  const normalizedCid = extractIpfsCid(cid);
  if (!normalizedCid) {
    throw new Error(`invalid_action_cid:${cid}`);
  }
  return execFileSync("cast", ["keccak", normalizedCid], { encoding: "utf8" }).trim();
}

async function getLitActionCid(_baseUrl, sourceCode) {
  const raw = await Hash.of(sourceCode);
  const cid = extractIpfsCid(raw);
  if (!cid) {
    throw new Error(`invalid_lit_action_cid_response:${raw}`);
  }
  return cid;
}

async function listGroups(baseUrl, accountApiKey) {
  return litApiRequest({
    baseUrl,
    path: "/core/v1/list_groups",
    apiKey: accountApiKey,
    query: { page_number: 0, page_size: DEFAULT_PAGE_SIZE }
  });
}

async function listWallets(baseUrl, accountApiKey) {
  return litApiRequest({
    baseUrl,
    path: "/core/v1/list_wallets",
    apiKey: accountApiKey,
    query: { page_number: 0, page_size: DEFAULT_PAGE_SIZE }
  });
}

async function createWallet(baseUrl, accountApiKey) {
  return litApiRequest({
    baseUrl,
    path: "/core/v1/create_wallet",
    method: "GET",
    apiKey: accountApiKey
  });
}

async function listWalletsInGroup(baseUrl, accountApiKey, groupId) {
  return litApiRequest({
    baseUrl,
    path: "/core/v1/list_wallets_in_group",
    apiKey: accountApiKey,
    query: {
      group_id: Number(groupId),
      page_number: 0,
      page_size: DEFAULT_PAGE_SIZE
    }
  });
}

function walletMatchesPkp(entry, pkpAddress) {
  const normalizedPkp = String(pkpAddress || "").trim().toLowerCase();
  const candidates = [
    entry?.wallet_address,
    entry?.walletAddress,
    entry?.pkp_address,
    entry?.pkpAddress,
    entry?.id
  ];

  return candidates.some((value) => String(value || "").trim().toLowerCase() === normalizedPkp);
}

function getWalletAddress(entry) {
  const candidates = [
    entry?.wallet_address,
    entry?.walletAddress,
    entry?.pkp_address,
    entry?.pkpAddress,
    entry?.id
  ];
  for (const value of candidates) {
    const normalized = String(value || "").trim();
    if (/^0x[a-fA-F0-9]{40}$/.test(normalized)) {
      return normalized;
    }
  }
  return null;
}

async function ensurePkpInGroup({ baseUrl, accountApiKey, groupId, pkpAddress }) {
  const wallets = await listWalletsInGroup(baseUrl, accountApiKey, groupId);
  const existing = Array.isArray(wallets) && wallets.some((entry) => walletMatchesPkp(entry, pkpAddress));
  if (existing) {
    return { added: false };
  }

  await litApiRequest({
    baseUrl,
    path: "/core/v1/add_pkp_to_group",
    method: "POST",
    apiKey: accountApiKey,
    body: {
      group_id: Number(groupId),
      pkp_id: pkpAddress
    }
  });

  const after = await listWalletsInGroup(baseUrl, accountApiKey, groupId);
  const visible = Array.isArray(after) && after.some((entry) => walletMatchesPkp(entry, pkpAddress));
  if (!visible) {
    throw new Error(`lit_pkp_group_binding_not_visible:${groupId}:${pkpAddress}`);
  }

  return { added: true };
}

async function removePkpFromGroup({ baseUrl, accountApiKey, groupId, pkpAddress }) {
  await litApiRequest({
    baseUrl,
    path: "/core/v1/remove_pkp_from_group",
    method: "POST",
    apiKey: accountApiKey,
    body: {
      group_id: Number(groupId),
      pkp_id: pkpAddress
    }
  });

  return { removed: true };
}

async function ensureExclusivePkpInGroup({ baseUrl, accountApiKey, groupId, pkpAddress }) {
  const wallets = await listWalletsInGroup(baseUrl, accountApiKey, groupId);
  const removableAddresses = (Array.isArray(wallets) ? wallets : [])
    .map((entry) => getWalletAddress(entry))
    .filter((value) => value && value.toLowerCase() !== String(pkpAddress || "").trim().toLowerCase());

  const removed = [];
  for (const walletAddress of removableAddresses) {
    await removePkpFromGroup({
      baseUrl,
      accountApiKey,
      groupId,
      pkpAddress: walletAddress
    });
    removed.push(walletAddress);
  }

  const ensured = await ensurePkpInGroup({
    baseUrl,
    accountApiKey,
    groupId,
    pkpAddress
  });

  return {
    added: ensured.added,
    removed
  };
}

async function ensureGroup({ baseUrl, accountApiKey, groupName, groupDescription }) {
  const groups = await listGroups(baseUrl, accountApiKey);
  const existing = groups.find((entry) => String(entry.name || "").trim() === groupName);
  if (existing?.id) {
    return { id: String(existing.id), created: false };
  }

  const payload = await litApiRequest({
    baseUrl,
    path: "/core/v1/add_group",
    method: "POST",
    apiKey: accountApiKey,
    body: {
      group_name: groupName,
      group_description: groupDescription,
      pkp_ids_permitted: [],
      cid_hashes_permitted: []
    }
  });

  const groupId = maybe(payload.group_id);
  if (!groupId) {
    throw new Error("lit_add_group_missing_id");
  }
  return { id: groupId, created: true };
}

async function listActions(baseUrl, apiKey, groupId = undefined) {
  return litApiRequest({
    baseUrl,
    path: "/core/v1/list_actions",
    apiKey,
    query: {
      page_number: 0,
      page_size: DEFAULT_PAGE_SIZE,
      group_id: groupId
    }
  });
}

async function ensureAction({ baseUrl, accountApiKey, actionName, actionDescription, actionCid }) {
  const actionHash = hashActionCid(actionCid);
  const existing = (await listActions(baseUrl, accountApiKey)).find(
    (entry) => String(entry.id || "").toLowerCase() === actionHash.toLowerCase()
  );

  if (!existing) {
    await litApiRequest({
      baseUrl,
      path: "/core/v1/add_action",
      method: "POST",
      apiKey: accountApiKey,
      body: {
        action_ipfs_cid: extractIpfsCid(actionCid),
        name: actionName,
        description: actionDescription
      }
    });
  }

  return { actionHash, created: !existing };
}

async function ensureActionInGroup({ baseUrl, accountApiKey, groupId, actionCid, actionHash }) {
  const existing = (await listActions(baseUrl, accountApiKey, groupId)).some(
    (entry) => String(entry.id || "").toLowerCase() === actionHash.toLowerCase()
  );

  if (!existing) {
    await litApiRequest({
      baseUrl,
      path: "/core/v1/add_action_to_group",
      method: "POST",
      apiKey: accountApiKey,
      body: {
        group_id: Number(groupId),
        action_ipfs_cid: extractIpfsCid(actionCid)
      }
    });
  }

  return { added: !existing };
}

async function waitForActionInGroup({ baseUrl, accountApiKey, groupId, actionHash }) {
  for (let attempt = 1; attempt <= 8; attempt += 1) {
    const actions = await listActions(baseUrl, accountApiKey, groupId);
    if (actions.some((entry) => String(entry.id || "").toLowerCase() === actionHash.toLowerCase())) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, attempt * 400));
  }
  throw new Error(`lit_action_group_binding_not_visible:${groupId}:${actionHash}`);
}

async function createUsageKey({ baseUrl, accountApiKey, name, description, groupId }) {
  const payload = await litApiRequest({
    baseUrl,
    path: "/core/v1/add_usage_api_key",
    method: "POST",
    apiKey: accountApiKey,
    body: {
      name,
      description,
      can_create_groups: false,
      can_delete_groups: false,
      can_create_pkps: false,
      manage_ipfs_ids_in_groups: [],
      add_pkp_to_groups: [],
      remove_pkp_from_groups: [],
      execute_in_groups: [Number(groupId)]
    }
  });

  const usageApiKey = maybe(payload.usage_api_key);
  if (!usageApiKey) {
    throw new Error("lit_add_usage_api_key_missing_value");
  }
  return usageApiKey;
}

export {
  DEFAULT_BASE_URL,
  asNonEmpty,
  createAccount,
  createWallet,
  createUsageKey,
  ensureAction,
  ensureActionInGroup,
  ensureGroup,
  ensureExclusivePkpInGroup,
  ensurePkpInGroup,
  getLitActionCid,
  hashActionCid,
  listActions,
  listWallets,
  litApiRequest,
  listWalletsInGroup,
  maybe,
  removePkpFromGroup,
  toCanonicalIpfsUri,
  waitForActionInGroup
};
