export type GuildMembershipMode = "open" | "request" | "gated";
export type GuildGovernanceMode = "creator_led" | "multisig_ready" | "dao_ready";
export type GuildDefaultAgeGatePolicy = "none" | "18_plus";

export type NamespaceFamily = "hns" | "spaces";

export type NamespaceImportStatus = "not_imported" | "pending" | "verified";

export type NamespaceDelegationMode = "owner_managed" | "pirate_managed";

export interface NamespaceImportState {
  family?: NamespaceFamily;
  externalRoot?: string;
  importStatus?: NamespaceImportStatus;
  ownerLabel?: string;
  delegationMode?: NamespaceDelegationMode;
}

export interface CreateGuildComposerProps {
  displayName?: string;
  description?: string;
  draftsLabel?: string;
  membershipMode?: GuildMembershipMode;
  governanceMode?: GuildGovernanceMode;
  defaultAgeGatePolicy?: GuildDefaultAgeGatePolicy;
  allowAnonymousIdentity?: boolean;
  endaomentUrl?: string;
  namespace?: NamespaceImportState;
}
