import type {
  ClaimCandidate,
  ClaimExtractionReason,
  NormalizedMarketCandidate,
  ScoredMarketCandidate,
} from "./types";

function clamp01(value: number): number {
  if (Number.isNaN(value) || !Number.isFinite(value)) {
    return 0;
  }

  if (value <= 0) {
    return 0;
  }

  if (value >= 1) {
    return 1;
  }

  return value;
}

function normalizeText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

function tokenize(value: string): string[] {
  if (!value.trim()) {
    return [];
  }

  return normalizeText(value)
    .split(" ")
    .filter((token) => token.length > 1);
}

function includesAny(value: string, patterns: string[]): boolean {
  return patterns.some((pattern) => value.includes(pattern));
}

function detectAssetKey(text: string): string | null {
  if (includesAny(text, ["bitcoin", "btc"])) {
    return "bitcoin";
  }
  if (includesAny(text, ["ether", "ethereum", "eth"])) {
    return "ether";
  }
  if (includesAny(text, ["oil", "wti", "brent"])) {
    return "oil";
  }
  if (includesAny(text, ["gold"])) {
    return "gold";
  }

  return null;
}

export function computeTokenOverlapSimilarity(left: string, right: string): number {
  const leftTokens = new Set(tokenize(left));
  const rightTokens = new Set(tokenize(right));

  if (leftTokens.size === 0 || rightTokens.size === 0) {
    return 0;
  }

  let overlap = 0;

  for (const token of leftTokens) {
    if (rightTokens.has(token)) {
      overlap += 1;
    }
  }

  const denominator = Math.max(leftTokens.size, rightTokens.size);
  return clamp01(overlap / denominator);
}

export function computeClaimSemanticSimilarity(
  claimCandidate: ClaimCandidate,
  marketQuestion: string,
): number {
  const candidates = [
    claimCandidate.normalized_claim_text,
    claimCandidate.claim_text,
    ...claimCandidate.entities,
  ].filter(Boolean);

  let best = 0;
  for (const candidate of candidates) {
    best = Math.max(best, computeTokenOverlapSimilarity(candidate, marketQuestion));
  }

  return best;
}

export function computeEntityOverlap(entities: string[], marketQuestion: string): number {
  if (entities.length === 0) {
    return 0;
  }

  const normalizedQuestion = normalizeText(marketQuestion);
  let matches = 0;

  for (const entity of entities) {
    if (normalizedQuestion.includes(normalizeText(entity))) {
      matches += 1;
    }
  }

  return clamp01(matches / entities.length);
}

export function computeTimeframeFit(
  timeframe: ClaimCandidate["timeframe"],
  resolveDate: string | null,
): number {
  if (timeframe.kind === "none") {
    return resolveDate ? 0.5 : 1;
  }

  if (!resolveDate) {
    return 0.25;
  }

  const resolveTs = Date.parse(resolveDate);
  const startTs = timeframe.start_at ? Date.parse(timeframe.start_at) : Number.NaN;
  const endTs = timeframe.end_at ? Date.parse(timeframe.end_at) : Number.NaN;

  if (!Number.isNaN(startTs) && !Number.isNaN(endTs)) {
    if (resolveTs >= startTs && resolveTs <= endTs) {
      return 1;
    }

    return 0;
  }

  if (!Number.isNaN(endTs)) {
    return resolveTs <= endTs ? 1 : 0;
  }

  return 0.5;
}

export function computeSourceSpecificity(reason: ClaimExtractionReason): number {
  switch (reason) {
    case "clear_resolvable_claim":
      return 1;
    case "multiple_resolvable_claims":
      return 0.7;
    case "too_vague":
    case "opinion_or_analysis":
    case "propaganda_or_framing_without_claim":
    case "insufficient_source_text":
    case "non_news_content":
      return 0.2;
  }
}

export function computeClaimShapeFit(
  claimCandidate: ClaimCandidate,
  marketQuestion: string,
): number {
  const claimText = normalizeText(
    `${claimCandidate.claim_text} ${claimCandidate.normalized_claim_text}`,
  );
  const question = normalizeText(marketQuestion);

  if (claimCandidate.claim_type === "sports") {
    const claimIsWinnerMarket =
      includesAny(claimText, ["winner", "favorite", "to win", "win the masters", "outright"]) ||
      (claimText.includes("masters") && claimText.includes("odds"));
    const questionIsWinnerMarket =
      includesAny(question, [" win ", "winner", "tournament", "masters"]) &&
      !includesAny(question, ["round", "3 ball", "3-ball", "bogey", "eagle", "score", "shot under"]);

    if (claimIsWinnerMarket) {
      return questionIsWinnerMarket ? 1 : 0;
    }

    const claimIsDraftTopFive = includesAny(claimText, ["top five", "top-five", "top 5"]);
    const questionIsDraftTopFive = includesAny(question, ["top five", "top-five", "top 5"]);
    const questionIsExactDraftSlot = includesAny(question, ["first pick", "second pick", "third pick", "fourth pick", "fifth pick"]);

    if (claimIsDraftTopFive) {
      if (questionIsDraftTopFive) {
        return 1;
      }

      if (questionIsExactDraftSlot) {
        return 0;
      }

      return 0.15;
    }
  }

  if (claimCandidate.claim_type === "asset_price") {
    const claimIsPriceThreshold = /(?:above|below|over|under|topped|traded above|traded below|\$?\d)/.test(
      claimText,
    );
    const claimAsset = detectAssetKey(claimText);
    const questionAsset = detectAssetKey(question);
    const questionIsPriceThreshold = includesAny(question, [
      "price",
      "settle",
      "above",
      "below",
      "over",
      "under",
      "btc",
      "bitcoin",
      "eth",
      "ether",
    ]);
    const questionIsGenericMention = includesAny(question, [
      "say crypto",
      "say bitcoin",
      "press briefing",
    ]);

    if (claimIsPriceThreshold) {
      if (claimAsset && questionAsset && claimAsset !== questionAsset) {
        return 0;
      }

      if (questionIsGenericMention) {
        return 0.05;
      }

      return questionIsPriceThreshold ? 1 : 0.1;
    }
  }

  return 0.5;
}

export function scoreMarketCandidate(input: {
  claimCandidate: ClaimCandidate;
  marketCandidate: NormalizedMarketCandidate;
  sourceSpecificity: number;
  providerQuality: number;
  semanticSimilarity?: number;
}): ScoredMarketCandidate {
  const semanticSimilarity =
    input.semanticSimilarity ??
    computeClaimSemanticSimilarity(input.claimCandidate, input.marketCandidate.question);

  const timeframeFit = computeTimeframeFit(
    input.claimCandidate.timeframe,
    input.marketCandidate.resolve_date,
  );
  const entityOverlap = computeEntityOverlap(
    input.claimCandidate.entities,
    input.marketCandidate.question,
  );
  const claimShapeFit = computeClaimShapeFit(
    input.claimCandidate,
    input.marketCandidate.question,
  );
  const adjustedSemanticSimilarity =
    semanticSimilarity * (0.25 + 0.75 * clamp01(claimShapeFit));
  const sourceSpecificity = clamp01(input.sourceSpecificity);
  const providerQuality = clamp01(input.providerQuality);

  const finalScore =
    0.35 * adjustedSemanticSimilarity +
    0.2 * timeframeFit +
    0.15 * entityOverlap +
    0.1 * claimShapeFit +
    0.1 * sourceSpecificity +
    0.1 * providerQuality;

  return {
    claim_candidate: input.claimCandidate,
    market_candidate: input.marketCandidate,
    semantic_similarity: clamp01(semanticSimilarity),
    timeframe_fit: clamp01(timeframeFit),
    entity_overlap: clamp01(entityOverlap),
    claim_shape_fit: clamp01(claimShapeFit),
    source_specificity: sourceSpecificity,
    provider_quality: providerQuality,
    final_score: clamp01(finalScore),
  };
}

export function selectTopScoredMarkets(input: {
  scoredCandidates: ScoredMarketCandidate[];
  maxMarketsPerPost: number;
  minSemanticSimilarity: number;
  minFinalScore: number;
}): ScoredMarketCandidate[] {
  const filtered = input.scoredCandidates
    .filter((candidate) => candidate.market_candidate.provider_status === "open")
    .filter((candidate) => candidate.semantic_similarity >= input.minSemanticSimilarity)
    .filter((candidate) => candidate.final_score >= input.minFinalScore)
    .sort((left, right) => right.final_score - left.final_score);

  const selected: ScoredMarketCandidate[] = [];
  const seenProviderMarkets = new Set<string>();

  for (const candidate of filtered) {
    const dedupeKey = `${candidate.market_candidate.provider_key}:${candidate.market_candidate.provider_market_id}`;

    if (seenProviderMarkets.has(dedupeKey)) {
      continue;
    }

    seenProviderMarkets.add(dedupeKey);
    selected.push(candidate);

    if (selected.length >= input.maxMarketsPerPost) {
      break;
    }
  }

  return selected;
}
