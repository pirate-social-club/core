import type { OnboardingStatus, Profile, SessionExchangeResponse, User, WalletAttachmentSummary } from "../types/api";

export function assembleSessionExchangeResponse(input: {
  accessToken: string;
  user: User;
  profile: Profile;
  onboarding: OnboardingStatus;
  walletAttachments: WalletAttachmentSummary[];
}): SessionExchangeResponse {
  return {
    access_token: input.accessToken,
    user: input.user,
    profile: input.profile,
    onboarding: input.onboarding,
    wallet_attachments: input.walletAttachments,
  };
}
