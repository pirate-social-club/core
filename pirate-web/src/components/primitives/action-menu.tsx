"use client";

import * as React from "react";
import { MoreHorizontal } from "lucide-react";

import { cn } from "@/lib/utils";
import { useIsMobile } from "@/hooks/use-mobile";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./dropdown-menu";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "./sheet";

export interface ActionMenuItem {
  key: string;
  label: string;
  icon?: React.ReactNode;
  destructive?: boolean;
  disabled?: boolean;
  separatorBefore?: boolean;
}

export interface ActionMenuProps {
  items: ActionMenuItem[];
  label?: string;
  align?: React.ComponentProps<typeof DropdownMenuContent>["align"];
  contentClassName?: string;
  triggerClassName?: string;
  onAction?: (key: string) => void;
}

export function ActionMenu({
  items,
  label = "Open menu",
  align = "end",
  contentClassName,
  triggerClassName,
  onAction,
}: ActionMenuProps) {
  const isMobile = useIsMobile();
  const [mobileOpen, setMobileOpen] = React.useState(false);

  if (items.length === 0) return null;

  if (isMobile) {
    return (
      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetTrigger asChild>
          <button
            aria-label={label}
            className={cn(
              "inline-flex size-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-foreground",
              triggerClassName,
            )}
            type="button"
          >
            <MoreHorizontal className="size-4" />
          </button>
        </SheetTrigger>
        <SheetContent side="bottom" className="rounded-t-[var(--radius-xl)] px-0 pb-6 pt-4">
          <SheetHeader className="px-4 text-left">
            <SheetTitle className="text-[16px] leading-[1.3]">Actions</SheetTitle>
          </SheetHeader>
          <div className="mt-4">
            {items.map((item) => (
              <React.Fragment key={item.key}>
                {item.separatorBefore ? <div className="my-2 h-px bg-border" /> : null}
                <button
                  className={cn(
                    "grid w-full grid-cols-[1rem_1fr] items-center gap-3 px-4 py-3 text-left text-[15px] leading-[1.35] text-foreground",
                    !item.icon && "grid-cols-[1fr]",
                    item.destructive && "text-destructive",
                    item.disabled && "pointer-events-none opacity-50",
                  )}
                  disabled={item.disabled}
                  onClick={() => {
                    onAction?.(item.key);
                    setMobileOpen(false);
                  }}
                  type="button"
                >
                  {item.icon ? (
                    <span className="inline-flex size-4 items-center justify-center">
                      {item.icon}
                    </span>
                  ) : null}
                  <span>{item.label}</span>
                </button>
              </React.Fragment>
            ))}
          </div>
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          aria-label={label}
          className={cn(
            "inline-flex size-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-foreground",
            triggerClassName,
          )}
          type="button"
        >
          <MoreHorizontal className="size-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align={align}
        className={cn("rounded-[var(--radius-lg)] p-0", contentClassName)}
      >
        {items.map((item) => (
          <React.Fragment key={item.key}>
            {item.separatorBefore ? <DropdownMenuSeparator /> : null}
            <DropdownMenuItem
              className={cn(
                "w-full rounded-none py-2.5 pl-3 pr-3 text-sm text-popover-foreground hover:text-foreground focus:bg-muted focus:text-foreground",
                item.icon ? "grid grid-cols-[1rem_1fr] items-center gap-2" : "block",
                item.destructive && "text-destructive focus:text-destructive",
              )}
              disabled={item.disabled}
              onClick={() => onAction?.(item.key)}
            >
              {item.icon ? (
                <span className="inline-flex size-4 items-center justify-center">
                  {item.icon}
                </span>
              ) : null}
              <span>{item.label}</span>
            </DropdownMenuItem>
          </React.Fragment>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
