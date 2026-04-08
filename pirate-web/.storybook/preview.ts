import * as React from "react";
import type { Preview } from "@storybook/react-vite";
import "../src/styles/tokens.css";

function StorybookThemeRoot({
  mode,
  children,
}: {
  mode: "dark" | "light" | "system";
  children?: React.ReactNode;
}) {
  React.useEffect(() => {
    const root = document.documentElement;
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    const useDark = mode === "dark" || (mode === "system" && prefersDark);

    root.classList.toggle("dark", useDark);
    root.dataset.theme = mode;

    return () => {
      root.classList.remove("dark");
      delete root.dataset.theme;
    };
  }, [mode]);

  return React.createElement(React.Fragment, null, children);
}

const preview: Preview = {
  decorators: [
    (Story, context) =>
      React.createElement(
        StorybookThemeRoot,
        { mode: context.globals.theme as "dark" | "light" | "system" },
        React.createElement(Story),
      ),
  ],
  globalTypes: {
    theme: {
      name: "Theme",
      description: "Global app theme",
      defaultValue: "dark",
      toolbar: {
        icon: "mirror",
        items: [
          { value: "dark", title: "Dark" },
          { value: "light", title: "Light" },
          { value: "system", title: "System" },
        ],
      },
    },
  },
  initialGlobals: {
    theme: "dark",
  },
  parameters: {
    backgrounds: {
      default: "app-bg",
      values: [
        { name: "app-bg", value: "#222324" },
        { name: "dark", value: "#09090b" },
        { name: "light", value: "#ffffff" },
      ],
    },
    layout: "centered",
  },
};

export default preview;
