import type { VerificationCapabilities } from "../types/api";

export const DEFAULT_VERIFICATION_CAPABILITIES: VerificationCapabilities = {
  unique_human: {
    state: "unverified",
  },
  age_over_18: {
    state: "unverified",
  },
  nationality: {
    state: "unverified",
    value: null,
  },
  gender: {
    state: "unverified",
    value: null,
  },
  sanctions_clear: {
    state: "unverified",
  },
  wallet_score: {
    state: "unverified",
  },
};

export function buildDefaultVerificationCapabilitiesJson(): string {
  return JSON.stringify(DEFAULT_VERIFICATION_CAPABILITIES);
}

export function serializeVerificationCapabilities(raw: string | null | undefined): VerificationCapabilities {
  if (!raw) {
    return DEFAULT_VERIFICATION_CAPABILITIES;
  }

  try {
    const parsed = JSON.parse(raw) as Partial<VerificationCapabilities>;
    return {
      unique_human: parsed.unique_human ?? DEFAULT_VERIFICATION_CAPABILITIES.unique_human,
      age_over_18: parsed.age_over_18 ?? DEFAULT_VERIFICATION_CAPABILITIES.age_over_18,
      nationality: parsed.nationality ?? DEFAULT_VERIFICATION_CAPABILITIES.nationality,
      gender: parsed.gender ?? DEFAULT_VERIFICATION_CAPABILITIES.gender,
      sanctions_clear: parsed.sanctions_clear ?? DEFAULT_VERIFICATION_CAPABILITIES.sanctions_clear,
      wallet_score: parsed.wallet_score ?? DEFAULT_VERIFICATION_CAPABILITIES.wallet_score,
    };
  } catch {
    return DEFAULT_VERIFICATION_CAPABILITIES;
  }
}
