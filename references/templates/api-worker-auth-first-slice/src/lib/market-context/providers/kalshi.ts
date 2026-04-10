import type {
  MarketContextProviderAdapter,
  ProviderMarketSearchInput,
  NormalizedMarketCandidate,
  MarketRecallDocument,
  ProviderSearchDiagnostics,
} from "../types";
import {
  computeProviderRelevance,
  getProviderRelevanceThreshold,
  isClaimTypeCandidateAllowed,
  tokenizeMeaningful,
  toRecallDocument,
} from "./shared";

export type KalshiMarketSearchResult = {
  ticker: string;
  event_ticker?: string | null;
  title: string;
  subtitle?: string | null;
  yes_bid_dollars?: string | number | null;
  close_time?: string | null;
  url?: string | null;
  status?: string | null;
  volume_fp?: string | number | null;
};

export interface KalshiMarketDataClient {
  searchMarkets(query: string, maxResults: number): Promise<KalshiMarketSearchResult[]>;
}

const KALSHI_PROVIDER_MIN_QUERY_CANDIDATES = 40;
const KALSHI_PROVIDER_MAX_QUERY_CANDIDATES = 80;

function normalizeKalshiProbability(value: string | number | null | undefined): string {
  if (value == null) {
    return "0";
  }

  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return "0";
  }

  if (numeric > 1) {
    return String(Math.max(0, Math.min(1, numeric / 100)));
  }

  return String(Math.max(0, Math.min(1, numeric)));
}

function normalizeKalshiStatus(value: string | null | undefined): NormalizedMarketCandidate["provider_status"] {
  switch (value) {
    case "open":
    case "active":
      return "open";
    case "closed":
      return "closed";
    case "resolved":
    case "settled":
      return "resolved";
    default:
      return "unknown";
  }
}

export class KalshiMarketContextProviderAdapter implements MarketContextProviderAdapter {
  readonly provider_key = "kalshi" as const;

  constructor(
    private readonly client: KalshiMarketDataClient,
    private readonly baseMarketUrl = "https://kalshi.com/markets",
  ) {}

  async searchMarkets(input: ProviderMarketSearchInput): Promise<{
    candidates: NormalizedMarketCandidate[];
    recall_documents: MarketRecallDocument[];
    diagnostics: ProviderSearchDiagnostics;
  }> {
    const queries =
      input.search_queries.length > 0
        ? input.search_queries
        : [input.claim_candidate.normalized_claim_text];
    const queryResults = await Promise.all(
      queries.map(async (query) => {
        const queryResultLimit = Math.min(
          KALSHI_PROVIDER_MAX_QUERY_CANDIDATES,
          Math.max(KALSHI_PROVIDER_MIN_QUERY_CANDIDATES, input.max_results * 8),
        );
        try {
          return {
            query,
            queryResultLimit,
            results: await this.client.searchMarkets(query, queryResultLimit),
            failed: false,
          };
        } catch {
          return {
            query,
            queryResultLimit,
            results: [],
            failed: true,
          };
        }
      }),
    );
    const rawResults = queryResults.flatMap((entry) => entry.results);
    const deduped = rawResults
      .map((result) => ({
        provider_key: this.provider_key,
        provider_market_id: result.ticker,
        provider_event_id: result.event_ticker ?? null,
        question: result.title,
        market_url:
          result.url ?? `${this.baseMarketUrl}/${String(result.ticker).toLowerCase()}`,
        outcome_yes_price: normalizeKalshiProbability(result.yes_bid_dollars),
        liquidity_score:
          result.volume_fp == null || Number.isNaN(Number(result.volume_fp))
            ? null
            : Number(result.volume_fp),
        resolve_date: result.close_time ?? null,
        provider_status: normalizeKalshiStatus(result.status),
        raw_payload_ref: null,
        relevance: computeProviderRelevance(
          input,
          [result.title, result.subtitle ?? "", result.event_ticker ?? "", result.ticker].join(" "),
        ),
      }))
      .filter(
        (result, index, all) =>
          all.findIndex(
            (candidate) => candidate.provider_market_id === result.provider_market_id,
          ) === index,
      );
    const postClaimFilter = deduped.filter((result) =>
        isClaimTypeCandidateAllowed({
          searchInput: input,
          question: result.question,
          resolveDate: result.resolve_date,
        }),
      );
    const postStatusFilter = postClaimFilter.filter((result) => result.provider_status === "open");
    const recallDocuments = postStatusFilter.map((result) =>
      toRecallDocument(
        result,
        [result.provider_event_id ?? "", result.provider_market_id].join(" "),
      ),
    );
    const postRelevanceFilter = postStatusFilter.filter(
      (result) => result.relevance >= getProviderRelevanceThreshold(input),
    );
    const candidates = postRelevanceFilter
      .sort((left, right) => right.relevance - left.relevance)
      .slice(0, input.max_results)
      .map(({ relevance: _relevance, ...result }) => result);

    return {
      candidates,
      recall_documents: recallDocuments,
      diagnostics: {
        provider_key: this.provider_key,
        query_result_limit: queryResults[0]?.queryResultLimit ?? undefined,
        raw_result_count_by_query: queryResults.map((entry) => ({
          query: entry.query,
          count: entry.results.length,
          failed: entry.failed,
        })),
        raw_result_count: rawResults.length,
        failed_query_count: queryResults.filter((entry) => entry.failed).length,
        deduped_count: deduped.length,
        post_claim_filter_count: postClaimFilter.length,
        post_status_filter_count: postStatusFilter.length,
        post_relevance_filter_count: postRelevanceFilter.length,
        returned_count: candidates.length,
      },
    };
  }
}

type KalshiGetMarketsResponse = {
  markets?: Array<{
    ticker: string;
    event_ticker?: string | null;
    title?: string | null;
    subtitle?: string | null;
    yes_bid_dollars?: string | number | null;
    last_price_dollars?: string | number | null;
    close_time?: string | null;
    status?: string | null;
    volume_fp?: string | number | null;
  }>;
  cursor?: string | null;
};

const KALSHI_OPEN_MARKET_CORPUS_PAGE_LIMIT = 5;
const KALSHI_OPEN_MARKET_PAGE_SIZE = 1000;

function normalizeSearchText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

function extractNumericTokens(value: string): string[] {
  const matches = value.match(/\b\d+(?:\.\d+)?\b/g);
  return matches ?? [];
}

function tokenOverlapScore(query: string, document: string): number {
  const queryTokens = new Set(tokenizeMeaningful(query));
  const documentTokens = new Set(tokenizeMeaningful(document));

  if (queryTokens.size === 0 || documentTokens.size === 0) {
    return 0;
  }

  let overlap = 0;
  for (const token of queryTokens) {
    if (documentTokens.has(token)) {
      overlap += 1;
    }
  }

  return overlap / Math.max(queryTokens.size, documentTokens.size);
}

function numericOverlapScore(query: string, document: string): number {
  const queryNumbers = new Set(extractNumericTokens(query));
  const documentNumbers = new Set(extractNumericTokens(document));

  if (queryNumbers.size === 0 || documentNumbers.size === 0) {
    return 0;
  }

  let overlap = 0;
  for (const value of queryNumbers) {
    if (documentNumbers.has(value)) {
      overlap += 1;
    }
  }

  return overlap / queryNumbers.size;
}

function scoreKalshiDocument(query: string, market: KalshiMarketSearchResult): number {
  const titleText = [market.title, market.subtitle ?? ""].join(" ").trim();
  const metadataText = [market.event_ticker ?? "", market.ticker].join(" ").trim();
  const fullText = [titleText, metadataText].join(" ").trim();
  const normalizedQuery = normalizeSearchText(query);
  const normalizedTitle = normalizeSearchText(titleText);
  const normalizedFullText = normalizeSearchText(fullText);
  const phraseBoost =
    normalizedQuery.length >= 10 && normalizedFullText.includes(normalizedQuery) ? 0.35 : 0;
  const titleScore = tokenOverlapScore(query, titleText);
  const fullScore = tokenOverlapScore(query, fullText);
  const numberScore = numericOverlapScore(query, fullText);

  return Math.max(
    titleScore * 0.7 + fullScore * 0.3 + phraseBoost + numberScore * 0.2,
    normalizedTitle.includes(normalizedQuery) ? 0.9 : 0,
  );
}

export class FetchKalshiMarketDataClient implements KalshiMarketDataClient {
  private openMarketsPromise: Promise<KalshiMarketSearchResult[]> | null = null;

  constructor(
    private readonly baseUrl: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private async getOpenMarkets(): Promise<KalshiMarketSearchResult[]> {
    if (this.openMarketsPromise) {
      return this.openMarketsPromise;
    }

    this.openMarketsPromise = this.fetchOpenMarkets();
    return this.openMarketsPromise;
  }

  private async fetchOpenMarkets(): Promise<KalshiMarketSearchResult[]> {
    const normalizedBaseUrl = this.baseUrl.endsWith("/") ? this.baseUrl : `${this.baseUrl}/`;
    const markets = new Map<string, KalshiMarketSearchResult>();
    let cursor: string | null = null;
    let pageCount = 0;

    while (pageCount < KALSHI_OPEN_MARKET_CORPUS_PAGE_LIMIT) {
      const url = new URL("markets", normalizedBaseUrl);
      url.searchParams.set("status", "open");
      url.searchParams.set("mve_filter", "exclude");
      url.searchParams.set("limit", String(KALSHI_OPEN_MARKET_PAGE_SIZE));
      if (cursor) {
        url.searchParams.set("cursor", cursor);
      }

      const response = await this.fetchImpl(url.toString(), {
        headers: {
          Accept: "application/json",
        },
      });

      if (!response.ok) {
        throw new Error(`Kalshi market search failed with status ${response.status}`);
      }

      const payload = (await response.json()) as KalshiGetMarketsResponse;
      const pageMarkets = payload.markets ?? [];

      for (const market of pageMarkets) {
        markets.set(market.ticker, {
          ticker: market.ticker,
          event_ticker: market.event_ticker ?? null,
          title: market.title ?? market.subtitle ?? market.ticker,
          subtitle: market.subtitle ?? null,
          yes_bid_dollars: market.yes_bid_dollars ?? market.last_price_dollars ?? null,
          close_time: market.close_time ?? null,
          status: market.status ?? null,
          volume_fp: market.volume_fp ?? null,
          url: null,
        });
      }

      cursor = payload.cursor ?? null;
      pageCount += 1;
      if (!cursor) {
        break;
      }
    }

    return Array.from(markets.values());
  }

  async searchMarkets(query: string, maxResults: number): Promise<KalshiMarketSearchResult[]> {
    const markets = await this.getOpenMarkets();

    return markets
      .map((market) => ({
        ...market,
        score: scoreKalshiDocument(query, market),
      }))
      .filter((market) => market.score > 0)
      .sort((left, right) => {
        if (right.score !== left.score) {
          return right.score - left.score;
        }

        const rightVolume = Number(right.volume_fp ?? 0);
        const leftVolume = Number(left.volume_fp ?? 0);
        return rightVolume - leftVolume;
      })
      .slice(0, maxResults)
      .map(({ score: _score, ...market }) => market);
  }
}
