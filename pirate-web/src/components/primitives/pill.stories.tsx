import type { Meta, StoryObj } from "@storybook/react-vite";
import * as React from "react";

import { Pill } from "./pill";
import { cn } from "@/lib/utils";

const meta = {
  title: "Primitives/Pill",
  component: Pill,
} satisfies Meta<typeof Pill>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <div className="flex flex-wrap gap-2">
      <Pill>Default</Pill>
      <Pill variant="selected">Selected</Pill>
      <Pill variant="outline">Outline</Pill>
      <Pill variant="active">Active</Pill>
    </div>
  ),
};

export const Sizes: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-2">
      <Pill size="sm">Small</Pill>
      <Pill size="md">Medium</Pill>
      <Pill variant="selected" size="sm">Small selected</Pill>
      <Pill variant="selected" size="md">Medium selected</Pill>
    </div>
  ),
};

function SelectableGroupDemo() {
  const [value, setValue] = React.useState("solo");

  const options = [
    { value: "solo", label: "Solo" },
    { value: "collab", label: "Collab" },
    { value: "open_mic", label: "Open Mic" },
  ];

  return (
    <div className="flex flex-wrap gap-2">
      {options.map((opt) => (
        <Pill
          key={opt.value}
          variant={value === opt.value ? "selected" : "default"}
          onClick={() => setValue(opt.value)}
        >
          {opt.label}
        </Pill>
      ))}
    </div>
  );
}

export const SelectableGroup: Story = {
  name: "Selectable group",
  render: () => <SelectableGroupDemo />,
};

function RemovableDemo() {
  const [items, setItems] = React.useState(["Unique Human", "18+", "US National"]);

  const remove = (label: string) => setItems((prev) => prev.filter((x) => x !== label));

  return (
    <div className="flex flex-wrap gap-2">
      {items.map((item) => (
        <Pill key={item} onClick={() => remove(item)}>
          {item}
        </Pill>
      ))}
    </div>
  );
}

export const Removable: Story = {
  render: () => <RemovableDemo />,
};

function SegmentedTrackDemo() {
  const [value, setValue] = React.useState("original");

  const options = ["original", "remix"] as const;

  return (
    <div className="flex items-center gap-2 rounded-full bg-muted p-1">
      {options.map((opt) => (
        <button
          key={opt}
          className={cn(
            "rounded-full px-3 py-1.5 text-sm font-medium capitalize transition-colors",
            value === opt
              ? "bg-card text-foreground shadow-sm"
              : "text-muted-foreground",
          )}
          onClick={() => setValue(opt)}
          type="button"
        >
          {opt}
        </button>
      ))}
    </div>
  );
}

export const SegmentedTrack: Story = {
  name: "Segmented track",
  render: () => <SegmentedTrackDemo />,
};
