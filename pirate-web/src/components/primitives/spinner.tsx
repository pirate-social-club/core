import * as React from "react";

import { cn } from "@/lib/utils";

export interface SpinnerProps extends React.SVGProps<SVGSVGElement> {}

export const Spinner = React.forwardRef<SVGSVGElement, SpinnerProps>(
  ({ className, ...props }, ref) => (
    <svg
      aria-label="Loading"
      className={cn("size-4 animate-spin text-current", className)}
      fill="none"
      ref={ref}
      role="status"
      viewBox="0 0 24 24"
      {...props}
    >
      <circle cx="12" cy="12" opacity="0.2" r="9" stroke="currentColor" strokeWidth="3" />
      <path
        d="M21 12a9 9 0 0 0-9-9"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="3"
      />
    </svg>
  ),
);

Spinner.displayName = "Spinner";
