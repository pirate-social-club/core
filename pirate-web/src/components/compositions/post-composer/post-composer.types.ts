export type ComposerTab = "text" | "image" | "video" | "link" | "song" | "live";

export type SongMode = "original" | "remix";

export type LiveRoomKind = "solo" | "duet";

export type LiveAccessMode = "free" | "gated" | "paid";

export type LiveVisibility = "public" | "unlisted";

export type LiveSetlistItemKind = "original" | "cover" | "remix" | "dj_playback" | "unknown";

export interface LivePerformerAllocation {
  userId: string;
  role: "host" | "guest";
  sharePct: number;
}

export type DerivativeTrigger = "remix" | "declaration" | "analysis";

export type AnonymousIdentityScope = "guild_stable" | "thread_stable" | "post_ephemeral";

export type IdentityMode = "public" | "anonymous";

export interface QualifierOption {
  qualifierId: string;
  label: string;
  description?: string;
  sensitivityLevel?: "low" | "high";
  sourceProvider?: "self" | "very" | "world";
  sourceField?: string;
  redundancyKey?: string;
  suppressedByGuildGate?: boolean;
  suppressionReason?: string;
}

export interface ComposerReference {
  id: string;
  title: string;
  subtitle?: string;
}

export interface LiveSetlistItemInput {
  titleText: string;
  artistText?: string;
  declaredTrackId?: string;
  performanceKind: LiveSetlistItemKind;
}

export interface LiveComposerState {
  roomKind: LiveRoomKind;
  accessMode: LiveAccessMode;
  visibility: LiveVisibility;
  scheduleAt?: string;
  description?: string;
  guestUserId?: string;
  coverUpload?: File | null;
  setlistItems: LiveSetlistItemInput[];
  setlistStatus: "draft" | "active";
  performerAllocations: LivePerformerAllocation[];
}

export interface DerivativeStepState {
  visible: boolean;
  required?: boolean;
  trigger: DerivativeTrigger;
  query?: string;
  references?: ComposerReference[];
  requirementLabel?: string;
}

export interface MoreOptionsState {
  open?: boolean;
}

export interface LinkPreviewState {
  title: string;
  domain: string;
  description?: string;
  imageSrc?: string;
}

export interface MonetizationState {
  visible: boolean;
  priceLabel?: string;
  donationAvailable?: boolean;
  donationOptIn?: boolean;
  donationPartnerName?: string;
  donationSharePct?: number;
}

export interface ComposerIdentityState {
  visible?: boolean;
  allowAnonymousIdentity?: boolean;
  allowQualifiersOnAnonymousPosts?: boolean;
  identityMode?: IdentityMode;
  publicHandle?: string;
  anonymousLabel?: string;
  availableQualifiers?: QualifierOption[];
  selectedQualifierIds?: string[];
  helpText?: string;
}

export interface PostComposerProps {
  guildName: string;
  guildAvatarSrc?: string;
  draftsLabel?: string;
  mode: ComposerTab;
  availableTabs?: ComposerTab[];
  canCreateSongPost?: boolean;
  canScheduleLivestream?: boolean;
  titleValue?: string;
  titleCountLabel?: string;
  textBodyValue?: string;
  captionValue?: string;
  lyricsValue?: string;
  linkUrlValue?: string;
  linkPreview?: LinkPreviewState;
  songMode?: SongMode;
  derivativeStep?: DerivativeStepState;
  monetization?: MonetizationState;
  identity?: ComposerIdentityState;
  live?: LiveComposerState;
}
