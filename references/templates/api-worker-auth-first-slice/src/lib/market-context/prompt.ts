import type { ClaimExtractionInput, MarketRerankInput } from "./types";

export const MARKET_CONTEXT_EXTRACTION_SYSTEM_PROMPT = `You extract externally resolvable claim candidates from a link post for market-context matching.

Return only JSON matching the provided schema.

Rules:
- Extract only discrete, time-bounded, externally resolvable claims.
- Prefer abstention over weak guesses.
- If the content is broad framing, ideology, opinion, outrage bait, or propaganda without a concrete resolvable claim, return should_attach=false.
- Do not judge whether the claim is true.
- Do not search for markets.
- Do not invent dates, entities, or thresholds that are not reasonably implied by the source.
- Normalize claims into short, provider-search-friendly language.
- When a Published at timestamp is provided, resolve relative references like today, tomorrow, Wednesday, this afternoon, and article day into absolute timeframe.start_at and timeframe.end_at values when reasonably inferable.
- When multiple concrete claims exist, return up to 3 ordered by relevance to the post.
- For macro claims, preserve the specific policy action and the exact target or range when present.
- For macro claims about central banks or rates, normalized_claim_text should keep the actor, the action verb, the target or range, and the meeting or decision date when inferable.
- For macro claims, prefer a single precise decision claim such as "Fed expected to hold target rate at 3.50%-3.75% on 2026-03-18" over vague variants like "Fed decision Wednesday."
- Do not split one macro decision into multiple weaker paraphrases if one stronger claim captures the actual decision.
- Avoid generic verbs like discuss, comment, share details, signal, or respond unless the article's primary resolvable claim is actually about that speech or statement.
- When a claim includes both an action and a quantitative threshold or range, keep both in claim_text and normalized_claim_text.`;

export const MARKET_CONTEXT_EXTRACTION_JSON_SCHEMA = {
  name: "market_context_claim_extraction",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["should_attach", "confidence", "reason", "claim_candidates"],
    properties: {
      should_attach: {
        type: "boolean",
        description:
          "Whether the content contains at least one concrete claim worth searching against prediction-market providers.",
      },
      confidence: {
        type: "number",
        minimum: 0,
        maximum: 1,
        description: "Model confidence in the abstain-vs-attach judgment.",
      },
      reason: {
        type: "string",
        enum: [
          "clear_resolvable_claim",
          "multiple_resolvable_claims",
          "too_vague",
          "opinion_or_analysis",
          "propaganda_or_framing_without_claim",
          "insufficient_source_text",
          "non_news_content",
        ],
      },
      claim_candidates: {
        type: "array",
        maxItems: 3,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["claim_text", "normalized_claim_text", "claim_type", "entities", "timeframe"],
          properties: {
            claim_text: {
              type: "string",
              description: "Natural-language claim stated as directly as possible.",
            },
            normalized_claim_text: {
              type: "string",
              description: "Short search-oriented normalized claim.",
            },
            claim_type: {
              type: "string",
              enum: [
                "election",
                "legislation",
                "macro",
                "company_milestone",
                "asset_price",
                "sports",
                "court_case",
                "policy",
                "other",
              ],
            },
            entities: {
              type: "array",
              items: {
                type: "string",
              },
            },
            timeframe: {
              type: "object",
              additionalProperties: false,
              required: ["kind", "label", "start_at", "end_at"],
              properties: {
                kind: {
                  type: "string",
                  enum: ["explicit_date", "date_range", "event_window", "none"],
                },
                label: {
                  type: "string",
                },
                start_at: {
                  type: ["string", "null"],
                  format: "date-time",
                  default: null,
                },
                end_at: {
                  type: ["string", "null"],
                  format: "date-time",
                  default: null,
                },
              },
            },
          },
        },
      },
    },
  },
} as const;

export const MARKET_CONTEXT_RERANK_SYSTEM_PROMPT = `You rerank candidate prediction-market questions against a single extracted claim from a post.

Return only JSON matching the provided schema.

Rules:
- Select only markets that are genuinely close matches to the claim.
- Prefer abstention over approximate or narrative-adjacent matches.
- Prefer markets with the same entities and the closest decision or resolution framing.
- Do not invent markets.
- Do not judge whether the claim is true.
- Return at most 3 selections, ordered best to worst.`;

export const MARKET_CONTEXT_RERANK_JSON_SCHEMA = {
  name: "market_context_market_rerank",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["should_attach", "confidence", "selections"],
    properties: {
      should_attach: {
        type: "boolean",
      },
      confidence: {
        type: "number",
        minimum: 0,
        maximum: 1,
      },
      selections: {
        type: "array",
        maxItems: 3,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["provider_key", "provider_market_id", "relevance_score"],
          properties: {
            provider_key: {
              type: "string",
            },
            provider_market_id: {
              type: "string",
            },
            relevance_score: {
              type: "number",
              minimum: 0,
              maximum: 1,
            },
          },
        },
      },
    },
  },
} as const;

export function buildMarketContextExtractionUserPrompt(input: ClaimExtractionInput): string {
  return `Extract market-matchable claim candidates from this post and linked page.

Post title:
${input.post_title ?? ""}

Link URL:
${input.link_url}

Fetched page title:
${input.fetched_page.title ?? ""}

Meta description:
${input.fetched_page.meta_description ?? ""}

Published at:
${input.fetched_page.published_at ?? ""}

Excerpt:
${input.fetched_page.excerpt ?? ""}

Cleaned page text:
${input.fetched_page.content_text ?? ""}

Extraction guidance:
- Return the strongest market-matchable claim first.
- For macro or central-bank stories, preserve the decision verb, rate level or range, and meeting date in the first claim candidate.
- Avoid returning a generic "decision" claim if the article states the actual expected action or target range.`;
}

export function buildMarketContextRerankUserPrompt(input: MarketRerankInput): string {
  const candidates = input.candidates
    .map(
      (candidate, index) =>
        `${index + 1}. provider=${candidate.provider_key}; market_id=${candidate.provider_market_id}; question=${candidate.question}; resolve_date=${candidate.resolve_date ?? ""}; status=${candidate.provider_status}`,
    )
    .join("\n");

  return `Rerank candidate markets for this extracted claim.

Claim text:
${input.claim_candidate.claim_text}

Normalized claim:
${input.claim_candidate.normalized_claim_text}

Claim type:
${input.claim_candidate.claim_type}

Entities:
${input.claim_candidate.entities.join(", ")}

Timeframe:
${input.claim_candidate.timeframe.label}

Candidate markets:
${candidates}`;
}
