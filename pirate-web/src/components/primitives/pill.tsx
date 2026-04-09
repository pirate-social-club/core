"use client";

import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const pillVariants = cva(
  "inline-flex items-center justify-center rounded-full text-sm font-medium transition-colors",
  {
    variants: {
      variant: {
        default: "bg-muted text-foreground hover:bg-muted/80",
        selected: "bg-primary/10 text-primary",
        outline: "border border-border-soft bg-background text-muted-foreground hover:text-foreground",
        active: "border border-primary bg-primary/5 text-foreground",
      },
      size: {
        sm: "px-3 py-1 text-sm",
        md: "px-3 py-1.5 text-sm",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "md",
    },
  },
);

export interface PillProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof pillVariants> {
  leadingIcon?: React.ReactNode;
}

const Pill = React.forwardRef<HTMLButtonElement, PillProps>(
  ({ className, variant, size, leadingIcon, children, ...props }, ref) => (
    <button
      className={cn(pillVariants({ variant, size, className }))}
      ref={ref}
      type="button"
      {...props}
    >
      {leadingIcon ? <span className="mr-1.5">{leadingIcon}</span> : null}
      {children}
    </button>
  ),
);
Pill.displayName = "Pill";

export { Pill, pillVariants };
