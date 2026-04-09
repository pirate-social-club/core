"use client";

import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-semibold transition-colors",
  {
    variants: {
      variant: {
        default: "bg-primary/10 text-foreground",
        secondary: "bg-muted text-muted-foreground",
        success: "bg-emerald-500/10 text-emerald-700",
        warning: "bg-amber-500/10 text-amber-700",
        destructive: "bg-destructive/10 text-destructive",
        outline: "border border-border-soft bg-card text-foreground",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

const Badge = React.forwardRef<HTMLSpanElement, BadgeProps>(
  ({ className, variant, ...props }, ref) => (
    <span
      className={cn(badgeVariants({ variant }), className)}
      ref={ref}
      {...props}
    />
  ),
);
Badge.displayName = "Badge";

export { Badge, badgeVariants };
