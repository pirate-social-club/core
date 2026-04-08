"use client";

import * as React from "react";

import { cn } from "@/lib/utils";

export type ItemVariant = "default" | "outline" | "muted";
export type ItemSize = "default" | "sm" | "dense";
export type ItemMediaVariant = "default" | "icon" | "image";

export interface ItemProps extends React.HTMLAttributes<HTMLDivElement> {
  size?: ItemSize;
  variant?: ItemVariant;
}

export interface ItemMediaProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: ItemMediaVariant;
}

const itemVariantClasses: Record<ItemVariant, string> = {
  default: "bg-transparent",
  outline: "border-border-soft",
  muted: "bg-surface-interactive",
};

const itemSizeClasses: Record<ItemSize, string> = {
  default: "gap-3 p-4",
  sm: "gap-2.5 px-3 py-3",
  dense: "gap-3 px-3 py-2",
};

const itemMediaVariantClasses: Record<ItemMediaVariant, string> = {
  default: "",
  icon: "h-12 w-12 rounded-lg border border-border-soft bg-surface-skeleton",
  image: "h-12 w-12 overflow-hidden rounded bg-surface-skeleton",
};

export function ItemGroup({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex flex-col gap-2", className)} role="list" {...props} />;
}

export function Item({
  className,
  size = "default",
  variant = "default",
  ...props
}: ItemProps) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-center rounded-lg border border-transparent text-foreground outline-0 transition-colors duration-150",
        itemVariantClasses[variant],
        itemSizeClasses[size],
        className,
      )}
      {...props}
    />
  );
}

export function ItemMedia({
  className,
  variant = "default",
  ...props
}: ItemMediaProps) {
  return (
    <div
      className={cn(
        "flex shrink-0 items-center justify-center gap-2",
        itemMediaVariantClasses[variant],
        className,
      )}
      {...props}
    />
  );
}

export function ItemContent({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex min-w-0 flex-1 flex-col gap-1", className)} {...props} />;
}

export function ItemTitle({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("flex w-fit items-center gap-2 text-base font-semibold leading-[1.3]", className)}
      {...props}
    />
  );
}

export function ItemDescription({
  className,
  ...props
}: React.HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p
      className={cn(
        "m-0 overflow-hidden text-sm font-normal leading-[1.35] text-muted-foreground [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:2]",
        className,
      )}
      {...props}
    />
  );
}

export function ItemActions({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex items-center gap-2", className)} {...props} />;
}
