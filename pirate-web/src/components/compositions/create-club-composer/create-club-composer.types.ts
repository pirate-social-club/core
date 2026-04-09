export type ClubMembershipMode = "open" | "request" | "gated";
export type ClubGovernanceMode = "centralized" | "multisig" | "majeur";
export type ClubDefaultAgeGatePolicy = "none" | "18_plus";

export type NamespaceFamily = "hns" | "spaces";

export type NamespaceImportStatus =
  | "not_imported"
  | "inspected"
  | "txt_challenge_ready"
  | "pending"
  | "verified";

export type HnsDelegationMode = "owner_managed" | "pirate_managed";

export type SpacesHandleMode = "owner_managed" | "operator_brokered" | "attach_certificate";

export type MultisigVerificationState = "not_attached" | "pending" | "verified" | "broken";

export type HandlePolicyTemplate = "standard" | "premium" | "membership_gated" | "custom";
export type HandlePricingModel = "free" | "flat_by_length" | "custom_curve" | "gated_then_flat";
export type AnonymousIdentityScope = "club_stable" | "thread_stable" | "post_ephemeral";

export type GateFamily = "token_holding" | "identity_proof";
export type GateType =
  | "erc721_holding"
  | "erc1155_holding"
  | "erc20_balance"
  | "solana_nft_holding"
  | "unique_human"
  | "age_over_18"
  | "nationality"
  | "wallet_score";

export type ComposerStep = 1 | 2 | 3 | 4 | 5;

export interface HandlePolicyState {
  policyTemplate: HandlePolicyTemplate;
  pricingModel: HandlePricingModel;
  membershipRequiredForClaim: boolean;
}

export interface GateRuleDraft {
  scope: "membership";
  gateFamily: GateFamily;
  gateType: GateType;
}

export interface NamespaceImportState {
  family?: NamespaceFamily;
  externalRoot?: string;
  importStatus?: NamespaceImportStatus;
  ownerLabel?: string;
  hnsDelegationMode?: HnsDelegationMode;
  spacesHandleMode?: SpacesHandleMode;
  expiryDaysRemaining?: number;
  pirateDnsDetected?: boolean;
  txtChallenge?: string;
}

export interface MultisigAttachmentState {
  chainId?: string;
  contractAddress?: string;
  treasurySameAsContract?: boolean;
  treasuryAddress?: string;
  displayLabel?: string;
  verificationState?: MultisigVerificationState;
  owners?: string[];
  threshold?: number;
  implementationLabel?: string;
  masterCopyAddress?: string;
  warnings?: string[];
}

export interface CreateClubComposerProps {
  displayName?: string;
  description?: string;
  draftsLabel?: string;
  membershipMode?: ClubMembershipMode;
  governanceMode?: ClubGovernanceMode;
  defaultAgeGatePolicy?: ClubDefaultAgeGatePolicy;
  allowAnonymousIdentity?: boolean;
  anonymousIdentityScope?: AnonymousIdentityScope;
  endaomentUrl?: string;
  namespace?: NamespaceImportState;
  multisig?: MultisigAttachmentState;
  handlePolicy?: HandlePolicyState;
  creatorEligible?: boolean;
  initialStep?: ComposerStep;
}
