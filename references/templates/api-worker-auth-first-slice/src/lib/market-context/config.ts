import type { Env } from "../../types/env";
import type {
  ClaimCandidateType,
  MarketContextFetcher,
  MarketContextProviderKey,
} from "./types";

export type MarketContextConfig = {
  openRouterApiKey: string;
  openRouterBaseUrl: string;
  jinaApiKey: string | null;
  extractionModel: string;
  rerankModel: string;
  embeddingModel: string;
  allowedClaimTypes: ClaimCandidateType[];
  fetcher: MarketContextFetcher;
  openRouterTimeoutMs: number;
  maxResultsPerProvider: number;
  recallEnabled: boolean;
  recallTopK: number;
  minExtractionConfidence: number;
  minSemanticSimilarity: number;
  minFinalScore: number;
  minMeaningfulChars: number;
  maxTextChars: number;
  openMarketTtlSeconds: number;
  closedMarketTtlSeconds: number;
  resolvedMarketTtlSeconds: number;
  kalshiApiBaseUrl: string;
  polymarketApiBaseUrl: string;
  jinaReaderBaseUrl: string;
  firecrawlBaseUrl: string;
  firecrawlApiKey: string | null;
  defaultProviderKeys: MarketContextProviderKey[];
};

function parseNumber(raw: string | undefined, fallback: number): number {
  if (!raw) {
    return fallback;
  }

  const value = Number(raw);

  if (!Number.isFinite(value)) {
    return fallback;
  }

  return value;
}

function parseFetcher(raw: string | undefined): MarketContextFetcher {
  return raw === "firecrawl" ? "firecrawl" : "jina";
}

function parseBoolean(raw: string | undefined, fallback: boolean): boolean {
  if (!raw) {
    return fallback;
  }

  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

function parseClaimTypes(raw: string | undefined): ClaimCandidateType[] {
  const defaultClaimTypes: ClaimCandidateType[] = [
    "election",
    "sports",
    "asset_price",
    "company_milestone",
  ];

  if (!raw) {
    return defaultClaimTypes;
  }

  const allowed = new Set<ClaimCandidateType>([
    "election",
    "legislation",
    "macro",
    "company_milestone",
    "asset_price",
    "sports",
    "court_case",
    "policy",
    "other",
  ]);

  const parsed = raw
    .split(",")
    .map((value) => value.trim())
    .filter((value): value is ClaimCandidateType => allowed.has(value as ClaimCandidateType));

  return parsed.length > 0 ? parsed : defaultClaimTypes;
}

export function resolveMarketContextConfig(env: Env): MarketContextConfig {
  if (!env.OPENROUTER_API_KEY) {
    throw new Error("Missing OPENROUTER_API_KEY");
  }

  return {
    openRouterApiKey: env.OPENROUTER_API_KEY,
    openRouterBaseUrl: env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1",
    jinaApiKey: env.JINA_API_KEY ?? null,
    extractionModel: env.MARKET_CONTEXT_OPENROUTER_MODEL ?? "openai/gpt-5.4-nano",
    rerankModel: env.MARKET_CONTEXT_RERANK_MODEL ?? "google/gemini-2.5-flash-lite",
    embeddingModel: env.MARKET_CONTEXT_EMBEDDING_MODEL ?? "openai/text-embedding-3-small",
    allowedClaimTypes: parseClaimTypes(env.MARKET_CONTEXT_ALLOWED_CLAIM_TYPES),
    fetcher: parseFetcher(env.MARKET_CONTEXT_FETCHER),
    openRouterTimeoutMs: parseNumber(env.MARKET_CONTEXT_OPENROUTER_TIMEOUT_MS, 20000),
    maxResultsPerProvider: parseNumber(env.MARKET_CONTEXT_MAX_RESULTS_PER_PROVIDER, 8),
    recallEnabled: parseBoolean(env.MARKET_CONTEXT_RECALL_ENABLED, true),
    recallTopK: parseNumber(env.MARKET_CONTEXT_RECALL_TOP_K, 12),
    minExtractionConfidence: parseNumber(env.MARKET_CONTEXT_MIN_EXTRACTION_CONFIDENCE, 0.55),
    minSemanticSimilarity: parseNumber(env.MARKET_CONTEXT_MIN_SEMANTIC_SIMILARITY, 0.7),
    minFinalScore: parseNumber(env.MARKET_CONTEXT_MIN_FINAL_SCORE, 0.72),
    minMeaningfulChars: parseNumber(env.MARKET_CONTEXT_MIN_MEANINGFUL_CHARS, 500),
    maxTextChars: parseNumber(env.MARKET_CONTEXT_MAX_TEXT_CHARS, 10000),
    openMarketTtlSeconds: parseNumber(env.MARKET_CONTEXT_OPEN_MARKET_TTL_SECONDS, 900),
    closedMarketTtlSeconds: parseNumber(env.MARKET_CONTEXT_CLOSED_MARKET_TTL_SECONDS, 86400),
    resolvedMarketTtlSeconds: parseNumber(env.MARKET_CONTEXT_RESOLVED_MARKET_TTL_SECONDS, 604800),
    kalshiApiBaseUrl: env.KALSHI_API_BASE_URL ?? "https://api.elections.kalshi.com/trade-api/v2",
    polymarketApiBaseUrl: env.POLYMARKET_API_BASE_URL ?? "https://gamma-api.polymarket.com",
    jinaReaderBaseUrl: env.JINA_READER_BASE_URL ?? "https://r.jina.ai/http://",
    firecrawlBaseUrl: env.FIRECRAWL_BASE_URL ?? "https://api.firecrawl.dev",
    firecrawlApiKey: env.FIRECRAWL_API_KEY ?? null,
    defaultProviderKeys: ["kalshi", "polymarket"],
  };
}
