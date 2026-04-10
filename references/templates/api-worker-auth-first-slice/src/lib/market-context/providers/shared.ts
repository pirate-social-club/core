import type {
  MarketRecallDocument,
  NormalizedMarketCandidate,
  ProviderMarketSearchInput,
} from "../types";

const STOPWORDS = new Set([
  "the",
  "a",
  "an",
  "will",
  "by",
  "on",
  "of",
  "in",
  "to",
  "for",
  "and",
  "or",
  "be",
  "is",
  "was",
  "are",
  "were",
  "after",
  "before",
  "with",
  "from",
  "rule",
  "ruling",
  "decision",
  "court",
  "supreme",
  "scotus",
]);

const RATE_SIGNAL_PATTERNS = [
  "rate",
  "rates",
  "interest rate",
  "interest rates",
  "federal funds",
  "fed funds",
  "target rate",
  "target federal funds",
  "fomc",
  "cut",
  "cuts",
  "hike",
  "hikes",
  "hold",
  "holds",
  "unchanged",
  "basis point",
  "basis points",
  "bps",
  "upper bound",
  "lower bound",
];

export function tokenizeMeaningful(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((token) => token.length >= 3)
    .filter((token) => !STOPWORDS.has(token));
}

export function computeProviderRelevance(
  input: ProviderMarketSearchInput,
  question: string,
): number {
  const queryTokens = new Set(
    input.search_queries.flatMap((query) => tokenizeMeaningful(query)),
  );
  const entityTokens = new Set(
    input.claim_candidate.entities.flatMap((entity) => tokenizeMeaningful(entity)),
  );
  const titleTokens = new Set(tokenizeMeaningful(question));

  if (titleTokens.size === 0) {
    return 0;
  }

  let queryOverlap = 0;
  for (const token of queryTokens) {
    if (titleTokens.has(token)) {
      queryOverlap += 1;
    }
  }

  let entityOverlap = 0;
  for (const token of entityTokens) {
    if (titleTokens.has(token)) {
      entityOverlap += 1;
    }
  }

  const queryScore = queryTokens.size === 0 ? 0 : queryOverlap / queryTokens.size;
  const entityScore = entityTokens.size === 0 ? 0 : entityOverlap / entityTokens.size;
  const baseScore = Math.max(queryScore, entityScore);

  if (!isRateLikeMacroClaim(input)) {
    return baseScore;
  }

  const claimRateTokens = new Set(
    tokenizeMeaningful(
      [
        input.claim_candidate.claim_text,
        input.claim_candidate.normalized_claim_text,
        ...input.search_queries,
      ].join(" "),
    ).filter((token) => isRateSignalToken(token)),
  );
  const questionRateTokens = new Set(
    tokenizeMeaningful(question).filter((token) => isRateSignalToken(token)),
  );

  if (claimRateTokens.size === 0 || questionRateTokens.size === 0) {
    return baseScore;
  }

  let rateOverlap = 0;
  for (const token of claimRateTokens) {
    if (questionRateTokens.has(token)) {
      rateOverlap += 1;
    }
  }

  const rateScore = rateOverlap / claimRateTokens.size;
  return Math.max(baseScore, rateScore);
}

function includesAny(value: string, patterns: string[]): boolean {
  return patterns.some((pattern) => value.includes(pattern));
}

function isRateSignalToken(token: string): boolean {
  return RATE_SIGNAL_PATTERNS.some((pattern) =>
    pattern.split(/\s+/).some((part) => part === token),
  );
}

function isRateLikeMacroClaim(input: ProviderMarketSearchInput): boolean {
  if (input.claim_candidate.claim_type !== "macro") {
    return false;
  }

  const sourceText = [
    input.claim_candidate.claim_text,
    input.claim_candidate.normalized_claim_text,
    ...input.search_queries,
  ]
    .join(" ")
    .toLowerCase();

  return includesAny(sourceText, RATE_SIGNAL_PATTERNS);
}

function isRateLikeMarketQuestion(question: string): boolean {
  return includesAny(question, RATE_SIGNAL_PATTERNS);
}

export function getProviderRelevanceThreshold(input: ProviderMarketSearchInput): number {
  if (isRateLikeMacroClaim(input)) {
    return 0.08;
  }

  return 0.22;
}

export function toRecallDocument(
  candidate: NormalizedMarketCandidate,
  providerSpecificText?: string | null,
): MarketRecallDocument {
  return {
    ...candidate,
    document_text: [
      candidate.question,
      providerSpecificText ?? "",
      candidate.resolve_date ?? "",
      candidate.provider_key,
    ]
      .filter(Boolean)
      .join(" "),
  };
}

export function isClaimTypeCandidateAllowed(input: {
  searchInput: ProviderMarketSearchInput;
  question: string;
  resolveDate: string | null;
}): boolean {
  const question = input.question.toLowerCase();
  const claim = input.searchInput.claim_candidate;

  if (claim.claim_type !== "macro") {
    return true;
  }

  if (
    includesAny(question, [
      "vote to confirm",
      "confirm ",
      "chair of the federal reserve",
      "chair of the fed",
      "nominee",
      "nomination",
    ])
  ) {
    return false;
  }

  if (isRateLikeMacroClaim(input.searchInput) && !isRateLikeMarketQuestion(question)) {
    return false;
  }

  return true;
}
