"use client";

import * as React from "react";
import { Toaster as Sonner, toast } from "sonner";

type ToasterTheme = "dark" | "light" | "system";

function useDocumentTheme(): ToasterTheme {
  const [theme, setTheme] = React.useState<ToasterTheme>("system");

  React.useEffect(() => {
    const root = document.documentElement;
    const readTheme = () => {
      setTheme(root.classList.contains("dark") ? "dark" : "light");
    };

    readTheme();

    const observer = new MutationObserver(readTheme);
    observer.observe(root, {
      attributeFilter: ["class", "data-theme"],
      attributes: true,
    });

    return () => {
      observer.disconnect();
    };
  }, []);

  return theme;
}

export function Toaster() {
  const theme = useDocumentTheme();

  return (
    <Sonner
      closeButton
      position="bottom-right"
      richColors
      theme={theme}
      toastOptions={{
        classNames: {
          actionButton:
            "!bg-primary !text-primary-foreground hover:!bg-primary/90",
          cancelButton:
            "!bg-secondary !text-secondary-foreground hover:!bg-secondary/85",
          description: "!text-muted-foreground",
          error:
            "!border-rose-500/25 !bg-surface-toast-error !text-foreground",
          info:
            "!border-border-soft !bg-surface-toast-info !text-foreground",
          success:
            "!border-emerald-500/20 !bg-surface-toast-success !text-foreground",
          toast:
            "!rounded-[var(--radius-xl)] !border !shadow-[var(--shadow-lg)] !backdrop-blur-md",
          title: "!text-sm !font-semibold !text-foreground",
          warning:
            "!border-amber-500/20 !bg-surface-toast-warning !text-foreground",
        },
      }}
    />
  );
}

export { toast };
