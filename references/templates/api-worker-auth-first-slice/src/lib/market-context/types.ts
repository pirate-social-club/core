export type MarketContextProviderKey = "kalshi" | "polymarket" | (string & {});

export type MarketContextFetcher = "jina" | "firecrawl";

export type MarketContextAttemptReason = "post_create" | "manual_retry" | "refresh";

export type MarketContextStatus = "none" | "pending" | "attached" | "no_match" | "detached";

export type MarketContextMode = "off" | "on";

export type MarketContextProviderSet = "platform_default" | "approved_profile";

export type ResolvedMarketContextPolicy = {
  mode: MarketContextMode;
  enabled_post_types: Array<"link" | "image" | "video">;
  max_markets_per_post: number;
  provider_set: MarketContextProviderSet;
  market_context_profile_id: string | null;
  provider_keys: MarketContextProviderKey[];
};

export type MarketContextEligiblePost = {
  post_id: string;
  community_id: string;
  post_type: "text" | "image" | "video" | "link" | "song";
  status: "draft" | "published" | "hidden" | "removed" | "deleted";
  parent_post_id: string | null;
  title: string | null;
  link_url: string | null;
};

export type FetchedPageFailureCode =
  | "network_error"
  | "timeout"
  | "blocked"
  | "unsupported_content"
  | "empty_content";

export type FetchedPage = {
  final_url: string;
  canonical_url: string | null;
  http_status: number | null;
  fetched_at: string;
  title: string | null;
  meta_description: string | null;
  byline: string | null;
  published_at: string | null;
  site_name: string | null;
  content_markdown: string | null;
  content_text: string | null;
  excerpt: string | null;
  language: string | null;
  failure_code: FetchedPageFailureCode | null;
};

export type ClaimExtractionInput = {
  post_id: string;
  post_title: string | null;
  link_url: string;
  fetched_page: {
    final_url: string;
    canonical_url: string | null;
    title: string | null;
    meta_description: string | null;
    published_at: string | null;
    site_name: string | null;
    excerpt: string | null;
    content_text: string | null;
  };
};

export type ClaimCandidateType =
  | "election"
  | "legislation"
  | "macro"
  | "company_milestone"
  | "asset_price"
  | "sports"
  | "court_case"
  | "policy"
  | "other";

export type ClaimTimeframeKind = "explicit_date" | "date_range" | "event_window" | "none";

export type ClaimTimeframe = {
  kind: ClaimTimeframeKind;
  label: string;
  start_at?: string | null;
  end_at?: string | null;
};

export type ClaimCandidate = {
  claim_text: string;
  normalized_claim_text: string;
  claim_type: ClaimCandidateType;
  entities: string[];
  timeframe: ClaimTimeframe;
};

export type ClaimExtractionReason =
  | "clear_resolvable_claim"
  | "multiple_resolvable_claims"
  | "too_vague"
  | "opinion_or_analysis"
  | "propaganda_or_framing_without_claim"
  | "insufficient_source_text"
  | "non_news_content";

export type ClaimExtractionOutput = {
  should_attach: boolean;
  confidence: number;
  reason: ClaimExtractionReason;
  claim_candidates: ClaimCandidate[];
};

export type ProviderMarketSearchInput = {
  claim_candidate: ClaimCandidate;
  search_queries: string[];
  max_results: number;
};

export type ProviderSearchDiagnostics = {
  provider_key: MarketContextProviderKey;
  query_result_limit?: number;
  raw_result_count_by_query: Array<{
    query: string;
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
};

export type ProviderRecallDiagnostics = {
  provider_key: MarketContextProviderKey;
  document_count: number;
};

export type ProviderMarketStatus = "open" | "closed" | "resolved" | "unknown";

export type NormalizedMarketCandidate = {
  provider_key: MarketContextProviderKey;
  provider_market_id: string;
  provider_event_id: string | null;
  question: string;
  market_url: string;
  outcome_yes_price: string;
  liquidity_score: number | null;
  resolve_date: string | null;
  provider_status: ProviderMarketStatus;
  raw_payload_ref: string | null;
};

export type MarketRecallDocument = {
  provider_key: MarketContextProviderKey;
  provider_market_id: string;
  provider_event_id: string | null;
  question: string;
  market_url: string;
  outcome_yes_price: string;
  liquidity_score: number | null;
  resolve_date: string | null;
  provider_status: ProviderMarketStatus;
  raw_payload_ref: string | null;
  document_text: string;
};

export type MarketRecallHit = {
  market_candidate: NormalizedMarketCandidate;
  recall_score: number;
};

export interface MarketContextEmbeddingClient {
  embedTexts(input: { texts: string[] }): Promise<number[][]>;
}

export type MarketRerankSelection = {
  provider_key: MarketContextProviderKey;
  provider_market_id: string;
  relevance_score: number;
};

export type MarketRerankInput = {
  claim_candidate: ClaimCandidate;
  candidates: NormalizedMarketCandidate[];
};

export type MarketRerankOutput = {
  should_attach: boolean;
  confidence: number;
  selections: MarketRerankSelection[];
};

export interface MarketContextProviderAdapter {
  readonly provider_key: MarketContextProviderKey;
  searchMarkets(input: ProviderMarketSearchInput): Promise<{
    candidates: NormalizedMarketCandidate[];
    recall_documents: MarketRecallDocument[];
    diagnostics: ProviderSearchDiagnostics;
  }>;
}

export interface MarketContextRecallIndex {
  search(input: {
    claim_candidate: ClaimCandidate;
    documents: MarketRecallDocument[];
    max_results: number;
  }): Promise<MarketRecallHit[]>;
}

export type MarketContextJobPayload = {
  post_id: string;
  community_id: string;
  attempt_reason: MarketContextAttemptReason;
  link_url: string;
  policy_snapshot: {
    mode: MarketContextMode;
    enabled_post_types: Array<"link" | "image" | "video">;
    max_markets_per_post: number;
    provider_set: MarketContextProviderSet;
    market_context_profile_id: string | null;
    provider_keys: MarketContextProviderKey[];
  };
};

export type MarketContextJobResult = {
  post_market_context_id: string;
  status: Extract<MarketContextStatus, "attached" | "no_match" | "detached">;
  claim_summary: string | null;
  attached_market_count: number;
  used_cache: boolean;
  provider_keys: MarketContextProviderKey[];
  snapshot_at: string;
};

export type ClaimMarketBinding = {
  normalized_claim_hash: string;
  normalized_claim_text: string;
  provider_key: MarketContextProviderKey;
  provider_market_id: string;
  provider_event_id: string | null;
  question: string;
  market_url: string;
  resolve_date: string | null;
  snapshot_payload_json: string | null;
  snapshot_at: string | null;
  status: "active" | "archived";
};

export type UpsertPostMarketContextInput = {
  post_market_context_id: string;
  post_id: string;
  community_id: string;
  status: MarketContextStatus;
  claim_summary: string | null;
  matching_evidence_json: string | null;
  snapshot_at: string | null;
  created_at: string;
  updated_at: string;
};

export type ReplacePostMarketContextMarketsInput = {
  post_market_context_id: string;
  markets: Array<{
    market_context_market_id: string;
    provider_key: MarketContextProviderKey;
    provider_market_id: string;
    provider_event_id: string | null;
    question: string;
    outcome_yes_price: string;
    liquidity_score: string | null;
    resolve_date: string | null;
    market_url: string;
    match_confidence: number;
    snapshot_at: string;
    status: "active" | "removed_by_mod" | "pinned";
    created_at: string;
    updated_at: string;
  }>;
};

export type UpsertClaimMarketBindingInput = {
  claim_market_binding_id: string;
  normalized_claim_hash: string;
  normalized_claim_text: string;
  provider_key: MarketContextProviderKey;
  provider_market_id: string;
  provider_event_id: string | null;
  question: string;
  market_url: string;
  resolve_date: string | null;
  snapshot_payload_json: string | null;
  snapshot_at: string | null;
  status: "active" | "archived";
  created_at: string;
  updated_at: string;
};

export type ScoredMarketCandidate = {
  claim_candidate: ClaimCandidate;
  market_candidate: NormalizedMarketCandidate;
  semantic_similarity: number;
  timeframe_fit: number;
  entity_overlap: number;
  claim_shape_fit: number;
  source_specificity: number;
  provider_quality: number;
  final_score: number;
};

export interface MarketContextPageFetcher {
  fetchPage(url: string): Promise<FetchedPage>;
}

export interface MarketContextExtractionClient {
  extractClaims(input: ClaimExtractionInput): Promise<ClaimExtractionOutput>;
}

export interface MarketContextRerankClient {
  rerankMarkets(input: MarketRerankInput): Promise<MarketRerankOutput>;
}

export interface MarketContextStore {
  getEligiblePost(postId: string): Promise<MarketContextEligiblePost | null>;
  getPostMarketContextId(postId: string): Promise<string | null>;
  getResolvedPolicy(communityId: string): Promise<ResolvedMarketContextPolicy>;
  getFreshClaimMarketBindings(input: {
    normalized_claim_hash: string;
    min_snapshot_at: string;
  }): Promise<ClaimMarketBinding[]>;
  upsertPostMarketContext(input: UpsertPostMarketContextInput): Promise<void>;
  replacePostMarketContextMarkets(input: ReplacePostMarketContextMarketsInput): Promise<void>;
  upsertClaimMarketBindings(inputs: UpsertClaimMarketBindingInput[]): Promise<void>;
}
