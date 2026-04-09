import type { Meta, StoryObj } from "@storybook/react-vite";
import * as React from "react";
import { ChevronDown } from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./dropdown-menu";
import { Button } from "./button";
import { cn } from "@/lib/utils";
import { Pill } from "./pill";

const meta = {
  title: "Primitives/DropdownMenu",
  component: DropdownMenuContent,
} satisfies Meta<typeof DropdownMenuContent>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline">Open Menu</Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuItem>Profile</DropdownMenuItem>
        <DropdownMenuItem>Settings</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem>Log out</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  ),
};

function MultiSelectDemo() {
  const [selected, setSelected] = React.useState<string[]>([]);

  const qualifiers = [
    { id: "qlf_unique_human", label: "Unique Human" },
    { id: "qlf_age_over_18", label: "18+" },
    { id: "qlf_nationality_us", label: "US National" },
    { id: "qlf_palm_scan", label: "Palm Scan" },
  ];

  const toggle = (id: string) =>
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  return (
    <div className="w-[320px] space-y-3">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            className="w-full justify-between"
            variant="secondary"
            trailingIcon={<ChevronDown className="size-5 text-muted-foreground" />}
          >
            {selected.length > 0
              ? `${selected.length} qualifier${selected.length === 1 ? "" : "s"} attached`
              : "Add qualifiers"}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-[var(--radix-dropdown-menu-trigger-width)]">
          {qualifiers.map((q) => {
            const checked = selected.includes(q.id);
            return (
              <DropdownMenuItem
                key={q.id}
                className={cn("justify-between", checked && "bg-muted text-foreground")}
                onSelect={(event) => {
                  event.preventDefault();
                  toggle(q.id);
                }}
              >
                <span className="text-sm">{q.label}</span>
                <span className="ml-auto text-sm">{checked ? "✓" : null}</span>
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuContent>
      </DropdownMenu>
      <div className="flex min-h-[32px] flex-wrap content-start gap-2">
        {selected.map((id) => {
          const q = qualifiers.find((x) => x.id === id)!;
          return (
            <Pill key={id} onClick={() => toggle(id)}>
              {q.label}
            </Pill>
          );
        })}
      </div>
    </div>
  );
}

export const MultiSelect: Story = {
  name: "Multiselect (Qualifiers)",
  render: () => <MultiSelectDemo />,
};
