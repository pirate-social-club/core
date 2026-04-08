import type { Meta, StoryObj } from "@storybook/react-vite";
import * as React from "react";

import { PostComposer } from "../post-composer";
import type { PostComposerProps } from "../post-composer.types";

const baseComposer: PostComposerProps = {
  guildName: "g/yeezy",
  guildAvatarSrc: "https://picsum.photos/seed/yeezy/80/80",
  draftsLabel: "Drafts",
  mode: "text",
  canCreateSongPost: true,
  titleValue: "What is the best Ye opener?",
  titleCountLabel: "29/300",
  textBodyValue:
    "Keep it close to Reddit: title first, content next, extras collapsed. Pirate-specific flows should only appear when the content actually calls for them.",
};

const meta = {
  title: "Compositions/PostComposer",
  component: PostComposer,
  args: baseComposer,
  decorators: [
    (Story: () => React.ReactNode) => (
      <div style={{ width: "min(100vw - 32px, 980px)" }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof PostComposer>;

export default meta;

type Story = StoryObj<typeof meta>;

export const DefaultText: Story = {
  name: "Flow / Default Text",
  render: () => <PostComposer {...baseComposer} />,
};

export const ImagePost: Story = {
  name: "Flow / Image",
  render: () => (
    <PostComposer
      {...baseComposer}
      mode="image"
      titleValue="Tour photo dump from last night"
      titleCountLabel="31/300"
      textBodyValue=""
      captionValue="Backstage, crowd shots, and the broken synth in slide four."
    />
  ),
};

export const VideoWithFallbackReference: Story = {
  name: "Flow / Video With Fallback Reference Search",
  render: () => (
    <PostComposer
      {...baseComposer}
      mode="video"
      titleValue="Fan edit from the encore"
      titleCountLabel="24/300"
      captionValue="Posting the cut now. Attribution can stay tucked away unless needed."
    />
  ),
};

export const SongRemix: Story = {
  name: "Flow / Song Remix",
  render: () => (
    <PostComposer
      {...baseComposer}
      mode="song"
      canCreateSongPost
      canGoLive
      titleValue="Midnight Waves (club mix)"
      titleCountLabel="27/300"
      captionValue="Test mix before publishing the asset-bearing version."
      lyricsValue="Meet me in the red light / carry the chorus through the floor..."
      songMode="remix"
      derivativeStep={{
        visible: true,
        required: true,
        trigger: "remix",
        query: "midnight waves original",
        references: [
          {
            id: "ast_01abc",
            title: "Midnight Waves",
            subtitle: "Original source track",
          },
        ],
        requirementLabel: "Attach the original track before posting.",
      }}
      moreOptions={{
        open: true,
        ageGateChecked: false,
      }}
    />
  ),
};

export const MonetizedDonationFlow: Story = {
  name: "Flow / Monetized Donation",
  render: () => (
    <PostComposer
      {...baseComposer}
      mode="song"
      canCreateSongPost
      titleValue="Benefit single for the guild drop"
      titleCountLabel="36/300"
      captionValue="Sale listing with optional creator-side donation."
      lyricsValue="Raise the room up / hold the line / send the chorus over..."
      moreOptions={{
        open: true,
        ageGateChecked: false,
      }}
      monetization={{
        visible: true,
        priceLabel: "$3.99",
        donationAvailable: true,
        donationOptIn: true,
        donationPartnerName: "MusiCares",
        donationSharePct: 10,
      }}
    />
  ),
};

export const RoomPost: Story = {
  name: "Flow / Room",
  render: () => (
    <PostComposer
      {...baseComposer}
      mode="room"
      titleValue="808s listening room tonight"
      titleCountLabel="27/300"
      captionValue="Open room for a track-by-track listen, karaoke runs, and live reactions."
    />
  ),
};
