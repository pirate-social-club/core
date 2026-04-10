import { createId } from "../ids";
import { nowIso } from "../time";
import {
  computeClaimSemanticSimilarity,
  computeSourceSpecificity,
  scoreMarketCandidate,
  selectTopScoredMarkets,
} from "./scoring";
import { createNormalizedClaimHash } from "./hash";
import { resolveExtractionText } from "./fetchers";
import type {
  MarketContextExtractionClient,
  MarketContextJobPayload,
  MarketContextJobResult,
  MarketContextPageFetcher,
  MarketContextRecallIndex,
  MarketContextRerankClient,
  MarketRecallDocument,
  MarketContextStore,
  NormalizedMarketCandidate,
  ResolvedMarketContextPolicy,
  ClaimCandidate,
  ProviderSearchDiagnostics,
  UpsertClaimMarketBindingInput,
} from "./types";
import type { MarketContextConfig } from "./config";
import type { MarketContextProviderRegistry } from "./providers";

function isEligiblePost(policy: ResolvedMarketContextPolicy, post: {
  post_type: string;
  status: string;
  parent_post_id: string | null;
  link_url: string | null;
}): boolean {
  return (
    policy.mode === "on" &&
    policy.enabled_post_types.includes("link") &&
    post.parent_post_id == null &&
    post.post_type === "link" &&
    post.link_url != null &&
    post.status === "published"
  );
}

function getProviderQuality(providerKey: string): number {
  switch (providerKey) {
    case "kalshi":
      return 1;
    case "polymarket":
      return 0.95;
    default:
      return 0.75;
  }
}

function computeMinSnapshotAt(now: Date, ttlSeconds: number): string {
  return new Date(now.getTime() - ttlSeconds * 1000).toISOString();
}

function createMatchingEvidence(input: {
  fetchedPage: unknown;
  extractionOutput: unknown;
  rawExtractionOutput?: unknown;
  allowedClaimTypes?: unknown;
  retrievalDiagnostics?: unknown;
  scoredCandidates: unknown;
}): string {
  return JSON.stringify(input);
}

function normalizeQuery(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function formatDateParts(value: string | null | undefined): { isoDate: string; readableDate: string } | null {
  if (!value) {
    return null;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  const month = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ][date.getUTCMonth()];

  return {
    isoDate: date.toISOString().slice(0, 10),
    readableDate: `${month} ${date.getUTCDate()}, ${date.getUTCFullYear()}`,
  };
}

function formatMonthYear(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  const month = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ][date.getUTCMonth()];

  return `${month} ${date.getUTCFullYear()}`;
}

function formatReadableUtcDate(date: Date): string {
  const month = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ][date.getUTCMonth()];

  return `${month} ${date.getUTCDate()}, ${date.getUTCFullYear()}`;
}

function shiftUtcDays(date: Date, days: number): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + days));
}

function createUtcDayWindow(date: Date): { start_at: string; end_at: string } {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();
  const day = date.getUTCDate();

  return {
    start_at: new Date(Date.UTC(year, month, day, 0, 0, 0)).toISOString(),
    end_at: new Date(Date.UTC(year, month, day, 23, 59, 59)).toISOString(),
  };
}

function resolveRelativeTimeframe(input: {
  timeframe: ClaimCandidate["timeframe"];
  referenceDate: Date | null;
}): ClaimCandidate["timeframe"] {
  const { timeframe, referenceDate } = input;

  if (!referenceDate) {
    return timeframe;
  }

  if (timeframe.start_at || timeframe.end_at || timeframe.kind === "none") {
    return timeframe;
  }

  const label = timeframe.label.toLowerCase();
  const baseDate = shiftUtcDays(referenceDate, 0);

  const directOffsets: Array<{ patterns: string[]; offset: number }> = [
    { patterns: ["article day", "post publication", "today", "this day"], offset: 0 },
    { patterns: ["tomorrow", "next day", "following day"], offset: 1 },
    { patterns: ["yesterday", "previous day"], offset: -1 },
  ];

  for (const entry of directOffsets) {
    if (entry.patterns.some((pattern) => label.includes(pattern))) {
      const targetDate = shiftUtcDays(baseDate, entry.offset);
      return {
        ...timeframe,
        label: `${formatReadableUtcDate(targetDate)}${label.includes("afternoon") ? " afternoon" : ""}`,
        ...createUtcDayWindow(targetDate),
      };
    }
  }

  const weekdayNames = [
    "sunday",
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday",
  ];
  const weekdayIndex = weekdayNames.findIndex((day) => label.includes(day));
  if (weekdayIndex !== -1) {
    let offset = weekdayIndex - baseDate.getUTCDay();

    if (label.includes("next ") && offset <= 0) {
      offset += 7;
    } else if (label.includes("last ") && offset >= 0) {
      offset -= 7;
    }

    const targetDate = shiftUtcDays(baseDate, offset);
    return {
      ...timeframe,
      label: `${formatReadableUtcDate(targetDate)}${label.includes("afternoon") ? " afternoon" : ""}`,
      ...createUtcDayWindow(targetDate),
    };
  }

  return timeframe;
}

function normalizeExtractedClaims(input: {
  extractionOutput: Awaited<ReturnType<MarketContextExtractionClient["extractClaims"]>>;
  referencePublishedAt: string | null;
}): Awaited<ReturnType<MarketContextExtractionClient["extractClaims"]>> {
  const referenceDate =
    input.referencePublishedAt == null ? null : new Date(input.referencePublishedAt);
  const safeReferenceDate =
    referenceDate && !Number.isNaN(referenceDate.getTime()) ? referenceDate : null;

  return {
    ...input.extractionOutput,
    claim_candidates: input.extractionOutput.claim_candidates.map((claimCandidate) => ({
      ...claimCandidate,
      timeframe: resolveRelativeTimeframe({
        timeframe: claimCandidate.timeframe,
        referenceDate: safeReferenceDate,
      }),
    })),
  };
}

function extractMacroAction(claimCandidate: ClaimCandidate): string | null {
  const source = `${claimCandidate.normalized_claim_text} ${claimCandidate.claim_text}`.toLowerCase();
  const actionPatterns: Array<{ patterns: string[]; value: string }> = [
    { patterns: ["unchanged", "hold", "holds", "keep", "keeps", "pause"], value: "hold" },
    { patterns: ["cut", "cuts", "lower", "lowers", "ease", "eases"], value: "cut" },
    { patterns: ["hike", "hikes", "raise", "raises", "increase", "increases"], value: "hike" },
  ];

  for (const entry of actionPatterns) {
    if (entry.patterns.some((pattern) => source.includes(pattern))) {
      return entry.value;
    }
  }

  return null;
}

function extractMacroRatePhrase(claimCandidate: ClaimCandidate): string | null {
  const source = `${claimCandidate.normalized_claim_text} ${claimCandidate.claim_text}`;
  const rangeMatch = source.match(/\b\d+(?:\.\d+)?%\s*(?:-|to|–)\s*\d+(?:\.\d+)?%\b/);
  if (rangeMatch?.[0]) {
    return rangeMatch[0].replace(/\s+/g, "");
  }

  const singleRateMatch = source.match(/\b\d+(?:\.\d+)?%\b/);
  return singleRateMatch?.[0] ?? null;
}

function getMacroSearchActors(claimCandidate: ClaimCandidate): string[] {
  const entities = claimCandidate.entities.map((entity) => entity.trim()).filter(Boolean);
  const normalizedEntities = entities.map((entity) => entity.toLowerCase());
  const hasFed =
    normalizedEntities.some((entity) => entity.includes("federal reserve")) ||
    normalizedEntities.some((entity) => entity === "fed") ||
    normalizedEntities.some((entity) => entity.includes("fomc")) ||
    claimCandidate.normalized_claim_text.toLowerCase().includes("federal reserve") ||
    claimCandidate.normalized_claim_text.toLowerCase().includes("fed");

  if (hasFed) {
    return ["Federal Reserve", "FOMC"];
  }

  return entities.slice(0, 2);
}

function buildSearchQueries(claimCandidate: ClaimCandidate): string[] {
  const queries = new Set<string>();
  const timeframeDate = formatDateParts(claimCandidate.timeframe.start_at ?? null);
  const timeframeMonthYear = formatMonthYear(claimCandidate.timeframe.start_at ?? null);
  const timeframeTokens = timeframeDate
    ? [timeframeDate.isoDate, timeframeDate.readableDate]
    : claimCandidate.timeframe.kind === "none"
      ? []
      : [claimCandidate.timeframe.label];

  queries.add(normalizeQuery(claimCandidate.normalized_claim_text));
  queries.add(normalizeQuery(claimCandidate.claim_text));

  if (claimCandidate.entities.length > 0) {
    queries.add(
      normalizeQuery(
        `${claimCandidate.entities.join(" ")} ${claimCandidate.normalized_claim_text}`,
      ),
    );
  }

  if (claimCandidate.claim_type === "court_case") {
    for (const timeframeToken of timeframeTokens.length > 0 ? timeframeTokens : [""]) {
      queries.add(
        normalizeQuery(
          `${claimCandidate.entities.join(" ")} ${claimCandidate.normalized_claim_text} ${timeframeToken}`,
        ),
      );
    }
  }

  if (claimCandidate.claim_type === "macro") {
    const macroActors = getMacroSearchActors(claimCandidate);
    const actorText = macroActors.join(" ");
    const action = extractMacroAction(claimCandidate);
    const ratePhrase = extractMacroRatePhrase(claimCandidate);

    if (actorText) {
      queries.add(normalizeQuery(`${actorText} ${claimCandidate.normalized_claim_text}`));
    }

    for (const timeframeToken of timeframeTokens.length > 0 ? timeframeTokens : [""]) {
      queries.add(
        normalizeQuery(`${actorText} rate decision ${timeframeToken}`),
      );
      queries.add(
        normalizeQuery(`${actorText} target rate ${timeframeToken}`),
      );
      queries.add(
        normalizeQuery(`${actorText} federal funds rate ${timeframeToken}`),
      );
      queries.add(
        normalizeQuery(`${actorText} FOMC ${timeframeToken}`),
      );

      if (action) {
        queries.add(normalizeQuery(`${actorText} ${action} rates ${timeframeToken}`));
        queries.add(normalizeQuery(`${actorText} ${action} rate ${timeframeToken}`));
      }

      if (action && ratePhrase) {
        queries.add(
          normalizeQuery(`${actorText} ${action} target rate ${ratePhrase} ${timeframeToken}`),
        );
        queries.add(
          normalizeQuery(`${actorText} ${action} federal funds rate ${ratePhrase} ${timeframeToken}`),
        );
      }
    }

    if (timeframeMonthYear) {
      queries.add(normalizeQuery(`${actorText} ${timeframeMonthYear} FOMC meeting`));
      queries.add(normalizeQuery(`${actorText} after ${timeframeMonthYear} meeting`));

      if (action) {
        queries.add(normalizeQuery(`${actorText} ${action} after ${timeframeMonthYear} meeting`));
        queries.add(normalizeQuery(`${actorText} ${action} at ${timeframeMonthYear} FOMC`));
      }

      if (action && ratePhrase) {
        queries.add(
          normalizeQuery(`${actorText} ${action} ${ratePhrase} after ${timeframeMonthYear} meeting`),
        );
      }
    }
  }

  if (claimCandidate.claim_type === "policy" || claimCandidate.claim_type === "legislation") {
    for (const timeframeToken of timeframeTokens.length > 0 ? timeframeTokens : [""]) {
      queries.add(normalizeQuery(`${claimCandidate.entities.join(" ")} policy ${timeframeToken}`));
    }
  }

  return Array.from(queries).filter((query) => query.length >= 8).slice(0, 10);
}

function parseCachedMarketCandidate(snapshotPayloadJson: string | null): NormalizedMarketCandidate | null {
  if (!snapshotPayloadJson) {
    return null;
  }

  try {
    const parsed = JSON.parse(snapshotPayloadJson) as Partial<NormalizedMarketCandidate>;
    if (
      typeof parsed.provider_key !== "string" ||
      typeof parsed.provider_market_id !== "string" ||
      typeof parsed.question !== "string" ||
      typeof parsed.market_url !== "string" ||
      typeof parsed.outcome_yes_price !== "string"
    ) {
      return null;
    }

    return {
      provider_key: parsed.provider_key,
      provider_market_id: parsed.provider_market_id,
      provider_event_id:
        typeof parsed.provider_event_id === "string" ? parsed.provider_event_id : null,
      question: parsed.question,
      market_url: parsed.market_url,
      outcome_yes_price: parsed.outcome_yes_price,
      liquidity_score:
        typeof parsed.liquidity_score === "number" ? parsed.liquidity_score : null,
      resolve_date: typeof parsed.resolve_date === "string" ? parsed.resolve_date : null,
      provider_status:
        parsed.provider_status === "open" ||
        parsed.provider_status === "closed" ||
        parsed.provider_status === "resolved" ||
        parsed.provider_status === "unknown"
          ? parsed.provider_status
          : "unknown",
      raw_payload_ref:
        typeof parsed.raw_payload_ref === "string" ? parsed.raw_payload_ref : null,
    };
  } catch {
    return null;
  }
}

async function persistNoMatch(input: {
  store: MarketContextStore;
  postMarketContextId: string;
  postId: string;
  communityId: string;
  snapshotAt: string;
  evidence: string | null;
}): Promise<void> {
  await input.store.upsertPostMarketContext({
    post_market_context_id: input.postMarketContextId,
    post_id: input.postId,
    community_id: input.communityId,
    status: "no_match",
    claim_summary: null,
    matching_evidence_json: input.evidence,
    snapshot_at: input.snapshotAt,
    created_at: input.snapshotAt,
    updated_at: input.snapshotAt,
  });

  await input.store.replacePostMarketContextMarkets({
    post_market_context_id: input.postMarketContextId,
    markets: [],
  });
}

async function gatherCandidateMarkets(input: {
  claimCandidate: ClaimCandidate;
  searchQueries: string[];
  now: Date;
  config: MarketContextConfig;
  store: MarketContextStore;
  providers: MarketContextProviderRegistry;
  providerKeys: string[];
}): Promise<{
  candidates: NormalizedMarketCandidate[];
  recallDocuments: MarketRecallDocument[];
  usedCache: boolean;
  searchQueries: string[];
  providerCandidateCounts: Record<string, number>;
  providerDiagnostics: ProviderSearchDiagnostics[];
}> {
  const normalizedClaimHash = await createNormalizedClaimHash({
    normalizedClaimText: input.claimCandidate.normalized_claim_text,
    timeframeLabel: input.claimCandidate.timeframe.label,
    entities: input.claimCandidate.entities,
  });

  const cached = await input.store.getFreshClaimMarketBindings({
    normalized_claim_hash: normalizedClaimHash,
    min_snapshot_at: computeMinSnapshotAt(input.now, input.config.openMarketTtlSeconds),
  });

  const cachedCandidates = cached
    .map((row) => parseCachedMarketCandidate(row.snapshot_payload_json))
    .filter((candidate): candidate is NormalizedMarketCandidate => candidate != null);

  if (cachedCandidates.length > 0) {
    return {
      usedCache: true,
      candidates: cachedCandidates,
      recallDocuments: [],
      searchQueries: input.searchQueries,
      providerCandidateCounts: cachedCandidates.reduce<Record<string, number>>((acc, candidate) => {
        acc[candidate.provider_key] = (acc[candidate.provider_key] ?? 0) + 1;
        return acc;
      }, {}),
      providerDiagnostics: [],
    };
  }

  const providerResults = await Promise.all(
    input.providerKeys.map(async (providerKey) => {
      const adapter = input.providers.get(providerKey);
      return adapter.searchMarkets({
        claim_candidate: input.claimCandidate,
        search_queries: input.searchQueries,
        max_results: input.config.maxResultsPerProvider,
      });
    }),
  );
  const candidates = providerResults.flatMap((result) => result.candidates);
  const recallDocuments = providerResults.flatMap((result) => result.recall_documents);

  return {
    usedCache: false,
    candidates,
    recallDocuments,
    searchQueries: input.searchQueries,
    providerCandidateCounts: candidates.reduce<Record<string, number>>((acc, candidate) => {
      acc[candidate.provider_key] = (acc[candidate.provider_key] ?? 0) + 1;
      return acc;
    }, {}),
    providerDiagnostics: providerResults.map((result) => result.diagnostics),
  };
}

function mergeUniqueCandidates(input: {
  primary: NormalizedMarketCandidate[];
  secondary: NormalizedMarketCandidate[];
}): NormalizedMarketCandidate[] {
  const merged = new Map<string, NormalizedMarketCandidate>();

  for (const candidate of [...input.primary, ...input.secondary]) {
    merged.set(`${candidate.provider_key}:${candidate.provider_market_id}`, candidate);
  }

  return Array.from(merged.values());
}

async function buildBindingInputs(input: {
  selectedMarkets: ReturnType<typeof selectTopScoredMarkets>;
  nowIsoValue: string;
}): Promise<UpsertClaimMarketBindingInput[]> {
  return Promise.all(input.selectedMarkets.map(async (candidate) => ({
    claim_market_binding_id: createId("cmb"),
    normalized_claim_hash: await createNormalizedClaimHash({
      normalizedClaimText: candidate.claim_candidate.normalized_claim_text,
      timeframeLabel: candidate.claim_candidate.timeframe.label,
      entities: candidate.claim_candidate.entities,
    }),
    normalized_claim_text: candidate.claim_candidate.normalized_claim_text,
    provider_key: candidate.market_candidate.provider_key,
    provider_market_id: candidate.market_candidate.provider_market_id,
    provider_event_id: candidate.market_candidate.provider_event_id,
    question: candidate.market_candidate.question,
    market_url: candidate.market_candidate.market_url,
    resolve_date: candidate.market_candidate.resolve_date,
    snapshot_payload_json: JSON.stringify(candidate.market_candidate),
    snapshot_at: input.nowIsoValue,
    status: "active",
    created_at: input.nowIsoValue,
    updated_at: input.nowIsoValue,
  })));
}

async function rerankCandidateMarkets(input: {
  claimCandidate: ClaimCandidate;
  candidates: NormalizedMarketCandidate[];
  rerankClient: MarketContextRerankClient;
}): Promise<{ scores: Map<string, number>; status: "selected" | "abstained" | "failed" | "skipped" }> {
  if (input.candidates.length === 0) {
    return { scores: new Map(), status: "skipped" };
  }

  try {
    const rerankOutput = await input.rerankClient.rerankMarkets({
      claim_candidate: input.claimCandidate,
      candidates: input.candidates.slice(0, 8),
    });

    if (!rerankOutput.should_attach || rerankOutput.selections.length === 0) {
      return { scores: new Map(), status: "abstained" };
    }

    return {
      scores: new Map(
        rerankOutput.selections.map((selection) => [
          `${selection.provider_key}:${selection.provider_market_id}`,
          selection.relevance_score,
        ]),
      ),
      status: "selected",
    };
  } catch {
    return { scores: new Map(), status: "failed" };
  }
}

export class MarketContextMatchWorker {
  constructor(
    private readonly store: MarketContextStore,
    private readonly pageFetcher: MarketContextPageFetcher,
    private readonly extractionClient: MarketContextExtractionClient,
    private readonly rerankClient: MarketContextRerankClient,
    private readonly providers: MarketContextProviderRegistry,
    private readonly recallIndex: MarketContextRecallIndex | null,
    private readonly config: MarketContextConfig,
  ) {}

  async process(payload: MarketContextJobPayload, now = new Date()): Promise<MarketContextJobResult> {
    const post = await this.store.getEligiblePost(payload.post_id);
    if (!post) {
      throw new Error(`Post ${payload.post_id} not found`);
    }

    const providerKeys =
      payload.policy_snapshot.provider_keys.length > 0
        ? payload.policy_snapshot.provider_keys
        : (await this.store.getResolvedPolicy(post.community_id)).provider_keys;
    const policy: ResolvedMarketContextPolicy = {
      mode: payload.policy_snapshot.mode,
      enabled_post_types: payload.policy_snapshot.enabled_post_types,
      max_markets_per_post: payload.policy_snapshot.max_markets_per_post,
      provider_set: payload.policy_snapshot.provider_set,
      market_context_profile_id: payload.policy_snapshot.market_context_profile_id,
      provider_keys: providerKeys,
    };
    const postMarketContextId =
      (await this.store.getPostMarketContextId(post.post_id)) ?? createId("pmc");
    const currentIso = nowIso(now);

    if (!isEligiblePost(policy, post)) {
      await persistNoMatch({
        store: this.store,
        postMarketContextId,
        postId: post.post_id,
        communityId: post.community_id,
        snapshotAt: currentIso,
        evidence: null,
      });

      return {
        post_market_context_id: postMarketContextId,
        status: "no_match",
        claim_summary: null,
        attached_market_count: 0,
        used_cache: false,
        provider_keys: [],
        snapshot_at: currentIso,
      };
    }

    const fetchedPage = await this.pageFetcher.fetchPage(post.link_url as string);
    const extractionText = resolveExtractionText(fetchedPage, this.config.maxTextChars);

    if (!extractionText || extractionText.length < this.config.minMeaningfulChars) {
      await persistNoMatch({
        store: this.store,
        postMarketContextId,
        postId: post.post_id,
        communityId: post.community_id,
        snapshotAt: currentIso,
        evidence: JSON.stringify({ fetchedPage }),
      });

      return {
        post_market_context_id: postMarketContextId,
        status: "no_match",
        claim_summary: null,
        attached_market_count: 0,
        used_cache: false,
        provider_keys: [],
        snapshot_at: currentIso,
      };
    }

    const extractionOutput = normalizeExtractedClaims({
      extractionOutput: await this.extractionClient.extractClaims({
        post_id: post.post_id,
        post_title: post.title,
        link_url: post.link_url as string,
      fetched_page: {
        final_url: fetchedPage.final_url,
        canonical_url: fetchedPage.canonical_url,
        title: fetchedPage.title,
        meta_description: fetchedPage.meta_description,
        published_at: fetchedPage.published_at,
        site_name: fetchedPage.site_name,
        excerpt: fetchedPage.excerpt,
        content_text: extractionText,
      },
      }),
      referencePublishedAt: fetchedPage.published_at ?? null,
    });
    const scopedExtractionOutput = {
      ...extractionOutput,
      claim_candidates: extractionOutput.claim_candidates.filter((claimCandidate) =>
        this.config.allowedClaimTypes.includes(claimCandidate.claim_type),
      ),
    };

    if (
      !scopedExtractionOutput.should_attach ||
      scopedExtractionOutput.confidence < this.config.minExtractionConfidence ||
      scopedExtractionOutput.claim_candidates.length === 0
    ) {
      await persistNoMatch({
        store: this.store,
        postMarketContextId,
        postId: post.post_id,
        communityId: post.community_id,
        snapshotAt: currentIso,
        evidence: JSON.stringify({
          fetchedPage,
          extractionOutput,
          scopedExtractionOutput,
          allowedClaimTypes: this.config.allowedClaimTypes,
        }),
      });

      return {
        post_market_context_id: postMarketContextId,
        status: "no_match",
        claim_summary: null,
        attached_market_count: 0,
        used_cache: false,
        provider_keys: [],
        snapshot_at: currentIso,
      };
    }

    const sourceSpecificity = computeSourceSpecificity(scopedExtractionOutput.reason);
    const scoredCandidates = [];
    const retrievalDiagnostics = [];
    let usedCache = false;

    for (const claimCandidate of scopedExtractionOutput.claim_candidates) {
      const searchQueries = buildSearchQueries(claimCandidate);
      const gathered = await gatherCandidateMarkets({
        claimCandidate,
        searchQueries,
        now,
        config: this.config,
        store: this.store,
        providers: this.providers,
        providerKeys: policy.provider_keys,
      });

      usedCache = usedCache || gathered.usedCache;

      const recallHits =
        this.recallIndex == null || !this.config.recallEnabled
          ? []
          : await this.recallIndex.search({
              claim_candidate: claimCandidate,
              documents: gathered.recallDocuments,
              max_results: this.config.recallTopK,
            });
      const recallScoreByCandidate = new Map(
        recallHits.map((hit) => [
          `${hit.market_candidate.provider_key}:${hit.market_candidate.provider_market_id}`,
          hit.recall_score,
        ]),
      );
      const mergedCandidates = mergeUniqueCandidates({
        primary: gathered.candidates,
        secondary: recallHits.map((hit) => hit.market_candidate),
      });

      const rerank = await rerankCandidateMarkets({
        claimCandidate,
        candidates: mergedCandidates,
        rerankClient: this.rerankClient,
      });

      retrievalDiagnostics.push({
        claim_text: claimCandidate.claim_text,
        normalized_claim_text: claimCandidate.normalized_claim_text,
        search_queries: gathered.searchQueries,
        used_cache: gathered.usedCache,
        provider_candidate_counts: gathered.providerCandidateCounts,
        provider_diagnostics: gathered.providerDiagnostics,
        gathered_candidate_count: gathered.candidates.length,
        recall_document_count: gathered.recallDocuments.length,
        recall_hit_count: recallHits.length,
        rerank_status: rerank.status,
        rerank_selected_count: rerank.scores.size,
      });

      for (const marketCandidate of mergedCandidates) {
        const rerankScore =
          rerank.scores.get(
            `${marketCandidate.provider_key}:${marketCandidate.provider_market_id}`,
          ) ?? 0;
        const recallScore =
          recallScoreByCandidate.get(
            `${marketCandidate.provider_key}:${marketCandidate.provider_market_id}`,
          ) ?? 0;
        scoredCandidates.push(
          scoreMarketCandidate({
            claimCandidate,
            marketCandidate,
            sourceSpecificity,
            providerQuality: getProviderQuality(marketCandidate.provider_key),
            semanticSimilarity: Math.max(
              computeClaimSemanticSimilarity(claimCandidate, marketCandidate.question),
              rerankScore,
              recallScore,
            ),
          }),
        );
      }
    }

    const selectedMarkets = selectTopScoredMarkets({
      scoredCandidates,
      maxMarketsPerPost: policy.max_markets_per_post,
      minSemanticSimilarity: this.config.minSemanticSimilarity,
      minFinalScore: this.config.minFinalScore,
    });

    if (selectedMarkets.length === 0) {
      await persistNoMatch({
        store: this.store,
        postMarketContextId,
        postId: post.post_id,
        communityId: post.community_id,
        snapshotAt: currentIso,
        evidence: createMatchingEvidence({
          fetchedPage,
          extractionOutput: scopedExtractionOutput,
          rawExtractionOutput: extractionOutput,
          allowedClaimTypes: this.config.allowedClaimTypes,
          retrievalDiagnostics,
          scoredCandidates,
        }),
      });

      return {
        post_market_context_id: postMarketContextId,
        status: "no_match",
        claim_summary: null,
        attached_market_count: 0,
        used_cache: usedCache,
        provider_keys: [],
        snapshot_at: currentIso,
      };
    }

    const claimSummary = selectedMarkets[0]?.claim_candidate.claim_text ?? null;

    await this.store.upsertPostMarketContext({
      post_market_context_id: postMarketContextId,
      post_id: post.post_id,
      community_id: post.community_id,
      status: "attached",
      claim_summary: claimSummary,
      matching_evidence_json: createMatchingEvidence({
        fetchedPage,
        extractionOutput: scopedExtractionOutput,
        rawExtractionOutput: extractionOutput,
        allowedClaimTypes: this.config.allowedClaimTypes,
        retrievalDiagnostics,
        scoredCandidates,
      }),
      snapshot_at: currentIso,
      created_at: currentIso,
      updated_at: currentIso,
    });

    await this.store.replacePostMarketContextMarkets({
      post_market_context_id: postMarketContextId,
      markets: selectedMarkets.map((candidate) => ({
        market_context_market_id: createId("mcm"),
        provider_key: candidate.market_candidate.provider_key,
        provider_market_id: candidate.market_candidate.provider_market_id,
        provider_event_id: candidate.market_candidate.provider_event_id,
        question: candidate.market_candidate.question,
        outcome_yes_price: candidate.market_candidate.outcome_yes_price,
        liquidity_score:
          candidate.market_candidate.liquidity_score == null
            ? null
            : String(candidate.market_candidate.liquidity_score),
        resolve_date: candidate.market_candidate.resolve_date,
        market_url: candidate.market_candidate.market_url,
        match_confidence: candidate.final_score,
        snapshot_at: currentIso,
        status: "active",
        created_at: currentIso,
        updated_at: currentIso,
      })),
    });

    await this.store.upsertClaimMarketBindings(
      await buildBindingInputs({
        selectedMarkets,
        nowIsoValue: currentIso,
      }),
    );

    return {
      post_market_context_id: postMarketContextId,
      status: "attached",
      claim_summary: claimSummary,
      attached_market_count: selectedMarkets.length,
      used_cache: usedCache,
      provider_keys: Array.from(
        new Set(selectedMarkets.map((candidate) => candidate.market_candidate.provider_key)),
      ),
      snapshot_at: currentIso,
    };
  }
}
