import type { Meta, StoryObj } from "@storybook/react-vite";
import { Pause, Play } from "@phosphor-icons/react";

import { MediaControlButton } from "./media-control-button";

const meta = {
  title: "Primitives/MediaControlButton",
  component: MediaControlButton,
} satisfies Meta<typeof MediaControlButton>;

export default meta;

type Story = StoryObj<typeof meta>;

export const States: Story = {
  render: () => (
    <div className="flex items-center gap-3 bg-neutral-900 p-6">
      <MediaControlButton aria-label="Play">
        <Play className="size-5" weight="fill" />
      </MediaControlButton>
      <MediaControlButton aria-label="Pause">
        <Pause className="size-5" weight="fill" />
      </MediaControlButton>
      <MediaControlButton intent="subtle" aria-label="Subtle play">
        <Play className="size-5" weight="fill" />
      </MediaControlButton>
      <MediaControlButton intent="muted" aria-label="Muted play">
        <Play className="size-5" weight="fill" />
      </MediaControlButton>
    </div>
  ),
};
