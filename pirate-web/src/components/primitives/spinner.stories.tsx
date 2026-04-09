import type { Meta, StoryObj } from "@storybook/react-vite";

import { Spinner } from "./spinner";
import { Button } from "./button";

const meta = {
  title: "Primitives/Spinner",
  component: Spinner,
} satisfies Meta<typeof Spinner>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <div className="flex items-center gap-6">
      <Spinner />
      <Spinner className="size-3" />
      <Spinner className="size-6" />
      <Spinner className="size-8" />
    </div>
  ),
};

export const InButton: Story = {
  name: "In button (loading)",
  render: () => (
    <div className="flex flex-wrap items-center gap-4">
      <Button loading>Loading...</Button>
      <Button loading variant="outline">Please wait</Button>
      <Button loading variant="secondary">Processing</Button>
      <Button loading variant="destructive">Deleting...</Button>
    </div>
  ),
};

export const OnMuted: Story = {
  name: "On muted background",
  render: () => (
    <div className="inline-flex items-center gap-2 rounded-full bg-muted px-3 py-2 text-sm font-medium">
      <Spinner className="size-4" />
      <span>Syncing...</span>
    </div>
  ),
};
