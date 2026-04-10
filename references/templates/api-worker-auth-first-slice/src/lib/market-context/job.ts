import type { Env } from "../../types/env";
import type { MarketContextJobPayload, MarketContextJobResult, MarketContextStore } from "./types";
import { createDefaultMarketContextWorker } from "./runtime";

export async function runMarketContextMatchJob(input: {
  payload: MarketContextJobPayload;
  env: Env;
  store: MarketContextStore;
  now?: Date;
  fetchImpl?: typeof fetch;
}): Promise<MarketContextJobResult> {
  const worker = createDefaultMarketContextWorker({
    env: input.env,
    store: input.store,
    fetchImpl: input.fetchImpl,
  });

  return worker.process(input.payload, input.now);
}

