import type { Meta, StoryObj } from "@storybook/react-vite";
import { BadgeCheck } from "lucide-react";

import { Badge } from "./badge";

const meta = {
  title: "Primitives/Badge",
  component: Badge,
  args: {
    children: "Badge",
  },
} satisfies Meta<typeof Badge>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Variants: Story = {
  render: () => (
    <div className="flex flex-wrap gap-2">
      <Badge>Default</Badge>
      <Badge variant="secondary">Secondary</Badge>
      <Badge variant="success">Verified</Badge>
      <Badge variant="warning">Pending</Badge>
      <Badge variant="destructive">Needs review</Badge>
      <Badge variant="outline">Outline</Badge>
    </div>
  ),
};

export const WithIcon: Story = {
  render: () => (
    <div className="flex flex-wrap gap-2">
      <Badge variant="success">
        <BadgeCheck className="size-4" />
        Verified
      </Badge>
      <Badge>
        <BadgeCheck className="size-4" />
        Namespace
      </Badge>
    </div>
  ),
};
