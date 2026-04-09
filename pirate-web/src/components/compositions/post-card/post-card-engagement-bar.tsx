import * as React from "react";
import { ArrowBigDown, ArrowBigUp, Bookmark, MessageCircle, Share2 } from "lucide-react";

import { cn } from "@/lib/utils";
import type { PostCardEngagement } from "./post-card.types";

function formatScore(score: number): string {
  if (score >= 1000) {
    return `${(score / 1000).toFixed(1)}k`;
  }
  if (score < 0) return score.toString();
  return score > 0 ? score.toString() : "0";
}

export interface PostCardEngagementBarProps {
  engagement: PostCardEngagement;
  onVote?: (direction: "up" | "down" | null) => void;
  onComment?: () => void;
  onSave?: () => void;
  onShare?: () => void;
  className?: string;
}

export function PostCardEngagementBar({
  engagement,
  onVote,
  onComment,
  onSave,
  onShare,
  className,
}: PostCardEngagementBarProps) {
  const { score, viewerVote, commentCount, saved } = engagement;

  // Vote pill: up + count + down in one rounded container
  const VotePill = () => (
    <div 
      className={cn(
        "inline-flex items-center gap-0.5 rounded-full border border-transparent bg-muted/50 px-1 py-0.5 transition-colors hover:bg-muted",
        viewerVote === "up" && "border-primary/20 bg-primary/5",
        viewerVote === "down" && "border-destructive/20 bg-destructive/5"
      )}
    >
      <button
        className={cn(
          "inline-flex size-7 items-center justify-center rounded-full transition-colors",
          viewerVote === "up"
            ? "text-primary hover:bg-primary/10"
            : "text-muted-foreground hover:bg-muted-foreground/10 hover:text-foreground",
        )}
        onClick={() => onVote?.(viewerVote === "up" ? null : "up")}
        type="button"
        aria-label="Upvote"
      >
        <ArrowBigUp
          className={cn("size-5", viewerVote === "up" && "fill-current")}
        />
      </button>

      <span
        className={cn(
          "min-w-[1.5rem] text-center text-[14px] font-semibold tabular-nums",
          viewerVote === "up" && "text-primary",
          viewerVote === "down" && "text-destructive",
          !viewerVote && "text-muted-foreground",
        )}
      >
        {formatScore(score)}
      </span>

      <button
        className={cn(
          "inline-flex size-7 items-center justify-center rounded-full transition-colors",
          viewerVote === "down"
            ? "text-destructive hover:bg-destructive/10"
            : "text-muted-foreground hover:bg-muted-foreground/10 hover:text-foreground",
        )}
        onClick={() => onVote?.(viewerVote === "down" ? null : "down")}
        type="button"
        aria-label="Downvote"
      >
        <ArrowBigDown
          className={cn("size-5", viewerVote === "down" && "fill-current")}
        />
      </button>
    </div>
  );

  // Comment pill: icon + count in rounded container
  const CommentPill = () => (
    <button
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border border-transparent bg-muted/50 px-2.5 py-1.5 text-[14px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
      )}
      onClick={onComment}
      type="button"
      aria-label={`Comments (${commentCount})`}
    >
      <MessageCircle className="size-5" />
      <span className="font-medium tabular-nums">{commentCount}</span>
    </button>
  );

  // Icon-only pills for share and save
  const IconPill = ({ 
    children, 
    onClick, 
    label,
    active = false,
    activeClass = "text-primary"
  }: { 
    children: React.ReactNode;
    onClick?: () => void;
    label: string;
    active?: boolean;
    activeClass?: string;
  }) => (
    <button
      className={cn(
        "inline-flex size-8 items-center justify-center rounded-full bg-muted/50 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
        active && activeClass
      )}
      onClick={onClick}
      type="button"
      aria-label={label}
    >
      {children}
    </button>
  );

  return (
    <div className={cn("flex items-center gap-2", className)}>
      <VotePill />
      <CommentPill />
      <IconPill onClick={onShare} label="Share">
        <Share2 className="size-5" />
      </IconPill>
      <IconPill 
        onClick={onSave} 
        label={saved ? "Unsave" : "Save"}
        active={saved}
        activeClass="text-primary"
      >
        <Bookmark className={cn("size-5", saved && "fill-current")} />
      </IconPill>
    </div>
  );
}