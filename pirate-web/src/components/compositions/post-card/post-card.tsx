import * as React from "react";

import { cn } from "@/lib/utils";
import { PostCardHeader } from "./post-card-header";
import { PostCardMedia } from "./post-card-media";
import { PostCardEngagementBar } from "./post-card-engagement-bar";
import { postCardType } from "./post-card.styles";
import type { PostCardProps } from "./post-card.types";

export function PostCard({
  viewContext = "home",
  byline,
  title,
  titleHref,
  postHref,
  content,
  engagement,
  menuItems,
  onVote,
  onComment,
  onSave,
  onShare,
  onMenuAction,
  className,
}: PostCardProps) {
  const wrapBodyWithPostLink = Boolean(postHref) && content.type !== "link";

  const titleElement = title ? (
    titleHref ? (
      <a
        className={cn(postCardType.title, "font-semibold text-foreground hover:underline")}
        href={titleHref}
      >
        {title}
      </a>
    ) : (
      <h3 className={cn(postCardType.title, "font-semibold text-foreground")}>
        {title}
      </h3>
    )
  ) : null;

  return (
    <article
      className={cn(
        "flex w-full flex-col gap-3 border-b border-border px-4 py-3 transition-colors hover:bg-muted/30",
        className,
      )}
    >
      <PostCardHeader
        byline={byline}
        menuItems={menuItems}
        onMenuAction={onMenuAction}
        viewContext={viewContext}
      />

      {wrapBodyWithPostLink ? (
        <a className="flex flex-col gap-3" href={postHref}>
          {titleElement}
          <PostCardMedia content={content} />
        </a>
      ) : (
        <>
          {titleElement}
          <PostCardMedia content={content} />
        </>
      )}

      <PostCardEngagementBar
        engagement={engagement}
        onVote={onVote}
        onComment={onComment}
        onSave={onSave}
        onShare={onShare}
      />
    </article>
  );
}
