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
  toRecallDocument,
} from "./shared";

export type PolymarketMarketSearchResult = {
  id: string;
  event_id?: string | null;
  question: string;
  url?: string | null;
  end_date_iso?: string | null;
  outcome_yes_price?: string | number | null;
  liquidity?: string | number | null;
  active?: boolean | null;
  closed?: boolean | null;
};

export interface PolymarketMarketDataClient {
  searchMarkets(query: string, maxResults: number): Promise<PolymarketMarketSearchResult[]>;
}

function normalizeProbability(value: string | number | null | undefined): string {
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

function normalizeStatus(result: PolymarketMarketSearchResult): NormalizedMarketCandidate["provider_status"] {
  if (result.closed) {
    return "closed";
  }

  if (result.active) {
    return "open";
  }

  return "unknown";
}

export class PolymarketMarketContextProviderAdapter implements MarketContextProviderAdapter {
  readonly provider_key = "polymarket" as const;

  constructor(
    private readonly client: PolymarketMarketDataClient,
    private readonly baseMarketUrl = "https://polymarket.com/event",
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
        try {
          return {
            query,
            results: await this.client.searchMarkets(query, Math.max(input.max_results, 6)),
            failed: false,
          };
        } catch {
          return {
            query,
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
        provider_market_id: result.id,
        provider_event_id: result.event_id ?? null,
        question: result.question,
        market_url: result.url ?? `${this.baseMarketUrl}/${result.id}`,
        outcome_yes_price: normalizeProbability(result.outcome_yes_price),
        liquidity_score:
          result.liquidity == null || Number.isNaN(Number(result.liquidity))
            ? null
            : Number(result.liquidity),
        resolve_date: result.end_date_iso ?? null,
        provider_status: normalizeStatus(result),
        raw_payload_ref: null,
        relevance: computeProviderRelevance(input, result.question),
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
    const recallDocuments = postStatusFilter.map((result) => toRecallDocument(result));
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

type PolymarketPublicSearchResponse = {
  markets?: Array<{
    id: string;
    event_id?: string | null;
    question?: string | null;
    slug?: string | null;
    endDate?: string | null;
    end_date_iso?: string | null;
    outcomes?: string | null;
    outcomePrices?: string | null;
    active?: boolean | null;
    closed?: boolean | null;
    liquidity?: string | number | null;
  }>;
  events?: Array<{
    id: string;
    title?: string | null;
    slug?: string | null;
    markets?: Array<{
      id: string;
      question?: string | null;
      endDate?: string | null;
      active?: boolean | null;
      closed?: boolean | null;
      liquidity?: string | number | null;
      outcomes?: string | null;
      outcomePrices?: string | null;
    }> | null;
  }>;
};

function parseOutcomeYesPrice(
  outcomes: string | null | undefined,
  outcomePrices: string | null | undefined,
): string | null {
  if (!outcomes || !outcomePrices) {
    return null;
  }

  try {
    const parsedOutcomes = JSON.parse(outcomes) as string[];
    const parsedPrices = JSON.parse(outcomePrices) as string[];
    const yesIndex = parsedOutcomes.findIndex((outcome) => outcome.toLowerCase() === "yes");
    if (yesIndex === -1 || yesIndex >= parsedPrices.length) {
      return null;
    }

    return normalizeProbability(parsedPrices[yesIndex]);
  } catch {
    return null;
  }
}

export class FetchPolymarketMarketDataClient implements PolymarketMarketDataClient {
  constructor(
    private readonly baseUrl: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async searchMarkets(query: string, maxResults: number): Promise<PolymarketMarketSearchResult[]> {
    const url = new URL("/public-search", this.baseUrl);
    url.searchParams.set("q", query);
    url.searchParams.set("limit_per_type", String(maxResults));
    url.searchParams.set("search_profiles", "false");
    url.searchParams.set("cache", "true");

    const response = await this.fetchImpl(url.toString(), {
      headers: {
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      throw new Error(`Polymarket search failed with status ${response.status}`);
    }

    const payload = (await response.json()) as PolymarketPublicSearchResponse;
    const directMarkets =
      payload.markets?.map((market) => ({
        id: market.id,
        event_id: market.event_id ?? null,
        question: market.question ?? "",
        url: market.slug ? `https://polymarket.com/event/${market.slug}` : null,
        end_date_iso: market.end_date_iso ?? market.endDate ?? null,
        outcome_yes_price: parseOutcomeYesPrice(market.outcomes, market.outcomePrices),
        liquidity: market.liquidity ?? null,
        active: market.active ?? null,
        closed: market.closed ?? null,
      })) ?? [];

    const eventMarkets =
      payload.events?.flatMap((event) =>
        (event.markets ?? []).map((market) => ({
          id: market.id,
          event_id: event.id,
          question: market.question ?? event.title ?? "",
          url: event.slug ? `https://polymarket.com/event/${event.slug}` : null,
          end_date_iso: market.endDate ?? null,
          outcome_yes_price: parseOutcomeYesPrice(market.outcomes, market.outcomePrices),
          liquidity: market.liquidity ?? null,
          active: market.active ?? null,
          closed: market.closed ?? null,
        })),
      ) ?? [];

    const deduped = new Map<string, PolymarketMarketSearchResult>();
    for (const market of [...directMarkets, ...eventMarkets]) {
      deduped.set(market.id, market);
    }

    return Array.from(deduped.values()).slice(0, maxResults);
  }
}
