import type { Meta, StoryObj } from "@storybook/react-vite";

import { Avatar } from "./avatar";
import { MusicNote } from "@phosphor-icons/react";

const meta = {
  title: "Primitives/Avatar",
  component: Avatar,
  args: {
    fallback: "John Doe",
    size: "md",
  },
  argTypes: {
    size: {
      control: "select",
      options: ["xs", "sm", "md", "lg"],
    },
  },
} satisfies Meta<typeof Avatar>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Sizes: Story = {
  render: () => (
    <div className="flex items-end gap-3">
      <Avatar fallback="JD" size="xs" />
      <Avatar fallback="JD" size="sm" />
      <Avatar fallback="JD" size="md" />
      <Avatar fallback="JD" size="lg" />
    </div>
  ),
};

export const WithImage: Story = {
  render: () => (
    <div className="flex items-end gap-3">
      <Avatar fallback="John Doe" size="sm" src="https://i.pravatar.cc/100?img=1" />
      <Avatar fallback="Jane Doe" size="md" src="https://i.pravatar.cc/100?img=5" />
      <Avatar fallback="Bob Smith" size="lg" src="https://i.pravatar.cc/100?img=8" />
    </div>
  ),
};

export const WithFallbackIcon: Story = {
  render: () => (
    <div className="flex items-end gap-3">
      <Avatar fallback="Music" size="sm" fallbackIcon={<MusicNote className="size-5 text-muted-foreground" />} />
      <Avatar fallback="Music" size="md" fallbackIcon={<MusicNote className="size-5 text-muted-foreground" />} />
    </div>
  ),
};

export const LoadingState: Story = {
  render: () => (
    <div className="flex items-end gap-3">
      <Avatar fallback="" size="sm" />
      <Avatar fallback="" size="md" />
      <Avatar fallback="" size="lg" />
    </div>
  ),
};
