type InspectResult = {
  root_label: string;
  zone_name: string;
  challenge_name: string;
  zone_exists: boolean;
  challenge_present: boolean;
  root_exists: boolean | null;
  root_control_verified: boolean | null;
  expiry_root_exists: boolean | null;
  expiry_horizon_sufficient: boolean | null;
  expiry_height: number | null;
  expiry_anchor_height: number | null;
  expiry_anchor_block_hash: string | null;
  expiry_anchor_median_time: number | null;
  expiry_chain_network: string | null;
  expiry_blocks_remaining: number | null;
  expiry_horizon_blocks: number | null;
  expiry_observation_provider: string | null;
  routing_enabled: boolean | null;
  pirate_dns_authority_verified: boolean | null;
  control_class: "single_holder_root" | "multisig_controlled_root" | "dao_controlled_root" | "burned_or_immutable_root" | null;
  operation_class: "owner_managed_namespace" | "routing_only_namespace" | "pirate_delegated_namespace" | "owner_signed_updates_namespace" | null;
  nameservers: string[];
  observation_provider: string;
  failure_reason: string | null;
  rrsets?: {
    name: string;
    type: string;
    ttl: number | null;
    records: string[];
  }[];
};

type ExpiryEvidence = Pick<
  InspectResult,
  | "expiry_root_exists"
  | "expiry_horizon_sufficient"
  | "expiry_height"
  | "expiry_anchor_height"
  | "expiry_anchor_block_hash"
  | "expiry_anchor_median_time"
  | "expiry_chain_network"
  | "expiry_blocks_remaining"
  | "expiry_horizon_blocks"
  | "expiry_observation_provider"
>;

import { Resolver } from "node:dns/promises";
import { PowerDnsApiClient, type PowerDnsZoneSnapshot } from "./pdns-store";
import { parseDaneEeAssociations } from "./tlsa";
import { json, requireBearerAuth } from "../../shared/http";
import { isCanonicalHnsRootLabel } from "../../../hns/root-label";

const verifierHost = Bun.env.HNS_VERIFIER_HOST?.trim() || "127.0.0.1";
const verifierPort = Number(Bun.env.HNS_VERIFIER_PORT || "4048");
const verifierAuthToken = Bun.env.HNS_VERIFIER_AUTH_TOKEN?.trim() || null;

const pdnsApiUrl = Bun.env.PDNS_API_URL?.trim() || "http://127.0.0.1:8081";
const pdnsApiKey = Bun.env.PDNS_API_KEY?.trim() || null;
const defaultSoaContent = Bun.env.PDNS_DEFAULT_SOA_CONTENT?.trim() || "ns1.pirate. dns.pirate. 0 3600 900 1209600 300";
const DELEGATED_OBSERVATION_PROVIDER = "powerdns_api";

const defaultNameservers = parseCsv(Bun.env.HNS_AUTHORITATIVE_NAMESERVERS) ?? ["ns1.pirate."];
const defaultTtl = Number(Bun.env.HNS_AUTHORITATIVE_TTL || "300");
const defaultApexIpv4 = Bun.env.HNS_AUTHORITATIVE_APEX_IPV4?.trim() || null;
const defaultNameserverIpv4 = Bun.env.HNS_AUTHORITATIVE_NAMESERVER_IPV4?.trim() || defaultApexIpv4;
const defaultProfileIpv4 = Bun.env.HNS_AUTHORITATIVE_PROFILE_IPV4?.trim() || defaultApexIpv4;
const defaultWildcardIpv4 = Bun.env.HNS_AUTHORITATIVE_WILDCARD_IPV4?.trim() || defaultApexIpv4;
const defaultTlsaAssociations = parseDaneEeAssociations(Bun.env.HNS_AUTHORITATIVE_TLSA_ASSOCIATIONS);
const defaultTlsaTtl = parseTlsaTtl(Bun.env.HNS_AUTHORITATIVE_TLSA_TTL, defaultTtl);
const defaultSecureNewZones = Bun.env.PDNS_SECURE_NEW_ZONES?.trim().toLowerCase() === "true";
const OWNER_MANAGED_OBSERVATION_PROVIDER = "hns_parent_chain";
const ownerManagedResolverTimeoutMs = Number(Bun.env.HNS_OWNER_MANAGED_RESOLVER_TIMEOUT_MS || "2500");
const defaultHnsRootResourceUrlTemplate = "https://shakeshift.com/name/{root}/resources?fetch=main";
const HNS_CHAIN_OBSERVATION_PROVIDER = "hsd_json_rpc";
const HNS_CHAIN_MIN_VERIFICATION_PROGRESS = 0.999;
const HNS_CHAIN_MAX_FUTURE_BLOCK_SECONDS = 2 * 60 * 60;

function parseCsv(value: string | undefined): string[] | null {
  const entries = value?.split(",").map((entry) => entry.trim()).filter(Boolean) ?? [];
  return entries.length > 0 ? entries.map(withTrailingDot) : null;
}

function parseTlsaTtl(value: string | undefined, fallback: number): number {
  const ttl = Number(value ?? fallback);
  if (!Number.isSafeInteger(ttl) || ttl < 60 || ttl > 86_400) {
    throw new Error("HNS_AUTHORITATIVE_TLSA_TTL must be an integer between 60 and 86400 seconds");
  }
  return ttl;
}

function withTrailingDot(value: string): string {
  return value.endsWith(".") ? value : `${value}.`;
}

function toStorageName(value: string): string {
  return value.replace(/\.$/, "");
}

function parseResolverCsv(value: string | undefined): string[] {
  return value?.split(",").map((entry) => entry.trim()).filter(Boolean) ?? [];
}

function getOwnerManagedResolvers(): string[] {
  return parseResolverCsv(Bun.env.HNS_OWNER_MANAGED_RESOLVERS);
}

function isOwnerManagedResolverConfigured(): boolean {
  return getOwnerManagedResolvers().length > 0;
}

function isOwnerManagedRootResourceConfigured(): boolean {
  return getHnsRootResourceUrlTemplate().length > 0;
}

function getHnsRootResourceUrlTemplate(): string {
  return Bun.env.HNS_ROOT_RESOURCE_URL_TEMPLATE?.trim() ?? defaultHnsRootResourceUrlTemplate;
}

function getHnsRootResourceTimeoutMs(): number {
  return Number(Bun.env.HNS_ROOT_RESOURCE_TIMEOUT_MS || "4000");
}

function getHnsChainRpcUrl(): string | null {
  return Bun.env.HNS_CHAIN_RPC_URL?.trim().replace(/\/+$/, "") || null;
}

function getHnsChainRpcApiKey(): string | null {
  return Bun.env.HNS_CHAIN_RPC_API_KEY?.trim() || null;
}

function getHnsChainRpcTimeoutMs(): number {
  return Number(Bun.env.HNS_CHAIN_RPC_TIMEOUT_MS || "4000");
}

function getHnsExpiryHorizonBlocks(): number | null {
  const raw = Bun.env.HNS_EXPIRY_HORIZON_BLOCKS?.trim();
  if (!raw) {
    return null;
  }

  const value = Number(raw);
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function getHnsChainMaxTipAgeSeconds(): number | null {
  const raw = Bun.env.HNS_CHAIN_MAX_TIP_AGE_SECONDS?.trim();
  if (!raw) {
    return null;
  }

  const value = Number(raw);
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function unknownExpiryEvidence(
  provider: string | null = null,
  rootExists: boolean | null = null,
): ExpiryEvidence {
  return {
    expiry_root_exists: rootExists,
    expiry_horizon_sufficient: null,
    expiry_height: null,
    expiry_anchor_height: null,
    expiry_anchor_block_hash: null,
    expiry_anchor_median_time: null,
    expiry_chain_network: null,
    expiry_blocks_remaining: null,
    expiry_horizon_blocks: getHnsExpiryHorizonBlocks(),
    expiry_observation_provider: provider,
  };
}

function requirePowerDnsStore(): PowerDnsApiClient {
  if (!pdnsApiKey) {
    throw new Error("PDNS_API_KEY is not configured");
  }
  return new PowerDnsApiClient({
    apiUrl: pdnsApiUrl,
    apiKey: pdnsApiKey,
    defaultSoaContent,
    zoneKind: Bun.env.PDNS_ZONE_KIND?.trim() === "Native" ? "Native" : "Master",
    axfrTsigKeyName: Bun.env.PDNS_AXFR_TSIG_KEY_NAME?.trim() || null,
    secureNewZones: defaultSecureNewZones,
  });
}

class InvalidHnsRootLabelError extends Error {}

function verifierErrorStatus(error: unknown, fallback: number): number {
  return error instanceof InvalidHnsRootLabelError ? 400 : fallback;
}

function normalizeRootLabel(value: string): string {
  const trimmed = value.trim().normalize("NFKC").toLowerCase().replace(/\/+$/, "");
  const normalized = normalizeIdnaRootLabel(trimmed);
  if (!isCanonicalHnsRootLabel(normalized)) {
    throw new InvalidHnsRootLabelError("root_label must be a single Handshake TLD label");
  }
  return normalized;
}

function normalizeIdnaRootLabel(value: string): string {
  if (!value || value.includes(".") || /^[\x00-\x7F]+$/u.test(value)) {
    return value;
  }

  try {
    const hostname = new URL(`http://${value}.invalid`).hostname;
    return hostname.endsWith(".invalid")
      ? hostname.slice(0, -".invalid".length)
      : value;
  } catch {
    return value;
  }
}

function normalizeZoneName(rootLabel: string): string {
  return `${normalizeRootLabel(rootLabel)}.`;
}

function normalizeChallengeName(rootLabel: string, challengeHost?: string | null): string {
  const normalizedRoot = normalizeRootLabel(rootLabel);
  const value = (challengeHost?.trim() || "_pirate").replace(/\.$/, "").toLowerCase();

  if (value === "_pirate") {
    return `_pirate.${normalizedRoot}.`;
  }

  if (value === `_pirate.${normalizedRoot}`) {
    return `${value}.`;
  }

  if (value.endsWith(`.${normalizedRoot}`)) {
    return `${value}.`;
  }

  throw new Error("challenge_host must be _pirate or a name within the delegated root");
}

function escapeTxtRecord(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, "\\\"")}"`;
}

function normalizeTxtRecordContent(value: string): string {
  const trimmed = value.trim();
  if (trimmed.startsWith("\"") && trimmed.endsWith("\"")) {
    return trimmed.slice(1, -1).replace(/\\"/g, "\"").replace(/\\\\/g, "\\");
  }
  return trimmed;
}

function normalizeNsRecord(value: string): string {
  return withTrailingDot(value.trim().toLowerCase());
}

function matchesDefaultNameserver(value: string): boolean {
  const normalized = normalizeNsRecord(value);
  return defaultNameservers.map(normalizeNsRecord).includes(normalized);
}

function createOwnerManagedResolver(): Resolver | null {
  const resolvers = getOwnerManagedResolvers();
  if (resolvers.length === 0) {
    return null;
  }

  const resolver = new Resolver();
  resolver.setServers(resolvers);
  return resolver;
}

async function withOwnerManagedResolverTimeout<T>(operation: Promise<T>): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;

  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error("owner-managed resolver query timed out")),
          ownerManagedResolverTimeoutMs,
        );
      }),
    ]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}

async function resolveOwnerManagedNs(rootLabel: string): Promise<string[]> {
  const resolver = createOwnerManagedResolver();
  if (!resolver) {
    return [];
  }

  const zoneName = normalizeZoneName(rootLabel);
  try {
    return (await withOwnerManagedResolverTimeout(resolver.resolveNs(zoneName)))
      .map(normalizeNsRecord)
      .filter(Boolean);
  } catch {
    return [];
  }
}

async function resolveOwnerManagedTxt(name: string): Promise<string[]> {
  const resolver = createOwnerManagedResolver();
  if (!resolver) {
    return [];
  }

  try {
    return (await withOwnerManagedResolverTimeout(resolver.resolveTxt(withTrailingDot(name))))
      .map((chunks) => chunks.join(""))
      .map(normalizeTxtRecordContent)
      .filter(Boolean);
  } catch {
    return [];
  }
}

async function withRootResourceTimeout<T>(operation: Promise<T>): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;

  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error("HNS root resource query timed out")),
          getHnsRootResourceTimeoutMs(),
        );
      }),
    ]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}

async function callHnsChainRpc(method: string, params: unknown[] = []): Promise<unknown> {
  const rpcUrl = getHnsChainRpcUrl();
  if (!rpcUrl) {
    throw new Error("HNS_CHAIN_RPC_URL is not configured");
  }

  const apiKey = getHnsChainRpcApiKey();
  const response = await fetch(rpcUrl, {
    method: "POST",
    signal: AbortSignal.timeout(getHnsChainRpcTimeoutMs()),
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      authorization: `Basic ${Buffer.from(`x:${apiKey ?? ""}`).toString("base64")}`,
    },
    body: JSON.stringify({ method, params }),
  });

  if (!response.ok) {
    throw new Error(`HNS chain RPC ${method} failed with status ${response.status}`);
  }

  const payload = await response.json() as {
    result?: unknown;
    error?: unknown;
  };
  if (payload.error != null || !("result" in payload)) {
    throw new Error(`HNS chain RPC ${method} returned an error`);
  }
  return payload.result;
}

function readSafeInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) ? value : null;
}

type HnsRootLeaseObservation = "active" | "unsafe" | "unknown";

function classifyHnsRootLease(nameEnvelope: Record<string, unknown>): HnsRootLeaseObservation {
  if (nameEnvelope.info == null) {
    return "unsafe";
  }

  if (typeof nameEnvelope.info !== "object") {
    return "unknown";
  }

  const nameInfo = nameEnvelope.info as Record<string, unknown>;
  const state = typeof nameInfo.state === "string" ? nameInfo.state.toUpperCase() : null;
  const registered = typeof nameInfo.registered === "boolean" ? nameInfo.registered : null;
  if (nameInfo.expired === true) {
    return "unsafe";
  }

  switch (state) {
    case "CLOSED":
      return registered === true ? "active" : registered === false ? "unsafe" : "unknown";
    case "OPENING":
    case "BIDDING":
    case "REVEAL":
      return registered === false ? "unsafe" : "unknown";
    case "REVOKED":
      return "unsafe";
    case "LOCKED":
    default:
      return "unknown";
  }
}

async function inspectExpiryHorizon(rootLabel: string): Promise<ExpiryEvidence> {
  const rpcUrl = getHnsChainRpcUrl();
  const rpcApiKey = getHnsChainRpcApiKey();
  const horizonBlocks = getHnsExpiryHorizonBlocks();
  const maxTipAgeSeconds = getHnsChainMaxTipAgeSeconds();
  if (!rpcUrl || !rpcApiKey || horizonBlocks == null || maxTipAgeSeconds == null) {
    return unknownExpiryEvidence();
  }

  try {
    const [nameResult, chainResult] = await Promise.all([
      callHnsChainRpc("getnameinfo", [normalizeRootLabel(rootLabel)]),
      callHnsChainRpc("getblockchaininfo"),
    ]);
    const nameEnvelope = typeof nameResult === "object" && nameResult != null
      && "info" in nameResult
      ? nameResult as Record<string, unknown>
      : null;
    const nameInfo = nameEnvelope
      && typeof nameEnvelope.info === "object" && nameEnvelope.info != null
      ? nameEnvelope.info as Record<string, unknown>
      : null;
    const stats = nameInfo && typeof nameInfo.stats === "object" && nameInfo.stats != null
      ? nameInfo.stats as Record<string, unknown>
      : null;
    const chainInfo = typeof chainResult === "object" && chainResult != null
      ? chainResult as Record<string, unknown>
      : null;
    const expiryHeight = readSafeInteger(stats?.renewalPeriodEnd);
    const reportedBlocksRemaining = readSafeInteger(stats?.blocksUntilExpire);
    const anchorHeight = readSafeInteger(chainInfo?.blocks);
    const headerHeight = readSafeInteger(chainInfo?.headers);
    const anchorMedianTime = readSafeInteger(chainInfo?.mediantime);
    const verificationProgress = typeof chainInfo?.verificationprogress === "number"
      && Number.isFinite(chainInfo.verificationprogress)
      ? chainInfo.verificationprogress
      : null;
    const chainNetwork = typeof chainInfo?.chain === "string" ? chainInfo.chain : null;
    const expectedNetwork = Bun.env.HNS_CHAIN_NETWORK?.trim() || "main";
    const anchorBlockHash = typeof chainInfo?.bestblockhash === "string"
      && /^[0-9a-f]{64}$/i.test(chainInfo.bestblockhash)
      ? chainInfo.bestblockhash.toLowerCase()
      : null;

    if (!anchorBlockHash) {
      return unknownExpiryEvidence(HNS_CHAIN_OBSERVATION_PROVIDER);
    }

    const headerResult = await callHnsChainRpc("getblockheader", [anchorBlockHash, true]);
    const blockHeader = typeof headerResult === "object" && headerResult != null
      ? headerResult as Record<string, unknown>
      : null;
    const blockHeaderHash = typeof blockHeader?.hash === "string"
      ? blockHeader.hash.toLowerCase()
      : null;
    const blockHeaderHeight = readSafeInteger(blockHeader?.height);
    const blockHeaderTime = readSafeInteger(blockHeader?.time);
    const blockHeaderMedianTime = readSafeInteger(blockHeader?.mediantime);
    const blockHeaderConfirmations = readSafeInteger(blockHeader?.confirmations);

    const tipAgeSeconds = blockHeaderTime == null
      ? null
      : Math.floor(Date.now() / 1000) - blockHeaderTime;
    const blocksRemaining = expiryHeight != null && anchorHeight != null
      ? expiryHeight - anchorHeight
      : null;
    const chainAnchorInvalid = anchorHeight == null
      || headerHeight !== anchorHeight
      || anchorMedianTime == null
      || verificationProgress == null
      || verificationProgress < HNS_CHAIN_MIN_VERIFICATION_PROGRESS
      || blockHeaderHash !== anchorBlockHash
      || blockHeaderHeight !== anchorHeight
      || blockHeaderMedianTime !== anchorMedianTime
      || blockHeaderConfirmations == null
      || blockHeaderConfirmations < 1
      || tipAgeSeconds == null
      || tipAgeSeconds < -HNS_CHAIN_MAX_FUTURE_BLOCK_SECONDS
      || tipAgeSeconds > maxTipAgeSeconds
      || chainNetwork !== expectedNetwork;
    if (chainAnchorInvalid) {
      return unknownExpiryEvidence(HNS_CHAIN_OBSERVATION_PROVIDER);
    }

    const chainAnchorEvidence = {
      expiry_anchor_height: anchorHeight,
      expiry_anchor_block_hash: anchorBlockHash,
      expiry_anchor_median_time: anchorMedianTime,
      expiry_chain_network: chainNetwork,
    };
    if (!nameEnvelope) {
      return {
        ...unknownExpiryEvidence(HNS_CHAIN_OBSERVATION_PROVIDER),
        ...chainAnchorEvidence,
      };
    }

    const leaseObservation = classifyHnsRootLease(nameEnvelope);
    if (leaseObservation === "unsafe") {
      return {
        ...unknownExpiryEvidence(HNS_CHAIN_OBSERVATION_PROVIDER, false),
        ...chainAnchorEvidence,
        expiry_horizon_sufficient: false,
      };
    }

    if (leaseObservation === "unknown") {
      return {
        ...unknownExpiryEvidence(HNS_CHAIN_OBSERVATION_PROVIDER),
        ...chainAnchorEvidence,
      };
    }

    if (
      expiryHeight == null
      || blocksRemaining == null
      || reportedBlocksRemaining == null
      || Math.abs(reportedBlocksRemaining - blocksRemaining) > 1
    ) {
      return {
        ...unknownExpiryEvidence(HNS_CHAIN_OBSERVATION_PROVIDER, true),
        ...chainAnchorEvidence,
      };
    }

    return {
      expiry_root_exists: true,
      expiry_horizon_sufficient: blocksRemaining >= horizonBlocks,
      expiry_height: expiryHeight,
      expiry_anchor_height: anchorHeight,
      expiry_anchor_block_hash: anchorBlockHash,
      expiry_anchor_median_time: anchorMedianTime,
      expiry_chain_network: chainNetwork,
      expiry_blocks_remaining: blocksRemaining,
      expiry_horizon_blocks: horizonBlocks,
      expiry_observation_provider: HNS_CHAIN_OBSERVATION_PROVIDER,
    };
  } catch {
    return unknownExpiryEvidence(HNS_CHAIN_OBSERVATION_PROVIDER);
  }
}

function readDnsNameFromResource(buffer: Buffer, offset: number): { name: string; offset: number } {
  const labels: string[] = [];
  let cursor = offset;

  while (cursor < buffer.length) {
    const length = buffer[cursor];
    cursor += 1;
    if (length === 0) {
      return { name: `${labels.join(".")}.`, offset: cursor };
    }

    if (cursor + length > buffer.length) {
      throw new Error("invalid HNS resource name");
    }

    labels.push(buffer.subarray(cursor, cursor + length).toString("ascii"));
    cursor += length;
  }

  throw new Error("unterminated HNS resource name");
}

function decodeHnsResourceHex(rawHex: string): { nameservers: string[]; txtValues: string[] } {
  const buffer = Buffer.from(rawHex, "hex");
  const nameservers: string[] = [];
  const txtValues: string[] = [];
  let offset = buffer[0] === 0 ? 1 : 0;

  while (offset < buffer.length) {
    const type = buffer[offset];
    offset += 1;

    if (type === 1) {
      const decoded = readDnsNameFromResource(buffer, offset);
      nameservers.push(normalizeNsRecord(decoded.name));
      offset = decoded.offset;
      continue;
    }

    if (type === 6) {
      const chunkCount = buffer[offset] ?? 0;
      offset += 1;
      const chunks: string[] = [];

      for (let index = 0; index < chunkCount; index += 1) {
        const length = buffer[offset];
        offset += 1;
        if (offset + length > buffer.length) {
          throw new Error("invalid HNS TXT resource");
        }
        chunks.push(buffer.subarray(offset, offset + length).toString("utf8"));
        offset += length;
      }

      txtValues.push(normalizeTxtRecordContent(chunks.join("")));
      continue;
    }

    if (type === 0) {
      offset += 5 + (buffer[offset + 4] ?? 0);
      continue;
    }

    if (type === 2) {
      const decoded = readDnsNameFromResource(buffer, offset);
      offset = decoded.offset + 4;
      continue;
    }

    throw new Error(`unsupported HNS resource record type ${type}`);
  }

  return {
    nameservers: nameservers.filter(Boolean),
    txtValues: txtValues.filter(Boolean),
  };
}

function extractLiveResourceHexFromExplorerPayload(payload: unknown): string | null {
  const html = Array.isArray(payload) && typeof payload[2] === "object" && payload[2] != null
    && "html" in payload[2] && typeof payload[2].html === "string"
    ? payload[2].html
    : null;
  if (!html) {
    return null;
  }

  const liveResourceMatch = html.match(/<strong class="highlight-green">Live<\/strong>[\s\S]*?<div class="tab-raw">([0-9a-f]+)<\/div>/i);
  return liveResourceMatch?.[1] ?? null;
}

async function fetchOwnerManagedRootResource(rootLabel: string): Promise<{
  nameservers: string[];
  txtValues: string[];
} | null> {
  const normalizedRoot = normalizeRootLabel(rootLabel);
  const urlTemplate = getHnsRootResourceUrlTemplate();
  if (!urlTemplate) {
    return null;
  }
  const url = urlTemplate.replace("{root}", encodeURIComponent(normalizedRoot));

  try {
    const response = await withRootResourceTimeout(fetch(url, {
      headers: { accept: "application/json" },
    }));
    if (!response.ok) {
      return null;
    }

    const payload = await response.json();
    const rawHex = extractLiveResourceHexFromExplorerPayload(payload);
    return rawHex ? decodeHnsResourceHex(rawHex) : null;
  } catch {
    return null;
  }
}

function summarizeZone(zone: PowerDnsZoneSnapshot): InspectResult["rrsets"] {
  return zone.rrsets.map((rrset) => ({
    name: withTrailingDot(rrset.name),
    type: rrset.type,
    ttl: rrset.ttl ?? null,
    records: rrset.type === "NS"
      ? rrset.records.map((record) => withTrailingDot(record))
      : rrset.records,
  }));
}

function deriveInspectionFields(zoneExists: boolean) {
  if (!zoneExists) {
    return {
      root_exists: null,
      root_control_verified: null,
      ...unknownExpiryEvidence(),
      routing_enabled: null,
      pirate_dns_authority_verified: false,
      control_class: null,
      operation_class: null,
    };
  }

  return {
    root_exists: true,
    root_control_verified: null,
    ...unknownExpiryEvidence(),
    routing_enabled: true,
    pirate_dns_authority_verified: true,
    control_class: "single_holder_root" as const,
    operation_class: "pirate_delegated_namespace" as const,
  };
}

async function inspectRoot(rootLabel: string, challengeHost?: string | null): Promise<InspectResult> {
  if (isOwnerManagedRootResourceConfigured()) {
    return inspectOwnerManagedRoot(rootLabel, challengeHost);
  }

  const store = requirePowerDnsStore();
  const zoneName = normalizeZoneName(rootLabel);
  const challengeName = normalizeChallengeName(rootLabel, challengeHost);
  const zone = await store.getZoneByName(zoneName);

  if (!zone) {
    return {
      root_label: normalizeRootLabel(rootLabel),
      zone_name: zoneName,
      challenge_name: challengeName,
      zone_exists: false,
      challenge_present: false,
      nameservers: defaultNameservers,
      observation_provider: DELEGATED_OBSERVATION_PROVIDER,
      failure_reason: "zone_not_provisioned",
      rrsets: [],
      ...deriveInspectionFields(false),
    };
  }

  const challengePresent = zone.rrsets.some((rrset) => rrset.type === "TXT" && rrset.name === toStorageName(challengeName));

  return {
    root_label: normalizeRootLabel(rootLabel),
    zone_name: zoneName,
    challenge_name: challengeName,
    zone_exists: true,
    challenge_present: challengePresent,
    nameservers: zone.nameservers.length > 0 ? zone.nameservers.map(withTrailingDot) : defaultNameservers,
    observation_provider: DELEGATED_OBSERVATION_PROVIDER,
    failure_reason: challengePresent ? null : "challenge_not_published",
    rrsets: summarizeZone(zone),
    ...deriveInspectionFields(true),
  };
}

async function inspectOwnerManagedRoot(rootLabel: string, challengeHost?: string | null): Promise<InspectResult> {
  const normalizedRoot = normalizeRootLabel(rootLabel);
  const zoneName = normalizeZoneName(normalizedRoot);
  const challengeName = zoneName;
  const [rootResource, expiryEvidence] = await Promise.all([
    fetchOwnerManagedRootResource(normalizedRoot),
    inspectExpiryHorizon(normalizedRoot),
  ]);
  const nameservers = rootResource?.nameservers ?? [];
  const observedTxtValues = rootResource?.txtValues ?? [];
  const rootExists = expiryEvidence.expiry_root_exists ?? (rootResource != null ? true : null);
  const pirateDnsAuthorityVerified = nameservers.some(matchesDefaultNameserver);
  const challengePresent = observedTxtValues.length > 0;

  return {
    root_label: normalizedRoot,
    zone_name: zoneName,
    challenge_name: challengeName,
    zone_exists: rootResource != null,
    challenge_present: challengePresent,
    nameservers: nameservers.length > 0 ? nameservers : defaultNameservers,
    observation_provider: OWNER_MANAGED_OBSERVATION_PROVIDER,
    failure_reason: rootResource != null
      ? challengePresent ? null : "challenge_not_published"
      : "root_resource_unavailable",
    rrsets: [
      ...(nameservers.length > 0 ? [{
        name: zoneName,
        type: "NS",
        ttl: null,
        records: nameservers,
      }] : []),
      ...(observedTxtValues.length > 0 ? [{
        name: zoneName,
        type: "TXT",
        ttl: null,
        records: observedTxtValues,
      }] : []),
    ],
    root_exists: rootExists,
    root_control_verified: challengePresent,
    ...expiryEvidence,
    routing_enabled: pirateDnsAuthorityVerified,
    pirate_dns_authority_verified: pirateDnsAuthorityVerified,
    control_class: rootExists === true ? "single_holder_root" : null,
    operation_class: rootExists === true ? "owner_managed_namespace" : null,
  };
}

async function publishTxt(body: {
  root_label?: string | null;
  challenge_host?: string | null;
  challenge_txt_value?: string | null;
  apex_ipv4?: string | null;
  profile_ipv4?: string | null;
  wildcard_ipv4?: string | null;
  nameservers?: string[] | null;
}) {
  const rootLabel = body.root_label?.trim();
  const challengeTxtValue = body.challenge_txt_value?.trim();

  if (!rootLabel || !challengeTxtValue) {
    return json({ error: "root_label and challenge_txt_value are required" }, { status: 400 });
  }

  const store = requirePowerDnsStore();
  const normalizedRoot = normalizeRootLabel(rootLabel);
  const zoneName = normalizeZoneName(normalizedRoot);
  const challengeName = normalizeChallengeName(normalizedRoot, body.challenge_host);
  const nameservers = body.nameservers?.map(withTrailingDot) ?? defaultNameservers;

  // Publish the challenge in the same API write as the managed zone rrsets so
  // observers never see the zone without its challenge.
  const ensured = await store.ensureZone({
    zoneName,
    nameservers,
    nameserverIpv4: defaultNameserverIpv4,
    apexIpv4: body.apex_ipv4?.trim() || defaultApexIpv4,
    profileIpv4: body.profile_ipv4?.trim() || defaultProfileIpv4,
    wildcardIpv4: body.wildcard_ipv4?.trim() || defaultWildcardIpv4,
    ttl: defaultTtl,
    tlsaAssociations: defaultTlsaAssociations,
    tlsaTtl: defaultTlsaTtl,
    extraRrsets: [{
      name: challengeName,
      type: "TXT",
      ttl: defaultTtl,
      records: [escapeTxtRecord(challengeTxtValue)],
    }],
  });
  const zone = ensured.zone;

  return json({
    root_label: normalizedRoot,
    zone_name: zoneName,
    challenge_name: challengeName,
    challenge_txt_value: challengeTxtValue,
    zone_created: ensured.created,
    nameservers,
    observation_provider: DELEGATED_OBSERVATION_PROVIDER,
    dnssec: zone.dnssec,
    ds_records: ensured.dsRecords,
    rrsets: summarizeZone(zone),
  });
}

async function ensureZone(body: {
  root_label?: string | null;
  apex_ipv4?: string | null;
  profile_ipv4?: string | null;
  wildcard_ipv4?: string | null;
  nameservers?: string[] | null;
}) {
  const rootLabel = body.root_label?.trim();
  if (!rootLabel) {
    return json({ error: "root_label is required" }, { status: 400 });
  }

  const store = requirePowerDnsStore();
  const normalizedRoot = normalizeRootLabel(rootLabel);
  const zoneName = normalizeZoneName(normalizedRoot);
  const nameservers = body.nameservers?.map(withTrailingDot) ?? defaultNameservers;

  const ensured = await store.ensureZone({
    zoneName,
    nameservers,
    nameserverIpv4: defaultNameserverIpv4,
    apexIpv4: body.apex_ipv4?.trim() || defaultApexIpv4,
    profileIpv4: body.profile_ipv4?.trim() || defaultProfileIpv4,
    wildcardIpv4: body.wildcard_ipv4?.trim() || defaultWildcardIpv4,
    ttl: defaultTtl,
    tlsaAssociations: defaultTlsaAssociations,
    tlsaTtl: defaultTlsaTtl,
  });

  return json({
    root_label: normalizedRoot,
    zone_name: zoneName,
    zone_created: ensured.created,
    nameservers,
    observation_provider: DELEGATED_OBSERVATION_PROVIDER,
    dnssec: ensured.zone.dnssec,
    ds_records: ensured.dsRecords,
    rrsets: summarizeZone(ensured.zone),
  });
}

async function verifyTxt(body: {
  root_label?: string | null;
  challenge_host?: string | null;
  challenge_txt_value?: string | null;
}) {
  const rootLabel = body.root_label?.trim();
  const challengeTxtValue = body.challenge_txt_value?.trim();

  if (!rootLabel || !challengeTxtValue) {
    return json({ error: "root_label and challenge_txt_value are required" }, { status: 400 });
  }

  // Ownership must come from evidence the owner published: the Handshake
  // parent root resource (Pirate-managed path) or the owner's own
  // authoritative DNS (owner-managed path). Pirate's own zones are NEVER an
  // ownership source — reading back a record Pirate wrote proves nothing
  // about the requesting user. See specs/domain/hns-authoritative-dns.md,
  // "Verification Assertions".
  if (isOwnerManagedRootResourceConfigured()) {
    const parentChain = await verifyParentChainTxt({
      root_label: rootLabel,
      challenge_txt_value: challengeTxtValue,
    });
    if (parentChain.verified || !isOwnerManagedResolverConfigured()) {
      return json(parentChain);
    }
    const ownerDns = await verifyOwnerDnsTxt({
      root_label: rootLabel,
      challenge_host: body.challenge_host,
      challenge_txt_value: challengeTxtValue,
    });
    return json(ownerDns.verified ? ownerDns : parentChain);
  }

  if (isOwnerManagedResolverConfigured()) {
    return json(await verifyOwnerDnsTxt({
      root_label: rootLabel,
      challenge_host: body.challenge_host,
      challenge_txt_value: challengeTxtValue,
    }));
  }

  return json({
    verified: false,
    observation_provider: null,
    ownership_source: null,
    failure_reason: "ownership_observation_unavailable",
    root_exists: null,
    root_control_verified: false,
    ...unknownExpiryEvidence(),
    routing_enabled: null,
    pirate_dns_authority_verified: null,
    control_class: null,
    operation_class: null,
  }, { status: 503 });
}

// Assertion-3 health check: after ownership + delegation pass and the child
// zone is provisioned, confirm the zone exists in the authoritative backend
// and (when health resolvers are configured) that _pirate.<root> is actually
// served. Never ownership evidence.
async function authorityHealth(rootLabel: string, challengeHost?: string | null) {
  const store = requirePowerDnsStore();
  const normalizedRoot = normalizeRootLabel(rootLabel);
  const zoneName = normalizeZoneName(normalizedRoot);
  const challengeName = normalizeChallengeName(normalizedRoot, challengeHost);
  const zone = await store.getZoneByName(zoneName);

  const challengeRrset = zone?.rrsets.find(
    (entry) => entry.name === toStorageName(challengeName) && entry.type === "TXT",
  ) ?? null;

  let challengeServed: boolean | null = null;
  const healthResolvers = parseResolverCsv(Bun.env.HNS_AUTHORITY_HEALTH_RESOLVERS);
  if (zone && healthResolvers.length > 0) {
    const resolver = new Resolver();
    resolver.setServers(healthResolvers);
    try {
      const served = (await withOwnerManagedResolverTimeout(resolver.resolveTxt(challengeName)))
        .map((chunks) => chunks.join(""))
        .map(normalizeTxtRecordContent);
      challengeServed = challengeRrset != null
        && challengeRrset.records.map(normalizeTxtRecordContent).every((value) => served.includes(value));
    } catch {
      challengeServed = false;
    }
  }

  return json({
    root_label: normalizedRoot,
    zone_name: zoneName,
    challenge_name: challengeName,
    zone_provisioned: zone != null,
    challenge_present: challengeRrset != null,
    challenge_served: challengeServed,
    nameservers: zone?.nameservers.map(withTrailingDot) ?? [],
    observation_provider: DELEGATED_OBSERVATION_PROVIDER,
  });
}

async function verifyParentChainTxt(body: {
  root_label: string;
  challenge_txt_value: string;
}) {
  const normalizedRoot = normalizeRootLabel(body.root_label);
  const zoneName = normalizeZoneName(normalizedRoot);
  const [rootResource, expiryEvidence] = await Promise.all([
    fetchOwnerManagedRootResource(normalizedRoot),
    inspectExpiryHorizon(normalizedRoot),
  ]);
  const nameservers = rootResource?.nameservers ?? [];
  const observedValues = rootResource?.txtValues ?? [];
  const rootExists = expiryEvidence.expiry_root_exists ?? (rootResource != null ? true : null);
  const pirateDnsAuthorityVerified = nameservers.some(matchesDefaultNameserver);
  const verified = observedValues.includes(body.challenge_txt_value);

  return {
    verified,
    observation_provider: OWNER_MANAGED_OBSERVATION_PROVIDER,
    ownership_source: verified ? "hns_parent_chain_txt" : null,
    failure_reason: verified
      ? null
      : rootResource == null
        ? "root_resource_unavailable"
        : observedValues.length === 0
          ? "challenge_not_published"
        : "challenge_mismatch",
    observed_values: observedValues,
    root_exists: rootExists,
    root_control_verified: verified,
    ...expiryEvidence,
    routing_enabled: pirateDnsAuthorityVerified,
    pirate_dns_authority_verified: pirateDnsAuthorityVerified,
    control_class: rootExists === true ? "single_holder_root" as const : null,
    operation_class: rootExists === true
      ? (pirateDnsAuthorityVerified ? "pirate_delegated_namespace" as const : "owner_managed_namespace" as const)
      : null,
    root_label: normalizedRoot,
    zone_name: zoneName,
    challenge_name: zoneName,
  };
}

async function verifyOwnerDnsTxt(body: {
  root_label: string;
  challenge_host?: string | null;
  challenge_txt_value: string;
}) {
  const normalizedRoot = normalizeRootLabel(body.root_label);
  const zoneName = normalizeZoneName(normalizedRoot);
  const challengeName = normalizeChallengeName(normalizedRoot, body.challenge_host);
  // Ownership comes from the owner's OWN authoritative DNS. Root existence and
  // expiry are on-chain facts, so they must still come from the parent chain —
  // DNS cannot attest to them, and leaving expiry unknown would silently
  // withhold club attachment from every owner-managed root.
  const [observedValues, nameservers, rootResource, expiryEvidence] = await Promise.all([
    resolveOwnerManagedTxt(challengeName),
    resolveOwnerManagedNs(normalizedRoot),
    isOwnerManagedRootResourceConfigured()
      ? fetchOwnerManagedRootResource(normalizedRoot)
      : Promise.resolve(null),
    inspectExpiryHorizon(normalizedRoot),
  ]);
  const verified = observedValues.includes(body.challenge_txt_value);
  const pirateDnsAuthorityVerified = nameservers.some(matchesDefaultNameserver);
  const rootExists = expiryEvidence.expiry_root_exists
    ?? (rootResource != null ? true : null);

  return {
    verified,
    observation_provider: "owner_authoritative_dns",
    ownership_source: verified ? "owner_authoritative_dns_txt" : null,
    failure_reason: verified
      ? null
      : observedValues.length === 0
        ? "challenge_not_published"
        : "challenge_mismatch",
    observed_values: observedValues,
    root_exists: rootExists,
    root_control_verified: verified,
    ...expiryEvidence,
    routing_enabled: pirateDnsAuthorityVerified,
    pirate_dns_authority_verified: pirateDnsAuthorityVerified,
    control_class: verified && rootExists === true ? "single_holder_root" as const : null,
    operation_class: verified && rootExists === true ? "owner_managed_namespace" as const : null,
    root_label: normalizedRoot,
    zone_name: zoneName,
    challenge_name: challengeName,
  };
}

export async function handleRequest(request: Request) {
    const url = new URL(request.url);
    const authResponse = requireBearerAuth(request, verifierAuthToken);
    if (authResponse) {
      return authResponse;
    }

    if (url.pathname === "/health") {
      return json({
        ok: true,
        bind_host: verifierHost,
        bind_port: verifierPort,
        pdns_api_url: pdnsApiUrl,
        observation_provider: isOwnerManagedRootResourceConfigured() ? OWNER_MANAGED_OBSERVATION_PROVIDER : DELEGATED_OBSERVATION_PROVIDER,
        owner_managed_resolvers: getOwnerManagedResolvers(),
        owner_managed_resolver_timeout_ms: ownerManagedResolverTimeoutMs,
        hns_root_resource_url_template: getHnsRootResourceUrlTemplate(),
        hns_root_resource_timeout_ms: getHnsRootResourceTimeoutMs(),
        authoritative_secure_new_zones: defaultSecureNewZones,
        authoritative_tlsa_associations: defaultTlsaAssociations,
        authoritative_tlsa_ttl: defaultTlsaTtl,
        requires_bearer_auth: verifierAuthToken != null,
      });
    }

    if (url.pathname === "/" || url.pathname === "/inspect" || url.pathname === "/inspect-public") {
      if (request.method !== "GET") {
        return new Response("Method Not Allowed", { status: 405 });
      }

      try {
        const rootLabel = url.searchParams.get("root_label");
        if (!rootLabel) {
          return json({ error: "root_label is required" }, { status: 400 });
        }
        return json(await inspectRoot(rootLabel, url.searchParams.get("challenge_host")));
      } catch (error) {
        return json({
          error: error instanceof Error ? error.message : "inspect failed",
        }, { status: verifierErrorStatus(error, 500) });
      }
    }

    if (url.pathname === "/authority-health") {
      const rootLabel = url.searchParams.get("root_label");
      if (!rootLabel?.trim()) {
        return json({ error: "root_label is required" }, { status: 400 });
      }
      try {
        return await authorityHealth(rootLabel, url.searchParams.get("challenge_host"));
      } catch (error) {
        return json(
          { error: error instanceof Error ? error.message : "authority health check failed" },
          { status: verifierErrorStatus(error, 502) },
        );
      }
    }

    if (url.pathname === "/publish-txt") {
      if (request.method !== "POST") {
        return new Response("Method Not Allowed", { status: 405 });
      }

      try {
        const body = await request.json() as Parameters<typeof publishTxt>[0];
        return await publishTxt(body);
      } catch (error) {
        return json({
          error: error instanceof Error ? error.message : "publish failed",
        }, { status: verifierErrorStatus(error, 500) });
      }
    }

    if (url.pathname === "/ensure-zone") {
      if (request.method !== "POST") {
        return new Response("Method Not Allowed", { status: 405 });
      }

      try {
        const body = await request.json() as Parameters<typeof ensureZone>[0];
        return await ensureZone(body);
      } catch (error) {
        return json({
          error: error instanceof Error ? error.message : "zone ensure failed",
        }, { status: verifierErrorStatus(error, 500) });
      }
    }

    if (url.pathname === "/verify-txt" || url.pathname === "/verify-txt-public") {
      if (request.method !== "POST") {
        return new Response("Method Not Allowed", { status: 405 });
      }

      try {
        const body = await request.json() as Parameters<typeof verifyTxt>[0];
        return await verifyTxt(body);
      } catch (error) {
        return json({
          error: error instanceof Error ? error.message : "TXT verification failed",
        }, { status: verifierErrorStatus(error, 500) });
      }
    }

    return new Response("Not Found", { status: 404 });
}

if (import.meta.main) {
  Bun.serve({
    hostname: verifierHost,
    port: verifierPort,
    fetch(request) {
      return handleRequest(request);
    },
  });

  console.log(`HNS verifier listening on http://${verifierHost}:${verifierPort}`);
}
