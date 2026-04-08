import * as React from "react";

import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/primitives/skeleton";

export interface PostCardSkeletonProps {
  showMedia?: boolean;
  className?: string;
}

export function PostCardSkeleton({ showMedia = true, className }: PostCardSkeletonProps) {
  return (
    <article
      className={cn("flex flex-col gap-3 rounded-lg border border-border bg-card p-3", className)}
    >
      <div className="flex items-center gap-2">
        <Skeleton className="size-5 rounded-full" />
        <div className="flex flex-1 gap-2">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-3 w-8" />
          <Skeleton className="h-3 w-8" />
        </div>
        <Skeleton className="size-8 rounded-full" />
      </div>

      <Skeleton className="h-4 w-3/4" />

      {showMedia && (
        <Skeleton className="h-48 w-full rounded-lg" />
      )}

      <div className="flex items-center gap-1">
        <Skeleton className="size-8 rounded-full" />
        <Skeleton className="h-3 w-8" />
        <Skeleton className="size-8 rounded-full" />
        <Skeleton className="size-8 rounded-full" />
        <Skeleton className="ml-auto size-8 rounded-full" />
      </div>
    </article>
  );
}
