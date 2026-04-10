import type {
  MarketContextExtractionClient,
  MarketContextRerankClient,
  MarketContextEmbeddingClient,
  ClaimExtractionInput,
  ClaimExtractionOutput,
  MarketRerankInput,
  MarketRerankOutput,
} from "./types";
import {
  buildMarketContextEmbeddingRequest,
  buildMarketContextExtractionRequest,
  buildMarketContextRerankRequest,
} from "./openrouter";

type OpenRouterChoice = {
  message?: {
    content?: unknown;
  };
};

type OpenRouterResponse = {
  choices?: OpenRouterChoice[];
};

type OpenRouterEmbeddingResponse = {
  data?: Array<{
    embedding?: number[];
  }>;
};

function parseStructuredContent<T>(content: unknown): T {
  if (typeof content === "string") {
    return JSON.parse(content) as T;
  }

  if (Array.isArray(content)) {
    const text = content
      .map((part) => {
        if (typeof part === "string") {
          return part;
        }

        if (part && typeof part === "object" && "text" in part && typeof part.text === "string") {
          return part.text;
        }

        return "";
      })
      .join("");

    return JSON.parse(text) as T;
  }

  if (content && typeof content === "object") {
    return content as T;
  }

  throw new Error("OpenRouter response did not contain structured content");
}

export class OpenRouterMarketContextExtractionClient
  implements MarketContextExtractionClient, MarketContextRerankClient, MarketContextEmbeddingClient
{
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
    private readonly extractionModel: string,
    private readonly rerankModel: string,
    private readonly embeddingModel: string,
    private readonly timeoutMs: number,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private async sendStructuredRequest<T>(input: {
    body: unknown;
    errorPrefix: string;
  }): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await this.fetchImpl(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(input.body),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(
          `${input.errorPrefix} failed with status ${response.status}: ${errorBody}`,
        );
      }

      const payload = (await response.json()) as OpenRouterResponse;
      const content = payload.choices?.[0]?.message?.content;

      return parseStructuredContent<T>(content);
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error(`${input.errorPrefix} timed out after ${this.timeoutMs}ms`);
      }

      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  private async sendEmbeddingRequest(input: { texts: string[] }): Promise<number[][]> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await this.fetchImpl(`${this.baseUrl}/embeddings`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(
          buildMarketContextEmbeddingRequest(this.embeddingModel, input),
        ),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(
          `OpenRouter embedding request failed with status ${response.status}: ${errorBody}`,
        );
      }

      const payload = (await response.json()) as OpenRouterEmbeddingResponse;
      const embeddings =
        payload.data?.map((item) =>
          Array.isArray(item.embedding)
            ? item.embedding.filter((value): value is number => typeof value === "number")
            : [],
        ) ?? [];

      if (embeddings.length !== input.texts.length || embeddings.some((embedding) => embedding.length === 0)) {
        throw new Error("OpenRouter embedding response did not contain embeddings for all inputs");
      }

      return embeddings;
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error(`OpenRouter embedding request timed out after ${this.timeoutMs}ms`);
      }

      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  async extractClaims(input: ClaimExtractionInput): Promise<ClaimExtractionOutput> {
    return this.sendStructuredRequest<ClaimExtractionOutput>({
      body: buildMarketContextExtractionRequest(this.extractionModel, input),
      errorPrefix: "OpenRouter extraction request",
    });
  }

  async rerankMarkets(input: MarketRerankInput): Promise<MarketRerankOutput> {
    return this.sendStructuredRequest<MarketRerankOutput>({
      body: buildMarketContextRerankRequest(this.rerankModel, input),
      errorPrefix: "OpenRouter rerank request",
    });
  }

  async embedTexts(input: { texts: string[] }): Promise<number[][]> {
    return this.sendEmbeddingRequest(input);
  }
}
