import { computeClaimSemanticSimilarity } from "./scoring";
import type {
  ClaimCandidate,
  MarketContextEmbeddingClient,
  MarketContextRecallIndex,
  MarketRecallDocument,
  MarketRecallHit,
  NormalizedMarketCandidate,
} from "./types";

function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((token) => token.length >= 2);
}

function createFeatureMap(value: string): Map<string, number> {
  const tokens = tokenize(value);
  const features = new Map<string, number>();

  for (const token of tokens) {
    features.set(`u:${token}`, (features.get(`u:${token}`) ?? 0) + 1);
  }

  for (let index = 0; index < tokens.length - 1; index += 1) {
    const bigram = `${tokens[index]}_${tokens[index + 1]}`;
    features.set(`b:${bigram}`, (features.get(`b:${bigram}`) ?? 0) + 1.5);
  }

  return features;
}

function cosineSimilarityFromMaps(left: Map<string, number>, right: Map<string, number>): number {
  if (left.size === 0 || right.size === 0) {
    return 0;
  }

  let dot = 0;
  let leftMagnitude = 0;
  let rightMagnitude = 0;

  for (const value of left.values()) {
    leftMagnitude += value * value;
  }

  for (const value of right.values()) {
    rightMagnitude += value * value;
  }

  for (const [feature, leftValue] of left.entries()) {
    const rightValue = right.get(feature);
    if (rightValue != null) {
      dot += leftValue * rightValue;
    }
  }

  if (leftMagnitude === 0 || rightMagnitude === 0) {
    return 0;
  }

  return dot / (Math.sqrt(leftMagnitude) * Math.sqrt(rightMagnitude));
}

function cosineSimilarityFromVectors(left: number[], right: number[]): number {
  if (left.length === 0 || right.length === 0 || left.length !== right.length) {
    return 0;
  }

  let dot = 0;
  let leftMagnitude = 0;
  let rightMagnitude = 0;

  for (let index = 0; index < left.length; index += 1) {
    dot += left[index] * right[index];
    leftMagnitude += left[index] * left[index];
    rightMagnitude += right[index] * right[index];
  }

  if (leftMagnitude === 0 || rightMagnitude === 0) {
    return 0;
  }

  return dot / (Math.sqrt(leftMagnitude) * Math.sqrt(rightMagnitude));
}

function buildClaimRecallText(claimCandidate: ClaimCandidate): string {
  return [
    claimCandidate.claim_text,
    claimCandidate.normalized_claim_text,
    ...claimCandidate.entities,
    claimCandidate.timeframe.label,
    claimCandidate.timeframe.start_at ?? "",
    claimCandidate.timeframe.end_at ?? "",
  ]
    .filter(Boolean)
    .join(" ");
}

function toMarketCandidate(document: MarketRecallDocument): NormalizedMarketCandidate {
  return {
    provider_key: document.provider_key,
    provider_market_id: document.provider_market_id,
    provider_event_id: document.provider_event_id,
    question: document.question,
    market_url: document.market_url,
    outcome_yes_price: document.outcome_yes_price,
    liquidity_score: document.liquidity_score,
    resolve_date: document.resolve_date,
    provider_status: document.provider_status,
    raw_payload_ref: document.raw_payload_ref,
  };
}

function scoreLexicalRecall(input: {
  claim_candidate: ClaimCandidate;
  documents: MarketRecallDocument[];
}): MarketRecallHit[] {
  const claimText = buildClaimRecallText(input.claim_candidate);
  const claimFeatures = createFeatureMap(claimText);

  return input.documents
    .map((document) => {
      const vectorScore = cosineSimilarityFromMaps(
        claimFeatures,
        createFeatureMap(document.document_text),
      );
      const semanticScore = computeClaimSemanticSimilarity(
        input.claim_candidate,
        document.question,
      );

      return {
        market_candidate: toMarketCandidate(document),
        recall_score: Math.max(vectorScore, semanticScore),
      };
    })
    .filter((candidate) => candidate.recall_score > 0);
}

export class InMemoryMarketContextRecallIndex implements MarketContextRecallIndex {
  async search(input: {
    claim_candidate: ClaimCandidate;
    documents: MarketRecallDocument[];
    max_results: number;
  }): Promise<MarketRecallHit[]> {
    if (input.documents.length === 0 || input.max_results <= 0) {
      return [];
    }

    return scoreLexicalRecall(input)
      .sort((left, right) => right.recall_score - left.recall_score)
      .slice(0, input.max_results);
  }
}

export class EmbeddingBackedMarketContextRecallIndex implements MarketContextRecallIndex {
  private embeddingCache = new Map<string, number[]>();
  private lexicalFallback = new InMemoryMarketContextRecallIndex();

  constructor(private readonly embeddingClient: MarketContextEmbeddingClient) {}

  private async getEmbeddings(texts: string[]): Promise<Map<string, number[]>> {
    const results = new Map<string, number[]>();
    const missing = texts.filter((text) => !this.embeddingCache.has(text));

    if (missing.length > 0) {
      const embeddings = await this.embeddingClient.embedTexts({ texts: missing });

      missing.forEach((text, index) => {
        const embedding = embeddings[index];
        if (embedding && embedding.length > 0) {
          this.embeddingCache.set(text, embedding);
        }
      });
    }

    for (const text of texts) {
      const embedding = this.embeddingCache.get(text);
      if (embedding) {
        results.set(text, embedding);
      }
    }

    return results;
  }

  async search(input: {
    claim_candidate: ClaimCandidate;
    documents: MarketRecallDocument[];
    max_results: number;
  }): Promise<MarketRecallHit[]> {
    if (input.documents.length === 0 || input.max_results <= 0) {
      return [];
    }

    const lexicalHits = await this.lexicalFallback.search(input);
    const claimText = buildClaimRecallText(input.claim_candidate);
    const documentTexts = input.documents.map((document) => document.document_text);

    try {
      const embeddings = await this.getEmbeddings([claimText, ...documentTexts]);
      const claimEmbedding = embeddings.get(claimText);

      if (!claimEmbedding) {
        return lexicalHits;
      }

      const lexicalScores = new Map(
        lexicalHits.map((hit) => [
          `${hit.market_candidate.provider_key}:${hit.market_candidate.provider_market_id}`,
          hit.recall_score,
        ]),
      );

      return input.documents
        .map((document) => {
          const documentEmbedding = embeddings.get(document.document_text);
          const embeddingScore = documentEmbedding
            ? cosineSimilarityFromVectors(claimEmbedding, documentEmbedding)
            : 0;
          const lexicalScore =
            lexicalScores.get(`${document.provider_key}:${document.provider_market_id}`) ?? 0;
          const semanticScore = computeClaimSemanticSimilarity(
            input.claim_candidate,
            document.question,
          );

          return {
            market_candidate: toMarketCandidate(document),
            recall_score: Math.max(
              embeddingScore,
              lexicalScore,
              semanticScore,
            ),
          };
        })
        .filter((candidate) => candidate.recall_score > 0)
        .sort((left, right) => right.recall_score - left.recall_score)
        .slice(0, input.max_results);
    } catch {
      return lexicalHits;
    }
  }
}
