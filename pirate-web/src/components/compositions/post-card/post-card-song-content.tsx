import * as React from "react";
import { Music2, Loader2, Lock, Unlock, Check } from "lucide-react";
import { Lock as FilledLockIcon, Pause as PauseIcon, Play as PlayIcon } from "@phosphor-icons/react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/primitives/button";
import { MediaControlButton } from "@/components/primitives/media-control-button";
import { postCardType } from "./post-card.styles";
import type { SongContentSpec, UpstreamAttribution } from "./post-card.types";

export interface SongPostContentProps {
  content: SongContentSpec;
  className?: string;
}

// Derived UI state from domain model — all visual state is centralized here
interface DerivedSongUI {
  // Core playback
  isPlayable: boolean;
  canShowPreview: boolean;
  
  // Viewer states that affect UI
  isAgeGated: boolean;
  ageGateRequiresProof: boolean;
  
  // Artwork treatment (split so locked and age-gate don't stack)
  showLockedArtwork: boolean;
  showAgeGatedArtwork: boolean;
  
  // Commerce states
  showPrice: boolean;
  showUnlock: boolean;
  showOwned: boolean;
  
  // Attributions
  showAttribution: boolean;
  
  // Primary action
  primaryAction: "play" | "pause" | "buffering" | "preview" | "locked";
}

function deriveSongUI(content: SongContentSpec): DerivedSongUI {
  const {
    playbackState = "idle",
    accessMode,
    contentSafetyState,
    ageGatePolicy,
    ageGateViewerState,
    listingMode,
    listingStatus,
    hasEntitlement,
    songMode,
    upstreamAttributions,
  } = content;

  const isAgeGated = ageGatePolicy === "18_plus" && contentSafetyState === "adult";
  const ageGateRequiresProof = isAgeGated && ageGateViewerState !== "verified_blocked";
  
  // Access checks
  const isLocked = accessMode === "locked";
  
  // Commerce checks
  const isListed = listingMode === "listed";
  const isListingActive = listingStatus === "active";
  const isOwned = hasEntitlement === true;
  
  // Playback availability
  const isPlayable = !isAgeGated;
  const canShowPreview = isLocked && !isOwned && !isAgeGated;
  
  // Artwork treatment — separate so blur/scale/overlay never stack
  const showLockedArtwork = isLocked && !isOwned;
  const showAgeGatedArtwork = isAgeGated;
  
  // Commerce UI
  const showPrice = isListed && isListingActive && !isOwned && isLocked;
  const showUnlock = isLocked && !isOwned && (!isListed || !isListingActive);
  const showOwned = isOwned;
  
  // Attribution
  const showAttribution = !!(songMode === "remix" && upstreamAttributions && upstreamAttributions.length > 0);

  // Determine primary action
  let primaryAction: DerivedSongUI["primaryAction"] = "play";

  if (ageGateRequiresProof) {
    primaryAction = "locked";
  } else if (playbackState === "playing") {
    primaryAction = "pause";
  } else if (playbackState === "buffering") {
    primaryAction = "buffering";
  } else if (isOwned) {
    primaryAction = "play";
  } else if (canShowPreview) {
    primaryAction = "preview";
  } else {
    primaryAction = "play";
  }

  return {
    isPlayable,
    canShowPreview,
    isAgeGated,
    ageGateRequiresProof,
    showLockedArtwork,
    showAgeGatedArtwork,
    showPrice,
    showUnlock,
    showOwned,
    showAttribution,
    primaryAction,
  };
}

function getDerivativeSummary(upstreamAttributions?: UpstreamAttribution[]): string | null {
  if (!upstreamAttributions || upstreamAttributions.length === 0) {
    return null;
  }

  if (upstreamAttributions.length === 1) {
    return `Derived from ${upstreamAttributions[0].title}`;
  }

  return `Derived from ${upstreamAttributions[0].title} +${upstreamAttributions.length - 1}`;
}

export function SongPostContent({ content, className }: SongPostContentProps) {
  const ui = deriveSongUI(content);
  const {
    playbackState = "idle",
    priceLabel,
    regionalPriceLabel,
    upstreamAttributions,
    onPlay,
    onPause,
    onUnlock,
    onBuy,
    onVerifyAge,
  } = content;

  const effectivePriceLabel = regionalPriceLabel ?? priceLabel;

  // Determine control button - smaller secondary style for preview, prominent for play
  const getControlButton = () => {
    switch (ui.primaryAction) {
      case "pause":
        return (
          <MediaControlButton aria-label="Pause" onClick={onPause} size="md">
            <PauseIcon className="size-[18px]" weight="fill" />
          </MediaControlButton>
        );
      case "play":
        return (
          <MediaControlButton aria-label="Play" onClick={onPlay} size="md">
            <PlayIcon className="size-[18px]" weight="fill" />
          </MediaControlButton>
        );
      case "buffering":
        return (
          <MediaControlButton aria-label="Loading" size="md" disabled>
            <Loader2 className="size-[18px] animate-spin" />
          </MediaControlButton>
        );
      case "preview":
        return (
          <MediaControlButton aria-label="Play preview" onClick={onPlay} title="Preview (30s)" size="md">
            <PlayIcon className="size-[18px]" weight="fill" />
          </MediaControlButton>
        );
      case "locked":
        return null;
      default:
        return (
          <MediaControlButton aria-label="Play" onClick={onPlay} size="md">
            <PlayIcon className="size-[18px]" weight="fill" />
          </MediaControlButton>
        );
    }
  };

  const derivativeSummary = ui.showAttribution ? getDerivativeSummary(upstreamAttributions) : null;

  const renderCommerceRow = () => {
    if (!(ui.showPrice || ui.showUnlock || ui.showOwned)) {
      return null;
    }

    return (
      <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-card px-3 py-2.5">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          {ui.showOwned ? (
            <span className={cn("inline-flex items-center gap-1.5 font-medium text-green-600", postCardType.label)}>
              <Check className="size-3.5" />
              <span>Unlocked</span>
            </span>
          ) : ui.showLockedArtwork ? (
            <span className={cn("inline-flex items-center text-muted-foreground", postCardType.label)}>
              <span className="truncate">Preview available</span>
            </span>
          ) : null}
        </div>

        <div className="flex shrink-0 items-center">
          {ui.showPrice && (
            <Button
              size="sm"
              className="h-8 gap-1.5 px-4 font-medium"
              onClick={onBuy}
              disabled={!onBuy}
            >
              <Unlock className="size-3.5" />
              {effectivePriceLabel ? `Unlock for ${effectivePriceLabel}` : "Unlock"}
            </Button>
          )}
          {ui.showUnlock && (
            <Button
              size="sm"
              className="h-8 gap-1.5 px-4 font-medium"
              onClick={onUnlock}
              disabled={!onUnlock}
            >
              <Unlock className="size-3.5" />
              Unlock
            </Button>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      {/* Main song row */}
      <div className="flex items-center gap-3">
        {/* Artwork */}
        <div className="relative grid size-16 shrink-0 place-items-center overflow-hidden rounded-lg bg-muted">
          {content.artworkSrc ? (
            <>
              <img
                alt={content.title}
                className={cn(
                  "size-full object-cover transition-[filter,transform]",
                  ui.showLockedArtwork && "scale-[1.03] blur-[3px]",
                  ui.showAgeGatedArtwork && "blur-md saturate-0",
                )}
                src={content.artworkSrc}
              />
              {ui.showLockedArtwork && (
                <div className="absolute inset-0 bg-black/22" />
              )}
              {ui.showAgeGatedArtwork && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/40">
                  <FilledLockIcon className="size-6 text-white" weight="fill" />
                </div>
              )}
            </>
          ) : (
            <Music2 className="size-5 text-muted-foreground" />
          )}
        </div>

        {/* Info */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className={cn("min-w-0 truncate font-semibold text-foreground", postCardType.label)}>
              {content.title}
            </p>
            {content.durationLabel && !ui.isAgeGated && (
              <span className={cn("shrink-0 font-normal text-muted-foreground", postCardType.label)}>
                ({content.durationLabel})
              </span>
            )}
          </div>
          {derivativeSummary && (
            <p className={cn("truncate text-muted-foreground", postCardType.meta)}>
              {derivativeSummary}
            </p>
          )}
        </div>

        {ui.primaryAction !== "locked" ? (
          <div className="flex shrink-0 items-center">
            {getControlButton()}
          </div>
        ) : null}
      </div>

      {renderCommerceRow()}

      {ui.isAgeGated && ui.ageGateRequiresProof && (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-card px-3 py-2.5">
          <div className="flex min-w-0 flex-1 items-center text-muted-foreground">
            <span className={cn("truncate", postCardType.label)}>
              Prove you're 18+ to listen
            </span>
          </div>
          <div className="flex shrink-0 items-center">
            <Button
              size="sm"
              className="h-8 px-4 font-medium"
              onClick={onVerifyAge}
              disabled={!onVerifyAge}
            >
              Verify Age
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
