import type { Env } from "../../types/env";
import { resolveMarketContextConfig } from "./config";
import { OpenRouterMarketContextExtractionClient } from "./client";
import {
  FirecrawlMarketContextPageFetcher,
  JinaReaderMarketContextPageFetcher,
} from "./fetchers";
import { MarketContextProviderRegistry } from "./providers";
import { EmbeddingBackedMarketContextRecallIndex } from "./recall";
import {
  FetchKalshiMarketDataClient,
  KalshiMarketContextProviderAdapter,
} from "./providers/kalshi";
import {
  FetchPolymarketMarketDataClient,
  PolymarketMarketContextProviderAdapter,
} from "./providers/polymarket";
import { MarketContextMatchWorker } from "./worker";
import type { MarketContextStore } from "./types";

export function createDefaultMarketContextWorker(input: {
  env: Env;
  store: MarketContextStore;
  fetchImpl?: typeof fetch;
}): MarketContextMatchWorker {
  const fetchImpl = input.fetchImpl ?? fetch;
  const config = resolveMarketContextConfig(input.env);
  const pageFetcher =
    config.fetcher === "firecrawl"
      ? new FirecrawlMarketContextPageFetcher(
          config.firecrawlBaseUrl,
          config.firecrawlApiKey ?? "",
          fetchImpl,
        )
      : new JinaReaderMarketContextPageFetcher(
          config.jinaReaderBaseUrl,
          config.jinaApiKey,
          fetchImpl,
        );

  if (config.fetcher === "firecrawl" && !config.firecrawlApiKey) {
    throw new Error("Missing FIRECRAWL_API_KEY");
  }

  const openRouterClient = new OpenRouterMarketContextExtractionClient(
    config.openRouterBaseUrl,
    config.openRouterApiKey,
    config.extractionModel,
    config.rerankModel,
    config.embeddingModel,
    config.openRouterTimeoutMs,
    fetchImpl,
  );
  const providers = new MarketContextProviderRegistry([
    new KalshiMarketContextProviderAdapter(
      new FetchKalshiMarketDataClient(config.kalshiApiBaseUrl, fetchImpl),
    ),
    new PolymarketMarketContextProviderAdapter(
      new FetchPolymarketMarketDataClient(config.polymarketApiBaseUrl, fetchImpl),
    ),
  ]);

  return new MarketContextMatchWorker(
    input.store,
    pageFetcher,
    openRouterClient,
    openRouterClient,
    providers,
    config.recallEnabled ? new EmbeddingBackedMarketContextRecallIndex(openRouterClient) : null,
    config,
  );
}
