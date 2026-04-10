export const PROVIDER_MATRIX = {
  unique_human: ["self", "very"],
  age_over_18: ["self"],
  nationality: ["self"],
  gender: ["self"],
  wallet_score: ["passport"],
  sanctions_clear: ["passport"],
} as const;

export type ProofType = keyof typeof PROVIDER_MATRIX;
export type Provider = (typeof PROVIDER_MATRIX)[ProofType][number];
