import type { ClaimExtractionInput, MarketRerankInput } from "./types";
import {
  buildMarketContextExtractionUserPrompt,
  buildMarketContextRerankUserPrompt,
  MARKET_CONTEXT_EXTRACTION_JSON_SCHEMA,
  MARKET_CONTEXT_EXTRACTION_SYSTEM_PROMPT,
  MARKET_CONTEXT_RERANK_JSON_SCHEMA,
  MARKET_CONTEXT_RERANK_SYSTEM_PROMPT,
} from "./prompt";

export type OpenRouterChatMessage = {
  role: "system" | "user";
  content: string;
};

export type OpenRouterStructuredOutputRequest = {
  model: string;
  messages: OpenRouterChatMessage[];
  provider: {
    require_parameters: true;
  };
  response_format: {
    type: "json_schema";
    json_schema: typeof MARKET_CONTEXT_EXTRACTION_JSON_SCHEMA;
  };
  stream: false;
};

export type OpenRouterRerankStructuredOutputRequest = {
  model: string;
  messages: OpenRouterChatMessage[];
  provider: {
    require_parameters: true;
  };
  response_format: {
    type: "json_schema";
    json_schema: typeof MARKET_CONTEXT_RERANK_JSON_SCHEMA;
  };
  stream: false;
};

export type OpenRouterEmbeddingRequest = {
  model: string;
  input: string[];
  encoding_format: "float";
};

export function buildMarketContextExtractionRequest(
  model: string,
  input: ClaimExtractionInput,
): OpenRouterStructuredOutputRequest {
  return {
    model,
    messages: [
      {
        role: "system",
        content: MARKET_CONTEXT_EXTRACTION_SYSTEM_PROMPT,
      },
      {
        role: "user",
        content: buildMarketContextExtractionUserPrompt(input),
      },
    ],
    provider: {
      require_parameters: true,
    },
    response_format: {
      type: "json_schema",
      json_schema: MARKET_CONTEXT_EXTRACTION_JSON_SCHEMA,
    },
    stream: false,
  };
}

export function buildMarketContextRerankRequest(
  model: string,
  input: MarketRerankInput,
): OpenRouterRerankStructuredOutputRequest {
  return {
    model,
    messages: [
      {
        role: "system",
        content: MARKET_CONTEXT_RERANK_SYSTEM_PROMPT,
      },
      {
        role: "user",
        content: buildMarketContextRerankUserPrompt(input),
      },
    ],
    provider: {
      require_parameters: true,
    },
    response_format: {
      type: "json_schema",
      json_schema: MARKET_CONTEXT_RERANK_JSON_SCHEMA,
    },
    stream: false,
  };
}

export function buildMarketContextEmbeddingRequest(
  model: string,
  input: { texts: string[] },
): OpenRouterEmbeddingRequest {
  return {
    model,
    input: input.texts,
    encoding_format: "float",
  };
}
