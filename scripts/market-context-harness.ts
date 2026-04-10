import { runMarketContextMatchJob } from "../references/templates/api-worker-auth-first-slice/src/lib/market-context/job";
import type {
  ClaimMarketBinding,
  MarketContextEligiblePost,
  MarketContextJobPayload,
  MarketContextJobResult,
  MarketContextStore,
  ReplacePostMarketContextMarketsInput,
  ResolvedMarketContextPolicy,
  UpsertClaimMarketBindingInput,
  UpsertPostMarketContextInput,
} from "../references/templates/api-worker-auth-first-slice/src/lib/market-context/types";
import type { Env } from "../references/templates/api-worker-auth-first-slice/src/types/env";

export type ParsedMatchingEvidence = {
  fetchedPage?: { failure_code?: string | null };
  allowedClaimTypes?: string[];
  rawExtractionOutput?: {
    should_attach?: boolean;
    confidence?: number;
    reason?: string;
    claim_candidates?: Array<{
      claim_text?: string;
      normalized_claim_text?: string;
      claim_type?: string;
      timeframe?: {
        label?: string;
        start_at?: string | null;
        end_at?: string | null;
      };
    }>;
  };
  scopedExtractionOutput?: {
    should_attach?: boolean;
    confidence?: number;
    reason?: string;
    claim_candidates?: Array<{
      claim_text?: string;
      normalized_claim_text?: string;
      claim_type?: string;
      timeframe?: {
        label?: string;
        start_at?: string | null;
        end_at?: string | null;
      };
    }>;
  };
  extractionOutput?: {
    should_attach?: boolean;
    confidence?: number;
    reason?: string;
    claim_candidates?: Array<{
      claim_text?: string;
      normalized_claim_text?: string;
      claim_type?: string;
      timeframe?: {
        label?: string;
        start_at?: string | null;
        end_at?: string | null;
      };
    }>;
  };
  retrievalDiagnostics?: Array<{
    claim_text?: string;
    normalized_claim_text?: string;
    search_queries?: string[];
    used_cache?: boolean;
    provider_candidate_counts?: Record<string, number>;
    recall_document_count?: number;
    recall_hit_count?: number;
    provider_diagnostics?: Array<{
      provider_key?: string;
      query_result_limit?: number;
      raw_result_count_by_query?: Array<{ query?: string; count?: number; failed?: boolean }>;
      raw_result_count?: number;
      failed_query_count?: number;
      deduped_count?: number;
      post_claim_filter_count?: number;
      post_status_filter_count?: number;
      post_relevance_filter_count?: number;
      returned_count?: number;
    }>;
    gathered_candidate_count?: number;
    rerank_status?: string;
    rerank_selected_count?: number;
  }>;
  scoredCandidates?: Array<{
    claim_candidate?: {
      claim_text?: string;
      normalized_claim_text?: string;
      claim_type?: string;
    };
    market_candidate?: {
      provider_key?: string;
      question?: string;
      provider_status?: string;
    };
    semantic_similarity?: number;
    final_score?: number;
  }>;
};

export type EvidenceSummary = {
  fetch_failure_code: string | null;
  allowed_claim_types: string[];
  scope_filtered: boolean;
  extraction_should_attach: boolean | null;
  extraction_confidence: number | null;
  extraction_reason: string | null;
  raw_claim_candidates: Array<{
    claim_text: string | null;
    normalized_claim_text: string | null;
    claim_type: string | null;
    timeframe_label: string | null;
    timeframe_start_at: string | null;
    timeframe_end_at: string | null;
  }>;
  claim_candidates: Array<{
    claim_text: string | null;
    normalized_claim_text: string | null;
    claim_type: string | null;
    timeframe_label: string | null;
    timeframe_start_at: string | null;
    timeframe_end_at: string | null;
  }>;
  retrieval_diagnostics: Array<{
    claim_text: string | null;
    normalized_claim_text: string | null;
    search_queries: string[];
    used_cache: boolean;
    provider_candidate_counts: Record<string, number>;
    recall_document_count: number;
    recall_hit_count: number;
    provider_diagnostics: Array<{
      provider_key: string | null;
      query_result_limit: number | null;
      raw_result_count_by_query: Array<{
        query: string | null;
        count: number;
        failed: boolean;
      }>;
      raw_result_count: number;
      failed_query_count: number;
      deduped_count: number;
      post_claim_filter_count: number;
      post_status_filter_count: number;
      post_relevance_filter_count: number;
      returned_count: number;
    }>;
    gathered_candidate_count: number;
    rerank_status: string | null;
    rerank_selected_count: number;
  }>;
  scored_candidate_count: number;
  top_scored_candidates: Array<{
    provider_key: string | null;
    provider_status: string | null;
    question: string | null;
    semantic_similarity: number | null;
    final_score: number | null;
  }>;
};

export type HarnessRunOutput = {
  result: MarketContextJobResult;
  context: (UpsertPostMarketContextInput & {
    matching_evidence_bytes: number;
    matching_evidence_json?: string | null;
  }) | null;
  evidence: ParsedMatchingEvidence | null;
  evidence_summary: EvidenceSummary | null;
  markets: ReplacePostMarketContextMarketsInput["markets"];
  bindings_written: number;
};

class SmokeMarketContextStore implements MarketContextStore {
  private readonly posts = new Map<string, MarketContextEligiblePost>();
  private readonly postMarketContextIds = new Map<string, string>();
  private readonly bindings = new Map<string, ClaimMarketBinding[]>();
  public lastContext: UpsertPostMarketContextInput | null = null;
  public lastMarkets: ReplacePostMarketContextMarketsInput["markets"] = [];
  public lastBindings: UpsertClaimMarketBindingInput[] = [];

  constructor(
    post: MarketContextEligiblePost,
    private readonly policy: ResolvedMarketContextPolicy,
  ) {
    this.posts.set(post.post_id, post);
  }

  async getEligiblePost(postId: string): Promise<MarketContextEligiblePost | null> {
    return this.posts.get(postId) ?? null;
  }

  async getPostMarketContextId(postId: string): Promise<string | null> {
    return this.postMarketContextIds.get(postId) ?? null;
  }

  async getResolvedPolicy(_communityId: string): Promise<ResolvedMarketContextPolicy> {
    return this.policy;
  }

  async getFreshClaimMarketBindings(input: {
    normalized_claim_hash: string;
    min_snapshot_at: string;
  }): Promise<ClaimMarketBinding[]> {
    const candidates = this.bindings.get(input.normalized_claim_hash) ?? [];
    return candidates.filter((candidate) =>
      candidate.snapshot_at == null || candidate.snapshot_at >= input.min_snapshot_at,
    );
  }

  async upsertPostMarketContext(input: UpsertPostMarketContextInput): Promise<void> {
    this.postMarketContextIds.set(input.post_id, input.post_market_context_id);
    this.lastContext = input;
  }

  async replacePostMarketContextMarkets(input: ReplacePostMarketContextMarketsInput): Promise<void> {
    this.lastMarkets = input.markets;
  }

  async upsertClaimMarketBindings(inputs: UpsertClaimMarketBindingInput[]): Promise<void> {
    this.lastBindings = inputs;
    for (const input of inputs) {
      const existing = this.bindings.get(input.normalized_claim_hash) ?? [];
      const next: ClaimMarketBinding = {
        normalized_claim_hash: input.normalized_claim_hash,
        normalized_claim_text: input.normalized_claim_text,
        provider_key: input.provider_key,
        provider_market_id: input.provider_market_id,
        provider_event_id: input.provider_event_id,
        question: input.question,
        market_url: input.market_url,
        resolve_date: input.resolve_date,
        snapshot_payload_json: input.snapshot_payload_json,
        snapshot_at: input.snapshot_at,
        status: input.status,
      };
      this.bindings.set(input.normalized_claim_hash, [...existing, next]);
    }
  }
}

export function readArg(flag: string): string | null {
  const index = Bun.argv.indexOf(flag);
  if (index === -1) {
    return null;
  }

  return Bun.argv[index + 1] ?? null;
}

export function hasFlag(flag: string): boolean {
  return Bun.argv.includes(flag);
}

export function summarizeEvidence(parsed: ParsedMatchingEvidence | null): EvidenceSummary | null {
  if (!parsed) {
    return null;
  }

  const summarizeClaimCandidates = (
    candidates:
      | Array<{
          claim_text?: string;
          normalized_claim_text?: string;
          claim_type?: string;
          timeframe?: {
            label?: string;
            start_at?: string | null;
            end_at?: string | null;
          };
        }>
      | undefined,
  ) =>
    candidates?.map((candidate) => ({
      claim_text: candidate.claim_text ?? null,
      normalized_claim_text: candidate.normalized_claim_text ?? null,
      claim_type: candidate.claim_type ?? null,
      timeframe_label: candidate.timeframe?.label ?? null,
      timeframe_start_at: candidate.timeframe?.start_at ?? null,
      timeframe_end_at: candidate.timeframe?.end_at ?? null,
    })) ?? [];

  const rawClaimCandidates = summarizeClaimCandidates(
    parsed.rawExtractionOutput?.claim_candidates ?? parsed.extractionOutput?.claim_candidates,
  );
  const scopedClaimCandidates = summarizeClaimCandidates(
    parsed.scopedExtractionOutput?.claim_candidates ?? parsed.extractionOutput?.claim_candidates,
  );

  return {
    fetch_failure_code: parsed.fetchedPage?.failure_code ?? null,
    allowed_claim_types: parsed.allowedClaimTypes ?? [],
    scope_filtered:
      rawClaimCandidates.length > 0 &&
      rawClaimCandidates.length !== scopedClaimCandidates.length,
    extraction_should_attach:
      parsed.rawExtractionOutput?.should_attach ??
      parsed.extractionOutput?.should_attach ??
      null,
    extraction_confidence:
      parsed.rawExtractionOutput?.confidence ??
      parsed.extractionOutput?.confidence ??
      null,
    extraction_reason:
      parsed.rawExtractionOutput?.reason ??
      parsed.extractionOutput?.reason ??
      null,
    raw_claim_candidates: rawClaimCandidates,
    claim_candidates: scopedClaimCandidates,
    retrieval_diagnostics:
      parsed.retrievalDiagnostics?.map((diagnostic) => ({
        claim_text: diagnostic.claim_text ?? null,
        normalized_claim_text: diagnostic.normalized_claim_text ?? null,
        search_queries: diagnostic.search_queries ?? [],
        used_cache: diagnostic.used_cache ?? false,
        provider_candidate_counts: diagnostic.provider_candidate_counts ?? {},
        recall_document_count: diagnostic.recall_document_count ?? 0,
        recall_hit_count: diagnostic.recall_hit_count ?? 0,
        provider_diagnostics:
          diagnostic.provider_diagnostics?.map((providerDiagnostic) => ({
            provider_key: providerDiagnostic.provider_key ?? null,
            query_result_limit: providerDiagnostic.query_result_limit ?? null,
            raw_result_count_by_query:
              providerDiagnostic.raw_result_count_by_query?.map((entry) => ({
                query: entry.query ?? null,
                count: entry.count ?? 0,
                failed: entry.failed ?? false,
              })) ?? [],
            raw_result_count: providerDiagnostic.raw_result_count ?? 0,
            failed_query_count: providerDiagnostic.failed_query_count ?? 0,
            deduped_count: providerDiagnostic.deduped_count ?? 0,
            post_claim_filter_count: providerDiagnostic.post_claim_filter_count ?? 0,
            post_status_filter_count: providerDiagnostic.post_status_filter_count ?? 0,
            post_relevance_filter_count: providerDiagnostic.post_relevance_filter_count ?? 0,
            returned_count: providerDiagnostic.returned_count ?? 0,
          })) ?? [],
        gathered_candidate_count: diagnostic.gathered_candidate_count ?? 0,
        rerank_status: diagnostic.rerank_status ?? null,
        rerank_selected_count: diagnostic.rerank_selected_count ?? 0,
      })) ?? [],
    scored_candidate_count: parsed.scoredCandidates?.length ?? 0,
    top_scored_candidates:
      parsed.scoredCandidates?.slice(0, 5).map((candidate) => ({
        provider_key: candidate.market_candidate?.provider_key ?? null,
        provider_status: candidate.market_candidate?.provider_status ?? null,
        question: candidate.market_candidate?.question ?? null,
        semantic_similarity: candidate.semantic_similarity ?? null,
        final_score: candidate.final_score ?? null,
      })) ?? [],
  };
}

export function parseMatchingEvidence(raw: string | null): ParsedMatchingEvidence | null {
  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw) as ParsedMatchingEvidence;
  } catch {
    return null;
  }
}

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing ${name}`);
  }

  return value;
}

export function createHarnessEnv(): Env {
  return {
    CONTROL_PLANE_DATABASE_URL: "unused",
    AUTH_UPSTREAM_JWT_ISSUER: "unused",
    AUTH_UPSTREAM_JWT_AUDIENCE: "unused",
    AUTH_UPSTREAM_JWT_SHARED_SECRET: "unused",
    PIRATE_APP_JWT_ISSUER: "unused",
    PIRATE_APP_JWT_AUDIENCE: "unused",
    PIRATE_APP_JWT_PUBLIC_KEY: "unused",
    PIRATE_APP_JWT_PRIVATE_KEY: "unused",
    OPENROUTER_API_KEY: requireEnv("OPENROUTER_API_KEY"),
    JINA_API_KEY: process.env.JINA_API_KEY,
    OPENROUTER_BASE_URL: process.env.OPENROUTER_BASE_URL,
    MARKET_CONTEXT_OPENROUTER_MODEL:
      process.env.MARKET_CONTEXT_OPENROUTER_MODEL ?? "openai/gpt-5.4-nano",
    MARKET_CONTEXT_RERANK_MODEL:
      process.env.MARKET_CONTEXT_RERANK_MODEL ?? "google/gemini-2.5-flash-lite",
    MARKET_CONTEXT_EMBEDDING_MODEL:
      process.env.MARKET_CONTEXT_EMBEDDING_MODEL ?? "openai/text-embedding-3-small",
    MARKET_CONTEXT_ALLOWED_CLAIM_TYPES: process.env.MARKET_CONTEXT_ALLOWED_CLAIM_TYPES,
    MARKET_CONTEXT_OPENROUTER_TIMEOUT_MS: process.env.MARKET_CONTEXT_OPENROUTER_TIMEOUT_MS,
    MARKET_CONTEXT_FETCHER: process.env.MARKET_CONTEXT_FETCHER ?? "jina",
    MARKET_CONTEXT_MAX_RESULTS_PER_PROVIDER: process.env.MARKET_CONTEXT_MAX_RESULTS_PER_PROVIDER,
    MARKET_CONTEXT_RECALL_ENABLED: process.env.MARKET_CONTEXT_RECALL_ENABLED,
    MARKET_CONTEXT_RECALL_TOP_K: process.env.MARKET_CONTEXT_RECALL_TOP_K,
    MARKET_CONTEXT_MIN_EXTRACTION_CONFIDENCE:
      process.env.MARKET_CONTEXT_MIN_EXTRACTION_CONFIDENCE,
    MARKET_CONTEXT_MIN_SEMANTIC_SIMILARITY:
      process.env.MARKET_CONTEXT_MIN_SEMANTIC_SIMILARITY,
    MARKET_CONTEXT_MIN_FINAL_SCORE: process.env.MARKET_CONTEXT_MIN_FINAL_SCORE,
    MARKET_CONTEXT_MIN_MEANINGFUL_CHARS: process.env.MARKET_CONTEXT_MIN_MEANINGFUL_CHARS,
    MARKET_CONTEXT_MAX_TEXT_CHARS: process.env.MARKET_CONTEXT_MAX_TEXT_CHARS,
    MARKET_CONTEXT_OPEN_MARKET_TTL_SECONDS:
      process.env.MARKET_CONTEXT_OPEN_MARKET_TTL_SECONDS,
    MARKET_CONTEXT_CLOSED_MARKET_TTL_SECONDS:
      process.env.MARKET_CONTEXT_CLOSED_MARKET_TTL_SECONDS,
    MARKET_CONTEXT_RESOLVED_MARKET_TTL_SECONDS:
      process.env.MARKET_CONTEXT_RESOLVED_MARKET_TTL_SECONDS,
    KALSHI_API_BASE_URL: process.env.KALSHI_API_BASE_URL,
    POLYMARKET_API_BASE_URL: process.env.POLYMARKET_API_BASE_URL,
    JINA_READER_BASE_URL: process.env.JINA_READER_BASE_URL,
    FIRECRAWL_BASE_URL: process.env.FIRECRAWL_BASE_URL,
    FIRECRAWL_API_KEY: process.env.FIRECRAWL_API_KEY,
    PREDICT_FUN_API_KEY: process.env.PREDICT_FUN_API_KEY,
  };
}

export async function runMarketContextHarness(input: {
  url: string;
  title: string | null;
  now?: Date;
  verbose?: boolean;
  env?: Env;
  policy?: ResolvedMarketContextPolicy;
}): Promise<HarnessRunOutput> {
  const now = input.now ?? new Date();
  const env = input.env ?? createHarnessEnv();
  const post: MarketContextEligiblePost = {
    post_id: "post_smoke_1",
    community_id: "community_smoke_1",
    post_type: "link",
    status: "published",
    parent_post_id: null,
    title: input.title,
    link_url: input.url,
  };

  const policy: ResolvedMarketContextPolicy =
    input.policy ?? {
      mode: "on",
      enabled_post_types: ["link"],
      max_markets_per_post: 2,
      provider_set: "platform_default",
      market_context_profile_id: null,
      provider_keys: ["kalshi", "polymarket"],
    };

  const payload: MarketContextJobPayload = {
    post_id: post.post_id,
    community_id: post.community_id,
    attempt_reason: "manual_retry",
    link_url: input.url,
    policy_snapshot: {
      mode: policy.mode,
      enabled_post_types: policy.enabled_post_types,
      max_markets_per_post: policy.max_markets_per_post,
      provider_set: policy.provider_set,
      market_context_profile_id: policy.market_context_profile_id,
      provider_keys: policy.provider_keys,
    },
  };

  const store = new SmokeMarketContextStore(post, policy);
  const result = await runMarketContextMatchJob({
    payload,
    env,
    store,
    now,
  });

  const rawEvidence = store.lastContext?.matching_evidence_json ?? null;
  const parsedEvidence = parseMatchingEvidence(rawEvidence);
  const evidenceSummary = summarizeEvidence(parsedEvidence);
  const contextSummary =
    store.lastContext == null
      ? null
      : {
          ...store.lastContext,
          matching_evidence_json: input.verbose ? store.lastContext.matching_evidence_json : undefined,
          matching_evidence_bytes: rawEvidence == null ? 0 : rawEvidence.length,
        };

  return {
    result,
    context: contextSummary,
    evidence: parsedEvidence,
    evidence_summary: evidenceSummary,
    markets: store.lastMarkets,
    bindings_written: store.lastBindings.length,
  };
}
