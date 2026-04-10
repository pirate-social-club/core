import type { WalletAttachmentRow } from "../types/db";
import type { Env } from "../types/env";

const DEFAULT_ALCHEMY_TIMEOUT_MS = 8_000;
const DEFAULT_ALCHEMY_MAX_PAGES = 10;
const CAIP2_EVM_PATTERN = /^eip155:\d+$/;
const EVM_ADDRESS_PATTERN = /^0x[a-fA-F0-9]{40}$/;

type FetchLike = (input: URL | RequestInfo, init?: RequestInit) => Promise<Response>;

type AlchemyOwnedNft = {
  contract?: {
    address?: string;
  };
  tokenId?: string;
  name?: string | null;
  description?: string | null;
  raw?: {
    metadata?: {
      attributes?: Array<{
        trait_type?: string | null;
        value?: string | number | boolean | null;
      }> | null;
      [key: string]: unknown;
    } | null;
  } | null;
};

type AlchemyGetNftsForOwnerResponse = {
  ownedNfts?: AlchemyOwnedNft[];
  pageKey?: string;
};

export type Erc721MetadataAttributeMatch = {
  trait_type: string;
  value: string;
};

export type Erc721GateConfig =
  | {
      standard: "erc721";
      mode: "contract_any";
      chain_namespace: string;
      contract_address: string;
    }
  | {
      standard: "erc721";
      mode: "token_id_allowlist";
      chain_namespace: string;
      contract_address: string;
      token_ids: string[];
    }
  | {
      standard: "erc721";
      mode: "metadata_match";
      chain_namespace: string;
      contract_address: string;
      text_terms?: string[];
      attributes?: Erc721MetadataAttributeMatch[];
    };

export type CommunityGateEvaluationResult = {
  status: "passed" | "failed" | "unavailable";
  reason: string;
  matched_wallet_attachment_id?: string;
  matched_wallet_address?: string;
  matched_token_id?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeAddress(value: string): string {
  return value.toLowerCase();
}

function normalizeTokenId(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new Error("token IDs must not be empty");
  }

  try {
    return BigInt(trimmed).toString(10);
  } catch {
    throw new Error(`Invalid token ID: ${value}`);
  }
}

function normalizeText(value: unknown): string {
  if (value == null) {
    return "";
  }

  return String(value).trim().toLowerCase();
}

function assertCaip2EvmChainNamespace(value: unknown, fieldName: string): string {
  if (typeof value !== "string" || !CAIP2_EVM_PATTERN.test(value)) {
    throw new Error(`${fieldName} must be a CAIP-2 EVM namespace like eip155:1`);
  }

  return value;
}

function assertEvmAddress(value: unknown, fieldName: string): string {
  if (typeof value !== "string" || !EVM_ADDRESS_PATTERN.test(value)) {
    throw new Error(`${fieldName} must be a checksummed or lowercase EVM address`);
  }

  return normalizeAddress(value);
}

function assertStringArray(value: unknown, fieldName: string): string[] {
  if (!Array.isArray(value) || value.length === 0 || value.some((item) => typeof item !== "string")) {
    throw new Error(`${fieldName} must be a non-empty string array`);
  }

  return value.map((item) => item.trim()).filter((item) => item.length > 0);
}

export function parseErc721GateConfig(raw: unknown): Erc721GateConfig {
  if (!isRecord(raw)) {
    throw new Error("gate_config must be an object");
  }

  const standard = raw.standard;
  if (standard !== "erc721") {
    throw new Error("gate_config.standard must equal erc721");
  }

  const mode = raw.mode;
  const chainNamespace = assertCaip2EvmChainNamespace(raw.chain_namespace, "gate_config.chain_namespace");
  const contractAddress = assertEvmAddress(raw.contract_address, "gate_config.contract_address");

  if (mode === "contract_any") {
    return {
      standard,
      mode,
      chain_namespace: chainNamespace,
      contract_address: contractAddress,
    };
  }

  if (mode === "token_id_allowlist") {
    return {
      standard,
      mode,
      chain_namespace: chainNamespace,
      contract_address: contractAddress,
      token_ids: assertStringArray(raw.token_ids, "gate_config.token_ids").map(normalizeTokenId),
    };
  }

  if (mode === "metadata_match") {
    const textTerms = raw.text_terms == null ? [] : assertStringArray(raw.text_terms, "gate_config.text_terms");
    const attributes = raw.attributes;
    if (attributes != null && (!Array.isArray(attributes) || attributes.some((entry) => !isRecord(entry)))) {
      throw new Error("gate_config.attributes must be an array of { trait_type, value } objects");
    }

    const normalizedAttributes =
      attributes?.map((entry) => {
        const traitType = entry.trait_type;
        const value = entry.value;
        if (typeof traitType !== "string" || typeof value !== "string") {
          throw new Error("gate_config.attributes entries must contain string trait_type and value fields");
        }

        return {
          trait_type: traitType.trim(),
          value: value.trim(),
        };
      }) ?? [];

    if (textTerms.length === 0 && normalizedAttributes.length === 0) {
      throw new Error("metadata_match requires at least one text_terms or attributes matcher");
    }

    return {
      standard,
      mode,
      chain_namespace: chainNamespace,
      contract_address: contractAddress,
      text_terms: textTerms,
      attributes: normalizedAttributes,
    };
  }

  throw new Error("gate_config.mode must be contract_any, token_id_allowlist, or metadata_match");
}

function getAlchemyRpcUrlFromJsonMap(env: Env, chainNamespace: string): string | null {
  if (!env.ALCHEMY_EVM_RPC_URLS_JSON) {
    return null;
  }

  try {
    const parsed = JSON.parse(env.ALCHEMY_EVM_RPC_URLS_JSON) as Record<string, unknown>;
    const value = parsed[chainNamespace];
    return typeof value === "string" && value.length > 0 ? value : null;
  } catch {
    console.warn("Invalid ALCHEMY_EVM_RPC_URLS_JSON; falling back to per-chain env vars");
    return null;
  }
}

function getAlchemyRpcUrl(env: Env, chainNamespace: string): string | null {
  const mapped = getAlchemyRpcUrlFromJsonMap(env, chainNamespace);
  if (mapped) {
    return mapped;
  }

  switch (chainNamespace) {
    case "eip155:1":
      return env.ALCHEMY_ETH_MAINNET_RPC_URL ?? null;
    case "eip155:8453":
      return env.ALCHEMY_BASE_MAINNET_RPC_URL ?? null;
    case "eip155:84532":
      return env.ALCHEMY_BASE_SEPOLIA_RPC_URL ?? null;
    default:
      return null;
  }
}

function buildAlchemyGetNftsForOwnerUrl(rpcUrl: string, owner: string, contractAddress: string, pageKey?: string): URL {
  const parsed = new URL(rpcUrl);
  const [, version, apiKey] = parsed.pathname.split("/");
  if (version !== "v2" || !apiKey) {
    throw new Error("Alchemy RPC URL must use the /v2/<apiKey> shape");
  }

  parsed.pathname = `/nft/v3/${apiKey}/getNFTsForOwner`;
  parsed.search = "";
  parsed.searchParams.set("owner", owner);
  parsed.searchParams.set("withMetadata", "true");
  parsed.searchParams.append("contractAddresses[]", contractAddress);
  parsed.searchParams.set("pageSize", "100");
  if (pageKey) {
    parsed.searchParams.set("pageKey", pageKey);
  }

  return parsed;
}

async function fetchOwnedNftsForWallet(input: {
  env: Env;
  chainNamespace: string;
  walletAddress: string;
  contractAddress: string;
  stopWhen?: (ownedNfts: AlchemyOwnedNft[]) => boolean;
  fetchImpl?: FetchLike;
}): Promise<{ status: "ok"; ownedNfts: AlchemyOwnedNft[] } | { status: "unavailable"; reason: string }> {
  const rpcUrl = getAlchemyRpcUrl(input.env, input.chainNamespace);
  if (!rpcUrl) {
    return {
      status: "unavailable",
      reason: `No Alchemy RPC URL is configured for ${input.chainNamespace}`,
    };
  }

  const ownedNfts: AlchemyOwnedNft[] = [];
  let pageKey: string | undefined;
  const timeoutMs = Number.parseInt(input.env.COMMUNITY_GATE_ALCHEMY_TIMEOUT_MS ?? "", 10) || DEFAULT_ALCHEMY_TIMEOUT_MS;
  const maxPages = DEFAULT_ALCHEMY_MAX_PAGES;
  const fetchImpl = input.fetchImpl ?? fetch;
  let pagesFetched = 0;

  for (;;) {
    if (pagesFetched >= maxPages) {
      return {
        status: "unavailable",
        reason: `Alchemy ownership lookup exceeded ${maxPages} pages`,
      };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const url = buildAlchemyGetNftsForOwnerUrl(
        rpcUrl,
        input.walletAddress,
        input.contractAddress,
        pageKey,
      );
      const response = await fetchImpl(url, {
        headers: {
          accept: "application/json",
        },
        signal: controller.signal,
      });

      if (!response.ok) {
        return {
          status: "unavailable",
          reason: `Alchemy returned ${response.status} while evaluating wallet ownership`,
        };
      }

      const payload = (await response.json()) as AlchemyGetNftsForOwnerResponse;
      const pageOwnedNfts = payload.ownedNfts ?? [];
      pagesFetched += 1;
      ownedNfts.push(...pageOwnedNfts);
      if (input.stopWhen?.(pageOwnedNfts)) {
        return {
          status: "ok",
          ownedNfts,
        };
      }

      if (!payload.pageKey) {
        return {
          status: "ok",
          ownedNfts,
        };
      }

      pageKey = payload.pageKey;
    } catch (error) {
      return {
        status: "unavailable",
        reason:
          error instanceof Error && error.name === "AbortError"
            ? `Alchemy ownership lookup timed out after ${timeoutMs}ms`
            : "Alchemy ownership lookup failed",
      };
    } finally {
      clearTimeout(timer);
    }
  }
}

function nftMatchesMetadataRule(nft: AlchemyOwnedNft, gateConfig: Extract<Erc721GateConfig, { mode: "metadata_match" }>): boolean {
  const attributes = nft.raw?.metadata?.attributes ?? [];
  // This is intentionally approximate substring matching across serialized metadata values.
  const haystack = JSON.stringify({
    name: nft.name ?? null,
    description: nft.description ?? null,
    metadata: nft.raw?.metadata ?? null,
  }).toLowerCase();

  const textTerms = gateConfig.text_terms ?? [];
  const matchesTextTerms = textTerms.every((term) => haystack.includes(normalizeText(term)));

  const matchesAttributes = (gateConfig.attributes ?? []).every((requiredAttribute) =>
    attributes.some((attribute) => {
      const traitType = normalizeText(attribute.trait_type);
      const value = normalizeText(attribute.value);
      return (
        traitType === normalizeText(requiredAttribute.trait_type) &&
        value === normalizeText(requiredAttribute.value)
      );
    }),
  );

  return matchesTextTerms && matchesAttributes;
}

function evaluateOwnedNftsAgainstGate(
  ownedNfts: AlchemyOwnedNft[],
  gateConfig: Erc721GateConfig,
): { matched: true; tokenId?: string } | { matched: false } {
  if (gateConfig.mode === "contract_any") {
    return ownedNfts.length > 0 ? { matched: true, tokenId: ownedNfts[0]?.tokenId } : { matched: false };
  }

  if (gateConfig.mode === "token_id_allowlist") {
    const allowlist = new Set(gateConfig.token_ids.map(normalizeTokenId));
    const matched = ownedNfts.find((nft) => nft.tokenId && allowlist.has(normalizeTokenId(nft.tokenId)));
    return matched ? { matched: true, tokenId: matched.tokenId } : { matched: false };
  }

  const matched = ownedNfts.find((nft) => nftMatchesMetadataRule(nft, gateConfig));
  return matched ? { matched: true, tokenId: matched.tokenId } : { matched: false };
}

function pageMaySatisfyGate(ownedNfts: AlchemyOwnedNft[], gateConfig: Erc721GateConfig): boolean {
  return evaluateOwnedNftsAgainstGate(ownedNfts, gateConfig).matched;
}

export async function evaluateErc721GateForWalletAttachments(input: {
  env: Env;
  walletAttachments: WalletAttachmentRow[];
  rawGateConfig: unknown;
  fetchImpl?: FetchLike;
}): Promise<CommunityGateEvaluationResult> {
  let gateConfig: Erc721GateConfig;
  try {
    gateConfig = parseErc721GateConfig(input.rawGateConfig);
  } catch (error) {
    return {
      status: "unavailable",
      reason: error instanceof Error ? error.message : "Invalid ERC-721 gate config",
    };
  }

  const eligibleWallets = input.walletAttachments.filter(
    (wallet) => wallet.status === "active" && wallet.chain_namespace === gateConfig.chain_namespace,
  );
  if (eligibleWallets.length === 0) {
    return {
      status: "failed",
      reason: `No active wallet attachment is available for ${gateConfig.chain_namespace}`,
    };
  }

  for (const wallet of eligibleWallets) {
    const lookup = await fetchOwnedNftsForWallet({
      env: input.env,
      chainNamespace: gateConfig.chain_namespace,
      walletAddress: wallet.wallet_address_normalized,
      contractAddress: gateConfig.contract_address,
      stopWhen: (pageOwnedNfts) => pageMaySatisfyGate(pageOwnedNfts, gateConfig),
      fetchImpl: input.fetchImpl,
    });
    if (lookup.status === "unavailable") {
      return {
        status: "unavailable",
        reason: lookup.reason,
      };
    }

    const evaluation = evaluateOwnedNftsAgainstGate(lookup.ownedNfts, gateConfig);
    if (evaluation.matched) {
      return {
        status: "passed",
        reason: "A linked wallet satisfies the ERC-721 gate",
        matched_wallet_attachment_id: wallet.wallet_attachment_id,
        matched_wallet_address: wallet.wallet_address_display,
        matched_token_id: evaluation.tokenId,
      };
    }
  }

  return {
    status: "failed",
    reason: "No linked wallet satisfies the ERC-721 gate",
  };
}
