export type GuildMembershipMode = "open" | "request" | "gated";
export type GuildGovernanceMode = "creator_led" | "multisig_ready" | "dao_ready";
export type GuildDefaultAgeGatePolicy = "none" | "18_plus";

export type NamespaceFamily = "hns" | "spaces";

export type NamespaceImportStatus = "not_imported" | "pending" | "verified";

export type HnsDelegationMode = "owner_managed" | "pirate_managed";

export type SpacesHandleMode = "owner_managed" | "operator_brokered" | "attach_certificate";

export interface NamespaceImportState {
  family?: NamespaceFamily;
  externalRoot?: string;
  importStatus?: NamespaceImportStatus;
  ownerLabel?: string;
  hnsDelegationMode?: HnsDelegationMode;
  spacesHandleMode?: SpacesHandleMode;
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
