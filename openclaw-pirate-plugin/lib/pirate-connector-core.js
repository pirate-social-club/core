import { createHash, createPrivateKey, createPublicKey, randomUUID, sign, verify } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export const DEFAULT_DISPLAY_NAME = "OpenClaw Agent";
const CONNECTION_STORE_VERSION = 1;
const POLLABLE_TERMINAL_STATUSES = new Set(["verified", "failed", "expired", "cancelled"]);

export function normalizeApiBaseUrl(value) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error("Pirate API base URL is required");
  }

  const normalized = new URL(value.trim()).toString();
  return normalized.endsWith("/") ? normalized.slice(0, -1) : normalized;
}

export function buildClawkeyChallenge(identity, input = {}) {
  if (
    !identity
    || typeof identity.deviceId !== "string"
    || typeof identity.publicKeyPem !== "string"
    || typeof identity.privateKeyPem !== "string"
  ) {
    throw new Error("OpenClaw identity is missing deviceId/publicKeyPem/privateKeyPem");
  }

  const timestamp = Number.isFinite(input.timestamp) ? Number(input.timestamp) : Date.now();
  const message = typeof input.message === "string" && input.message.trim().length > 0
    ? input.message
    : `clawkey-register-${timestamp}`;
  const publicKeyDer = createPublicKey(identity.publicKeyPem).export({ type: "spki", format: "der" });
  const signatureBytes = sign(null, Buffer.from(message, "utf8"), createPrivateKey(identity.privateKeyPem));

  return {
    device_id: identity.deviceId,
    public_key: publicKeyDer.toString("base64"),
    message,
    signature: signatureBytes.toString("base64"),
    timestamp,
  };
}

export function verifyChallengeSignature(challenge) {
  const publicKey = createPublicKey({
    key: Buffer.from(challenge.public_key, "base64"),
    type: "spki",
    format: "der",
  });

  return verify(
    null,
    Buffer.from(challenge.message, "utf8"),
    publicKey,
    Buffer.from(challenge.signature, "base64"),
  );
}

export async function callPirateJson(input) {
  const response = await input.fetchImpl(input.url, {
    method: input.method,
    headers: {
      accept: "application/json",
      ...(input.body ? { "content-type": "application/json" } : {}),
      ...(input.connectionToken ? { "x-agent-connection-token": input.connectionToken } : {}),
      ...(input.accessToken ? { authorization: `Bearer ${input.accessToken}` } : {}),
      ...(input.headers && typeof input.headers === "object" ? input.headers : {}),
    },
    body: input.body ? JSON.stringify(input.body) : undefined,
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const message = typeof payload?.message === "string"
      ? payload.message
      : `Pirate API request failed with status ${response.status}`;
    throw new Error(message);
  }

  if (!payload || typeof payload !== "object") {
    throw new Error("Pirate API response was not valid JSON");
  }

  return payload;
}

export async function claimPiratePairing(input) {
  const apiBaseUrl = normalizeApiBaseUrl(input.apiBaseUrl);
  const response = await callPirateJson({
    fetchImpl: input.fetchImpl,
    method: "POST",
    url: `${apiBaseUrl}/agent-ownership-pairing/claim`,
    body: {
      pairing_code: input.pairingCode,
      display_name: input.displayName ?? DEFAULT_DISPLAY_NAME,
      agent_challenge: input.agentChallenge,
    },
  });

  return {
    apiBaseUrl,
    agentOwnershipSessionId: String(response.agent_ownership_session_id),
    registrationUrl: String(response.registration_url),
    connectionToken: String(response.connection_token),
  };
}

export async function completePirateOwnershipSession(input) {
  const apiBaseUrl = normalizeApiBaseUrl(input.apiBaseUrl);
  const response = await callPirateJson({
    fetchImpl: input.fetchImpl,
    method: "POST",
    url: `${apiBaseUrl}/agent-ownership-sessions/${encodeURIComponent(input.agentOwnershipSessionId)}/complete`,
    connectionToken: input.connectionToken,
    body: {},
  });

  return response;
}

export async function issuePirateDelegatedCredential(input) {
  const apiBaseUrl = normalizeApiBaseUrl(input.apiBaseUrl);
  const response = await callPirateJson({
    fetchImpl: input.fetchImpl,
    method: "POST",
    url: `${apiBaseUrl}/agents/${encodeURIComponent(input.agentId)}/credential`,
    connectionToken: input.connectionToken,
    body: {
      current_ownership_record_id: input.currentOwnershipRecordId ?? undefined,
    },
  });

  return {
    apiBaseUrl,
    agentId: String(response.agent_id),
    currentOwnershipRecordId: String(response.current_ownership_record_id),
    accessToken: String(response.access_token),
    refreshToken: String(response.refresh_token),
    expiresAt: String(response.expires_at),
    refreshExpiresAt: response.refresh_expires_at == null ? null : String(response.refresh_expires_at),
  };
}

export async function refreshPirateDelegatedCredential(input) {
  const apiBaseUrl = normalizeApiBaseUrl(input.apiBaseUrl);
  const response = await callPirateJson({
    fetchImpl: input.fetchImpl,
    method: "POST",
    url: `${apiBaseUrl}/agents/${encodeURIComponent(input.agentId)}/credential/refresh`,
    connectionToken: input.connectionToken,
    body: {
      refresh_token: input.refreshToken,
    },
  });

  return {
    apiBaseUrl,
    agentId: String(response.agent_id),
    currentOwnershipRecordId: String(response.current_ownership_record_id),
    accessToken: String(response.access_token),
    refreshToken: String(response.refresh_token),
    expiresAt: String(response.expires_at),
    refreshExpiresAt: response.refresh_expires_at == null ? null : String(response.refresh_expires_at),
  };
}

export function isTerminalOwnershipStatus(status) {
  return POLLABLE_TERMINAL_STATUSES.has(status);
}

export function sha256Hex(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function buildConnectionScopeKey(context = {}) {
  if (typeof context.agentId === "string" && context.agentId.trim()) {
    return `agent:${context.agentId.trim()}`;
  }
  if (typeof context.sessionKey === "string" && context.sessionKey.trim()) {
    return `session:${context.sessionKey.trim()}`;
  }
  if (typeof context.sessionId === "string" && context.sessionId.trim()) {
    return `session-id:${context.sessionId.trim()}`;
  }
  return "default";
}

export function resolvePluginStateFile(stateDir, pluginId) {
  return join(stateDir, "plugins", sha256Hex(pluginId).slice(0, 12), "pirate-connector-state.json");
}

function compareUtf8Ascending(left, right) {
  const leftBytes = new TextEncoder().encode(left);
  const rightBytes = new TextEncoder().encode(right);
  const length = Math.min(leftBytes.length, rightBytes.length);

  for (let index = 0; index < length; index += 1) {
    if (leftBytes[index] !== rightBytes[index]) {
      return leftBytes[index] - rightBytes[index];
    }
  }

  return leftBytes.length - rightBytes.length;
}

function normalizePath(pathname) {
  const trimmed = typeof pathname === "string" ? pathname.trim() : "";
  if (!trimmed || trimmed === "/") {
    return "/";
  }
  const withLeadingSlash = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  return withLeadingSlash.replace(/\/+$/g, "");
}

function sortJsonValue(value) {
  if (Array.isArray(value)) {
    return value.map((item) => sortJsonValue(item));
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value).sort(([left], [right]) => compareUtf8Ascending(left, right));
    return Object.fromEntries(entries.map(([key, child]) => [key, sortJsonValue(child)]));
  }
  return value;
}

export function canonicalizePirateActionRequest(input) {
  const url = new URL(input.url, "http://pirate.local");
  const method = String(input.method).trim().toUpperCase();
  const query = Array.from(url.searchParams.entries())
    .sort(([leftKey, leftValue], [rightKey, rightValue]) => {
      const keyCompare = compareUtf8Ascending(leftKey, rightKey);
      if (keyCompare !== 0) {
        return keyCompare;
      }
      return compareUtf8Ascending(leftValue, rightValue);
    })
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join("&");
  const body = input.body == null || input.body === ""
    ? ""
    : typeof input.body === "string"
      ? input.body
      : JSON.stringify(sortJsonValue(input.body));

  return [
    "pirate-agent-action-proof-v1",
    method,
    normalizePath(url.pathname),
    query,
    body,
  ].join("\n");
}

export function computePirateActionRequestHash(input) {
  return sha256Hex(canonicalizePirateActionRequest(input));
}

export function canonicalizePirateActionSignaturePayload(input) {
  return [
    "pirate-agent-action-signature-v1",
    input.nonce.trim(),
    input.signedAt.trim(),
    input.canonicalRequestHash.trim(),
  ].join("\n");
}

export function signPirateActionProof(identity, input) {
  const canonicalRequestHash = computePirateActionRequestHash({
    method: input.method,
    url: input.url,
    body: input.body,
  });
  const nonce = typeof input.nonce === "string" && input.nonce.trim() ? input.nonce.trim() : `nonce_${randomUUID()}`;
  const signedAt = typeof input.signedAt === "string" && input.signedAt.trim()
    ? input.signedAt.trim()
    : new Date().toISOString();
  const payload = canonicalizePirateActionSignaturePayload({
    nonce,
    signedAt,
    canonicalRequestHash,
  });
  const signature = sign(null, Buffer.from(payload, "utf8"), createPrivateKey(identity.privateKeyPem)).toString("base64");

  return {
    nonce,
    signed_at: signedAt,
    canonical_request_hash: canonicalRequestHash,
    signature,
  };
}

export async function loadConnectionStore(stateFile) {
  try {
    const raw = await readFile(stateFile, "utf8");
    const parsed = JSON.parse(raw);
    if (
      !parsed
      || typeof parsed !== "object"
      || parsed.version !== CONNECTION_STORE_VERSION
      || !parsed.entries
      || typeof parsed.entries !== "object"
    ) {
      return { version: CONNECTION_STORE_VERSION, current: null, entries: {} };
    }

    return {
      version: CONNECTION_STORE_VERSION,
      current: typeof parsed.current === "string" ? parsed.current : null,
      entries: parsed.entries,
    };
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return { version: CONNECTION_STORE_VERSION, current: null, entries: {} };
    }
    throw error;
  }
}

export async function saveConnectionStore(stateFile, store) {
  await mkdir(dirname(stateFile), { recursive: true });
  const tempFile = `${stateFile}.tmp`;
  await writeFile(tempFile, `${JSON.stringify(store, null, 2)}\n`, "utf8");
  await rename(tempFile, stateFile);
}

export function upsertConnectionEntry(store, input) {
  const entries = { ...store.entries };
  const existing = entries[input.scopeKey] && typeof entries[input.scopeKey] === "object"
    ? entries[input.scopeKey]
    : {};

  entries[input.scopeKey] = {
    ...existing,
    scope_key: input.scopeKey,
    api_base_url: input.apiBaseUrl,
    agent_ownership_session_id: input.agentOwnershipSessionId,
    connection_token: input.connectionToken,
    pairing_code: input.pairingCode,
    registration_url: input.registrationUrl,
    status: input.status ?? existing.status ?? "awaiting_owner",
    agent_id: input.agentId ?? existing.agent_id ?? null,
    current_ownership_record_id: input.currentOwnershipRecordId ?? existing.current_ownership_record_id ?? null,
    credential_access_token: input.credentialAccessToken ?? existing.credential_access_token ?? null,
    credential_refresh_token: input.credentialRefreshToken ?? existing.credential_refresh_token ?? null,
    credential_expires_at: input.credentialExpiresAt ?? existing.credential_expires_at ?? null,
    credential_refresh_expires_at: input.credentialRefreshExpiresAt ?? existing.credential_refresh_expires_at ?? null,
    verified_at: input.verifiedAt ?? existing.verified_at ?? null,
    updated_at: new Date().toISOString(),
  };

  return {
    version: CONNECTION_STORE_VERSION,
    current: input.scopeKey,
    entries,
  };
}

export function resolveCurrentConnection(store, scopeKey) {
  if (scopeKey && store.entries[scopeKey]) {
    return store.entries[scopeKey];
  }
  if (store.current && store.entries[store.current]) {
    return store.entries[store.current];
  }
  return null;
}
