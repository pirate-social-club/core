import type { MarketContextProviderAdapter, MarketContextProviderKey } from "./types";

export class MarketContextProviderRegistry {
  private readonly adapters = new Map<MarketContextProviderKey, MarketContextProviderAdapter>();

  constructor(adapters: MarketContextProviderAdapter[]) {
    for (const adapter of adapters) {
      this.adapters.set(adapter.provider_key, adapter);
    }
  }

  get(providerKey: MarketContextProviderKey): MarketContextProviderAdapter {
    const adapter = this.adapters.get(providerKey);
    if (!adapter) {
      throw new Error(`Missing market-context provider adapter for ${providerKey}`);
    }

    return adapter;
  }

  list(): MarketContextProviderAdapter[] {
    return Array.from(this.adapters.values());
  }
}

