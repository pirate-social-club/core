import type { Meta, StoryObj } from "@storybook/react-vite";
import * as React from "react";

import { Button } from "@/components/primitives/button";
import { Badge } from "@/components/primitives/badge";
import {
  Modal,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  ModalTitle,
} from "@/components/compositions/modal";

const meta = {
  title: "Compositions/Modal",
  component: ModalContent,
  args: {
    mobileSide: "bottom",
  },
} satisfies Meta<typeof ModalContent>;

export default meta;

type Story = StoryObj<typeof meta>;

function ModalShell({
  forceMobile,
  mobileSide,
  title,
  description,
  body,
  footer,
}: {
  forceMobile?: boolean;
  mobileSide?: "top" | "bottom" | "left" | "right";
  title: string;
  description: string;
  body?: React.ReactNode;
  footer?: React.ReactNode;
}) {
  const [open, setOpen] = React.useState(true);
  const isBottomSheet =
    forceMobile !== false
    && (mobileSide === undefined || mobileSide === "bottom");

  return (
    <div className="flex min-h-[720px] items-center justify-center bg-[radial-gradient(circle_at_top,_hsl(var(--muted))_0%,_transparent_58%),linear-gradient(180deg,_hsl(var(--background))_0%,_hsl(var(--muted)/0.45)_100%)] p-6">
      {!open ? <Button onClick={() => setOpen(true)}>Reopen modal</Button> : null}
      <Modal forceMobile={forceMobile} open={open} onOpenChange={setOpen}>
        <ModalContent
          className={
            isBottomSheet
              ? "border-border bg-background px-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] pt-3"
              : "border-border bg-background p-6 sm:w-[min(100%-2rem,34rem)] sm:max-w-[34rem]"
          }
          mobileSide={mobileSide}
        >
          {isBottomSheet ? (
            <div className="mx-auto mb-3 h-1.5 w-12 rounded-full bg-border" />
          ) : null}
          <ModalHeader className="pr-10 text-left">
            <ModalTitle className="text-balance text-[1.6rem] leading-tight tracking-tight sm:text-[1.85rem]">
              {title}
            </ModalTitle>
            <ModalDescription className="max-w-[34ch] text-[15px] leading-6 sm:text-base sm:leading-7">
              {description}
            </ModalDescription>
          </ModalHeader>
          {body}
          {footer ? (
            <ModalFooter className="mt-6 border-t border-border/70 pt-4 sm:pt-5">
              {footer}
            </ModalFooter>
          ) : null}
        </ModalContent>
      </Modal>
    </div>
  );
}

export const DesktopDialog: Story = {
  name: "Desktop (Dialog)",
  parameters: {
    viewport: { defaultViewport: "desktop" },
  },
  render: () => (
    <ModalShell
      forceMobile={false}
      title="Unlock this content"
      description="Add a small amount to your wallet to unlock the full track and keep it in your library."
      footer={(
        <>
          <Button size="lg" variant="outline">Maybe later</Button>
          <Button size="lg">Add funds</Button>
        </>
      )}
    />
  ),
};

export const MobileSheetBottom: Story = {
  name: "Mobile (Sheet — bottom)",
  parameters: {
    viewport: { defaultViewport: "mobile1" },
  },
  render: () => (
    <ModalShell
      forceMobile
      mobileSide="bottom"
      title="Unlock this content"
      description="Add a small amount to your wallet to unlock the full track and keep it in your library."
      footer={(
        <>
          <Button className="w-full" size="lg" variant="outline">Maybe later</Button>
          <Button className="w-full" size="lg">Add funds</Button>
        </>
      )}
    />
  ),
};

export const MobileSheetRight: Story = {
  name: "Desktop (Dialog / Compact)",
  parameters: {
    viewport: { defaultViewport: "desktop" },
  },
  render: () => (
    <ModalShell
      forceMobile={false}
      title="Unlock this content"
      description="Add funds to continue."
      footer={(
        <>
          <Button size="lg" variant="outline">Cancel</Button>
          <Button size="lg">Add funds</Button>
        </>
      )}
    />
  ),
};

export const PurchaseFlow: Story = {
  name: "Purchase Flow",
  parameters: {
    viewport: { defaultViewport: "desktop" },
  },
  render: () => (
    <ModalShell
      forceMobile={false}
      title="Add funds to unlock"
      description="Add funds to continue."
      body={(
        <div className="mt-6 grid gap-4">
          <div className="rounded-[1.25rem] border border-border bg-muted/35 p-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                  Needed now
                </p>
                <p className="mt-2 text-3xl font-semibold tracking-tight text-foreground">$0.50</p>
              </div>
              <Badge variant="secondary" className="font-medium">Instant unlock</Badge>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl border border-border bg-card p-4">
              <p className="text-sm font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                Track price
              </p>
              <p className="mt-2 text-xl font-semibold tracking-tight text-foreground">$0.50</p>
            </div>
            <div className="rounded-xl border border-border bg-card p-4">
              <p className="text-sm font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                Wallet balance
              </p>
              <p className="mt-2 text-xl font-semibold tracking-tight text-foreground">$0.00</p>
            </div>
          </div>
        </div>
      )}
      footer={(
        <>
          <Button size="lg" variant="outline">View wallet</Button>
          <Button size="lg">Add test funds</Button>
        </>
      )}
    />
  ),
};

export const PurchaseFlowMobile: Story = {
  name: "Purchase Flow (Mobile)",
  parameters: {
    viewport: { defaultViewport: "mobile1" },
  },
  render: () => (
    <ModalShell
      forceMobile
      title="Add funds to unlock"
      description="Add funds to continue."
      body={(
        <div className="mt-6 grid gap-3.5">
          <div className="rounded-[1.25rem] border border-border bg-muted/35 p-4">
            <p className="text-sm font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              Needed now
            </p>
            <p className="mt-2 text-3xl font-semibold tracking-tight text-foreground">$0.50</p>
          </div>

          <div className="grid gap-3">
            <div className="rounded-xl border border-border bg-card p-4">
              <p className="text-sm font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                Track price
              </p>
              <p className="mt-2 text-xl font-semibold tracking-tight text-foreground">$0.50</p>
            </div>
            <div className="rounded-xl border border-border bg-card p-4">
              <p className="text-sm font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                Wallet balance
              </p>
              <p className="mt-2 text-xl font-semibold tracking-tight text-foreground">$0.00</p>
            </div>
          </div>
        </div>
      )}
      footer={(
        <>
          <Button className="w-full" size="lg" variant="outline">View wallet</Button>
          <Button className="w-full" size="lg">Add test funds</Button>
        </>
      )}
    />
  ),
};
