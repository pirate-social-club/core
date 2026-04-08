import * as React from "react";
import * as SliderPrimitive from "@radix-ui/react-slider";

import { cn } from "@/lib/utils";

interface ScrubberProps {
  value: number;
  max?: number;
  onChange?: (value: number) => void;
  disabled?: boolean;
  className?: string;
}

export function Scrubber({ 
  value, 
  max = 100, 
  onChange, 
  disabled = false,
  className 
}: ScrubberProps) {
  return (
    <SliderPrimitive.Root
      className={cn(
        "group relative flex w-full touch-none select-none items-center",
        disabled && "pointer-events-none opacity-60",
        className
      )}
      value={[value]}
      max={max}
      step={1}
      onValueChange={([v]) => onChange?.(v)}
      disabled={disabled}
    >
      <SliderPrimitive.Track className="relative h-1.5 w-full grow overflow-hidden rounded-full bg-muted">
        <SliderPrimitive.Range className="absolute h-full rounded-full bg-primary" />
      </SliderPrimitive.Track>
      <SliderPrimitive.Thumb
        className={cn(
          "block size-3.5 rounded-full border-2 border-primary bg-background shadow-sm",
          "transition-all duration-150",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
          "hover:scale-110",
          // Show thumb on hover of the scrubber or when dragging
          "opacity-0 group-hover:opacity-100",
          "data-[state=active]:opacity-100 data-[state=active]:scale-110"
        )}
      />
    </SliderPrimitive.Root>
  );
}

// Simpler progress-only variant (non-interactive)
interface ProgressBarProps {
  value: number;
  className?: string;
  showThumb?: boolean;
}

export function ProgressBar({ value, className, showThumb = true }: ProgressBarProps) {
  return (
    <div className={cn("group relative flex items-center", className)}>
      <div className="relative h-1 w-full overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-primary transition-all duration-100"
          style={{ width: `${value}%` }}
        />
      </div>
      {showThumb && (
        <div
          className={cn(
            "absolute size-3.5 rounded-full border-2 border-primary bg-background shadow-sm",
            "transition-all duration-150",
            // Position thumb at progress point
            "translate-x-[-50%]",
            // Show on hover
            "opacity-0 group-hover:opacity-100"
          )}
          style={{ left: `${value}%` }}
        />
      )}
    </div>
  );
}