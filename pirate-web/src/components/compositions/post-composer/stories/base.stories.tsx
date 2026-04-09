import type { Meta, StoryObj } from "@storybook/react-vite";
import * as React from "react";

import { PostComposer } from "../post-composer";
import type { PostComposerProps } from "../post-composer.types";

const baseComposer: PostComposerProps = {
  clubName: "g/yeezy",
  clubAvatarSrc: "https://picsum.photos/seed/yeezy/80/80",
  draftsLabel: "Drafts",
  mode: "text",
  availableTabs: ["text", "image", "video", "link", "song", "live"],
  canCreateSongPost: true,
  titleValue: "What is the best Ye opener?",
  titleCountLabel: "29/300",
  textBodyValue:
    "Keep it close to Reddit: title first, content next, extras collapsed. Pirate-specific flows should only appear when the content actually calls for them.",
  identity: {
    allowAnonymousIdentity: true,
    allowQualifiersOnAnonymousPosts: true,
    identityMode: "public",
    publicHandle: "@saint-pablo",
    anonymousLabel: "anon_mercury-17",
    availableQualifiers: [
      {
        qualifierId: "qlf_unique_human",
        label: "Unique Human",
        description: "Verified uniqueness",
        sensitivityLevel: "low",
        sourceProvider: "self",
        sourceField: "unique_human",
        redundancyKey: "unique_human:true",
      },
      {
        qualifierId: "qlf_age_over_18",
        label: "18+",
        description: "Adult",
        sensitivityLevel: "low",
        sourceProvider: "self",
        sourceField: "minimumAge",
        redundancyKey: "age_over_18:true",
      },
      {
        qualifierId: "qlf_nationality_us",
        label: "US National",
        description: "Nationality",
        sensitivityLevel: "high",
        sourceProvider: "self",
        sourceField: "nationality",
        redundancyKey: "nationality:US",
        suppressedByClubGate: true,
        suppressionReason: "Already required for posting in this club.",
      },
    ],
    selectedQualifierIds: [],
    helpText:
      "Attach optional qualifiers to add authority. Anything already required by this club stays hidden.",
  },
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

export const DefaultClubAllTypes: Story = {
  name: "Club / Default All Post Types",
  render: () => <PostComposer {...baseComposer} />,
};

export const PublicHandleOnly: Story = {
  name: "Club / No Optional Qualifiers",
  render: () => (
    <PostComposer
      {...baseComposer}
      identity={{
        allowAnonymousIdentity: true,
        identityMode: "public",
        publicHandle: "@saint-pablo",
        anonymousLabel: "anon_mercury-17",
        availableQualifiers: [],
      }}
    />
  ),
};

export const QualifiersDropdown: Story = {
  name: "Club / Qualifiers Dropdown",
  render: () => (
    <PostComposer
      {...baseComposer}
      identity={{
        allowAnonymousIdentity: true,
        allowQualifiersOnAnonymousPosts: true,
        identityMode: "anonymous",
        publicHandle: "@saint-pablo",
        anonymousLabel: "anon_mercury-17",
        availableQualifiers: [
          {
            qualifierId: "qlf_unique_human",
            label: "Unique Human",
            description: "Verified uniqueness",
            sensitivityLevel: "low",
            sourceProvider: "self",
            sourceField: "unique_human",
            redundancyKey: "unique_human:true",
          },
          {
            qualifierId: "qlf_age_over_18",
            label: "18+",
            description: "Adult",
            sensitivityLevel: "low",
            sourceProvider: "self",
            sourceField: "minimumAge",
            redundancyKey: "age_over_18:true",
          },
          {
            qualifierId: "qlf_nationality_us",
            label: "US National",
            description: "Nationality",
            sensitivityLevel: "high",
            sourceProvider: "self",
            sourceField: "nationality",
            redundancyKey: "nationality:US",
            suppressedByClubGate: true,
          },
          {
            qualifierId: "qlf_very_palm_scan",
            label: "Palm Scan",
            description: "Very biometric verification",
            sensitivityLevel: "low",
            sourceProvider: "very",
            sourceField: "palm_scan",
          },
        ],
        selectedQualifierIds: ["qlf_unique_human", "qlf_age_over_18", "qlf_very_palm_scan"],
        helpText:
          "Select any qualifiers that add authority to this post. Club-required ones are omitted.",
      }}
    />
  ),
};

export const ClubGateSuppressesQualifier: Story = {
  name: "Club / Gate Suppresses Qualifier",
  render: () => (
    <PostComposer
      {...baseComposer}
      clubName="g/america"
      identity={{
        allowAnonymousIdentity: true,
        identityMode: "anonymous",
        publicHandle: "@saint-pablo",
        anonymousLabel: "anon_america-17",
        availableQualifiers: [
          {
            qualifierId: "qlf_unique_human",
            label: "Unique Human",
            sensitivityLevel: "low",
            sourceProvider: "self",
            sourceField: "unique_human",
            redundancyKey: "unique_human:true",
          },
          {
            qualifierId: "qlf_nationality_us",
            label: "US National",
            sensitivityLevel: "high",
            sourceProvider: "self",
            sourceField: "nationality",
            redundancyKey: "nationality:US",
            suppressedByClubGate: true,
            suppressionReason: "US nationality is already required to post in this club.",
          },
        ],
        selectedQualifierIds: ["qlf_unique_human"],
        helpText:
          "US nationality is already enforced by the club gate, so it does not appear as an optional qualifier.",
      }}
    />
  ),
};

export const AnonymousWithoutQualifierDisclosure: Story = {
  name: "Club / Anonymous Without Qualifier Disclosure",
  render: () => (
    <PostComposer
      {...baseComposer}
      identity={{
        allowAnonymousIdentity: true,
        allowQualifiersOnAnonymousPosts: false,
        identityMode: "anonymous",
        publicHandle: "@saint-pablo",
        anonymousLabel: "anon_mercury-17",
        availableQualifiers: [
          {
            qualifierId: "qlf_unique_human",
            label: "Unique Human",
            description: "Verified uniqueness",
            sensitivityLevel: "low",
            sourceProvider: "self",
            sourceField: "unique_human",
            redundancyKey: "unique_human:true",
          },
          {
            qualifierId: "qlf_age_over_18",
            label: "18+",
            description: "Adult",
            sensitivityLevel: "low",
            sourceProvider: "self",
            sourceField: "minimumAge",
            redundancyKey: "age_over_18:true",
          },
        ],
        selectedQualifierIds: [],
        helpText:
          "This club allows anonymous posting but does not allow qualifier disclosure on anonymous posts.",
      }}
    />
  ),
};

export const ImagePost: Story = {
  name: "Flow / Image",
  render: () => (
    <PostComposer
      {...baseComposer}
      mode="image"
      titleValue="Backstage at the show"
      titleCountLabel="21/300"
      textBodyValue=""
      captionValue="Caught this backstage right before the set."
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

export const LinkPost: Story = {
  name: "Flow / Link",
  render: () => (
    <PostComposer
      {...baseComposer}
      mode="link"
      titleValue="Interview on the design of Yeezus era staging"
      titleCountLabel="46/300"
      captionValue="Worth posting for the production notes alone."
      linkUrlValue="https://032c.com/magazine/kanye-west-tour-design"
      linkPreview={{
        title: "Inside the Visual Language of the Yeezus Tour",
        domain: "032c.com",
        description:
          "A look at staging, projection, and performance design choices that shaped the live show.",
        imageSrc: "https://picsum.photos/seed/yeezus-link/320/180",
      }}
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
      titleValue="Benefit single for the club drop"
      titleCountLabel="36/300"
      captionValue="Sale listing with optional creator-side donation."
      lyricsValue="Raise the room up / hold the line / send the chorus over..."
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

export const LiveStream: Story = {
  name: "Flow / Live Stream",
  render: () => (
    <PostComposer
      {...baseComposer}
      mode="live"
      availableTabs={["text", "image", "video", "link", "song", "live"]}
      titleValue="Friday night set"
      titleCountLabel="16/300"
      live={{
        roomKind: "solo",
        accessMode: "free",
        visibility: "public",
        setlistItems: [
          {
            declaredTrackId: "trk_01midnightwaves",
            titleText: "Midnight Waves",
            artistText: "DJ Solar",
            performanceKind: "original",
          },
          {
            declaredTrackId: "trk_01echoes",
            titleText: "Echoes",
            artistText: "DJ Solar",
            performanceKind: "original",
          },
          {
            titleText: "Blue",
            artistText: "Joni Mitchell",
            performanceKind: "cover",
          },
        ],
        setlistStatus: "draft",
        performerAllocations: [{ userId: "", role: "host", sharePct: 100 }],
      }}
    />
  ),
};
