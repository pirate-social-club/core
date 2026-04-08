import type { ActionMenuItem } from "@/components/primitives/action-menu";

// Domain-aligned types from specs/domain/asset.md and specs/domain/post.md
export type AccessMode = "public" | "locked";
export type PublicationState = "draft" | "story_requested" | "story_published" | "story_failed";
export type SongMode = "original" | "remix";
export type RightsBasis = "none" | "original" | "derivative" | "attribution_only";
export type AnalysisState = "pending" | "allow" | "allow_with_required_reference" | "review_required" | "blocked";
export type ContentSafetyState = "pending" | "safe" | "sensitive" | "adult";
export type AgeGatePolicy = "none" | "18_plus";

// From specs/domain/marketplace.md
export type ListingMode = "not_listed" | "listed";
export type ListingStatus = "active" | "paused" | "sold_out" | "removed";

// Playback axis - purely UI state
export type PlaybackState = "idle" | "playing" | "paused" | "buffering" | "ended";

// Upstream attribution for remixes (from specs/domain/asset.md)
export interface UpstreamAttribution {
  assetId: string;
  relationshipType: "remix_of" | "references_song" | "inspired_by" | "samples";
  title: string;
  artist: string;
}

// Spec-aligned song content (from specs/domain/post.md, asset.md, marketplace.md)
export interface SongContentSpec {
  type: "song";
  // Core metadata
  title: string;
  artist?: string; // Optional - omit when same as post author to avoid redundancy
  artworkSrc?: string;
  durationLabel?: string;
  durationMs?: number;

  // Playback axis
  playbackState?: PlaybackState;
  progressMs?: number;

  // Domain axis - from specs/domain/asset.md and post.md
  accessMode: AccessMode;
  publicationState?: PublicationState;
  songMode?: SongMode;
  rightsBasis?: RightsBasis;
  analysisState?: AnalysisState;
  contentSafetyState?: ContentSafetyState;
  ageGatePolicy?: AgeGatePolicy;
  ageGateViewerState?: "proof_required" | "verified_blocked";
  upstreamAttributions?: UpstreamAttribution[];

  // Commerce axis - from specs/domain/marketplace.md
  listingMode?: ListingMode;
  listingStatus?: ListingStatus;
  priceLabel?: string;
  regionalPriceLabel?: string;
  hasEntitlement?: boolean; // Derived from purchase/ownership state

  // Callbacks
  onPlay?: () => void;
  onPause?: () => void;
  onSeek?: (ms: number) => void;
  onUnlock?: () => void;
  onBuy?: () => void;
  onVerifyAge?: () => void;
}

export type PostCardContent =
  | { type: "text"; body: string }
  | { type: "image"; src: string; alt: string; caption?: string; aspectRatio?: number }
  | { type: "video"; src: string; posterSrc?: string; durationLabel?: string }
  | {
      type: "link";
      href: string;
      linkTitle: string;
      linkLabel?: string;
      previewImageSrc?: string;
    }
  | SongContentSpec;

export type PostCardMenuItem = ActionMenuItem;

export type PostCardIdentity = {
  kind: "guild" | "user";
  label: string;
  href?: string;
  avatarSrc?: string;
};

export type PostCardByline = {
  guild?: PostCardIdentity;
  author?: PostCardIdentity;
  timestampLabel: string;
};

export type PostCardViewContext = "home" | "guild" | "profile";

export type PostCardEngagement = {
  score: number;
  viewerVote?: "up" | "down" | null;
  commentCount: number;
  saved?: boolean;
};

export interface PostCardProps {
  viewContext?: PostCardViewContext;
  byline: PostCardByline;
  title?: string;
  titleHref?: string;
  postHref?: string;
  content: PostCardContent;
  engagement: PostCardEngagement;
  menuItems?: PostCardMenuItem[];
  onVote?: (direction: "up" | "down" | null) => void;
  onComment?: () => void;
  onSave?: () => void;
  onShare?: () => void;
  onMenuAction?: (key: string) => void;
  className?: string;
}
