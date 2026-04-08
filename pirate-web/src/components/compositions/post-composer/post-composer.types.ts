export type ComposerTab = "text" | "image" | "video" | "link" | "song";

export type SongMode = "original" | "remix";

export type DerivativeTrigger = "remix" | "declaration" | "analysis";

export interface ComposerReference {
  id: string;
  title: string;
  subtitle?: string;
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
  ageGateChecked?: boolean;
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

export interface PostComposerProps {
  guildName: string;
  guildAvatarSrc?: string;
  draftsLabel?: string;
  mode: ComposerTab;
  availableTabs?: ComposerTab[];
  canCreateSongPost?: boolean;
  titleValue?: string;
  titleCountLabel?: string;
  textBodyValue?: string;
  captionValue?: string;
  lyricsValue?: string;
  linkUrlValue?: string;
  linkPreview?: LinkPreviewState;
  songMode?: SongMode;
  derivativeStep?: DerivativeStepState;
  moreOptions?: MoreOptionsState;
  monetization?: MonetizationState;
}
