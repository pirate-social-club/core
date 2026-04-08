"use client";

import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";

import { cn } from "@/lib/utils";
import { useIsMobile } from "@/hooks/use-mobile";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/primitives/dialog";
import {
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/primitives/sheet";

export const ModalResponsiveContext = React.createContext<boolean | null>(null);

function useModalIsMobile() {
  const contextValue = React.useContext(ModalResponsiveContext);

  if (contextValue === null) {
    throw new Error("Modal components must be rendered within <Modal>.");
  }

  return contextValue;
}

interface ModalProps extends React.ComponentProps<typeof Dialog> {
  forceMobile?: boolean;
}

function Modal({ forceMobile, ...props }: ModalProps) {
  const detectedMobile = useIsMobile();
  const isMobile = forceMobile ?? detectedMobile;

  return (
    <ModalResponsiveContext.Provider value={isMobile}>
      <Dialog {...props} />
    </ModalResponsiveContext.Provider>
  );
}

interface ModalContentProps
  extends React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> {
  mobileSide?: "top" | "bottom" | "left" | "right";
}

const ModalContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  ModalContentProps
>(({ className, mobileSide = "bottom", ...props }, ref) => {
  const isMobile = useModalIsMobile();

  if (isMobile) {
    return <SheetContent className={className} ref={ref} side={mobileSide} {...props} />;
  }

  return <DialogContent className={className} ref={ref} {...props} />;
});
ModalContent.displayName = "ModalContent";

const ModalHeader = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => {
  const isMobile = useModalIsMobile();
  const Comp = isMobile ? SheetHeader : DialogHeader;

  return <Comp className={className} {...props} />;
};
ModalHeader.displayName = "ModalHeader";

const ModalFooter = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => {
  const isMobile = useModalIsMobile();
  const Comp = isMobile ? SheetFooter : DialogFooter;

  return <Comp className={className} {...props} />;
};
ModalFooter.displayName = "ModalFooter";

const ModalTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => {
  const isMobile = useModalIsMobile();
  const Comp = isMobile ? SheetTitle : DialogTitle;

  return <Comp className={cn(className)} ref={ref} {...props} />;
});
ModalTitle.displayName = "ModalTitle";

const ModalDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => {
  const isMobile = useModalIsMobile();
  const Comp = isMobile ? SheetDescription : DialogDescription;

  return <Comp className={cn(className)} ref={ref} {...props} />;
});
ModalDescription.displayName = "ModalDescription";

export {
  Modal,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  ModalTitle,
};
