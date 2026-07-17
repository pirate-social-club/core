export const PROVIDER_MATRIX = {
  unique_human: ["self", "zkpassport", "very"],
  age_over_18: ["self"],
  minimum_age: ["self", "zkpassport"],
  nationality: ["self", "zkpassport"],
  gender: ["self", "zkpassport"],
  wallet_score: ["passport"],
  sanctions_clear: ["passport"],
} as const;

export type ProofType = keyof typeof PROVIDER_MATRIX;
export type Provider = (typeof PROVIDER_MATRIX)[ProofType][number];
