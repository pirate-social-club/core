import * as React from "react";

import { cn } from "@/lib/utils";
import { Avatar } from "@/components/primitives/avatar";
import { ActionMenu } from "@/components/primitives/action-menu";
import { postCardType } from "./post-card.styles";
import type { PostCardByline, PostCardMenuItem, PostCardViewContext } from "./post-card.types";

function PostCardBylineContent({
  byline,
  viewContext,
}: {
  byline: PostCardByline;
  viewContext: PostCardViewContext;
}) {
  const { guild, author, timestampLabel } = byline;
  const displayIdentity =
    viewContext === "home" ? (guild ?? author) : (author ?? guild);

  if (!displayIdentity) return null;

  return (
    <div className={cn("flex items-baseline gap-1 text-muted-foreground", postCardType.meta)}>
      {displayIdentity.href ? (
        <a
          className="font-semibold text-foreground hover:underline"
          href={displayIdentity.href}
        >
          {displayIdentity.label}
        </a>
      ) : (
        <span className="font-semibold text-foreground">{displayIdentity.label}</span>
      )}

      <span>·</span>
      <span>{timestampLabel}</span>
    </div>
  );
}

export interface PostCardHeaderProps {
  viewContext: PostCardViewContext;
  byline: PostCardByline;
  menuItems?: PostCardMenuItem[];
  onMenuAction?: (key: string) => void;
  className?: string;
}

export function PostCardHeader({
  viewContext,
  byline,
  menuItems,
  onMenuAction,
  className,
}: PostCardHeaderProps) {
  const avatarIdentity =
    viewContext === "home" ? (byline.guild ?? byline.author) : (byline.author ?? byline.guild);

  const AvatarElement = (
    <Avatar
      fallback={avatarIdentity?.label ?? ""}
      size="sm"
      src={avatarIdentity?.avatarSrc}
      className={cn(
        avatarIdentity?.href && "cursor-pointer transition-opacity hover:opacity-80"
      )}
    />
  );

  return (
    <div className={cn("flex items-center gap-2", className)}>
      {avatarIdentity?.href ? (
        <a href={avatarIdentity.href} className="shrink-0">
          {AvatarElement}
        </a>
      ) : (
        AvatarElement
      )}
      <div className="min-w-0 flex-1">
        <PostCardBylineContent byline={byline} viewContext={viewContext} />
      </div>
      {menuItems?.length ? (
        <ActionMenu items={menuItems} label="Post options" onAction={onMenuAction} />
      ) : null}
    </div>
  );
}
