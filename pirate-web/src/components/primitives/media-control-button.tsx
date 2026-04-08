import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const mediaControlButtonVariants = cva(
  "inline-flex shrink-0 items-center justify-center rounded-full border transition-[color,box-shadow,background-color,border-color] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ring-offset-background disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      intent: {
        default: "border-primary bg-primary text-primary-foreground shadow-sm hover:bg-primary/90",
        subtle: "border-border bg-card text-foreground shadow-sm hover:bg-muted",
        muted: "border-transparent bg-transparent text-muted-foreground",
        danger: "border-transparent bg-transparent text-destructive hover:text-destructive/80",
      },
      size: {
        sm: "size-8",
        md: "size-10",
      },
    },
    defaultVariants: {
      intent: "default",
      size: "sm",
    },
  },
);

export interface MediaControlButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof mediaControlButtonVariants> {}

export function MediaControlButton({
  className,
  intent,
  size,
  type = "button",
  ...props
}: MediaControlButtonProps) {
  return (
    <button
      className={cn(mediaControlButtonVariants({ intent, size }), className)}
      type={type}
      {...props}
    />
  );
}
