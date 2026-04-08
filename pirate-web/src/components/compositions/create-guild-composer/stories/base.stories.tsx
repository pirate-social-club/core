import type { Meta, StoryObj } from "@storybook/react-vite";
import * as React from "react";

import { CreateGuildComposer } from "../create-guild-composer";
import type { CreateGuildComposerProps } from "../create-guild-composer.types";

const baseComposer: CreateGuildComposerProps = {
  displayName: "American Voices",
  description:
    "A national-interest guild where verified context matters, but moderation still needs a safe anonymous layer.",
  membershipMode: "request",
  governanceMode: "creator_led",
  defaultAgeGatePolicy: "none",
  allowAnonymousIdentity: true,
  endaomentUrl: "https://app.endaoment.org/orgs/musicares",
  namespace: {
    family: "hns",
    externalRoot: ".american",
    importStatus: "verified",
    ownerLabel: "0x83c4...f91a",
    hnsDelegationMode: "pirate_managed",
  },
};

const meta = {
  title: "Compositions/CreateGuildComposer",
  component: CreateGuildComposer,
  args: baseComposer,
  decorators: [
    (Story: () => React.ReactNode) => (
      <div style={{ width: "min(100vw - 32px, 980px)" }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof CreateGuildComposer>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
  name: "Flow / Default",
  render: () => <CreateGuildComposer {...baseComposer} />,
};

export const PublicOnly: Story = {
  name: "Flow / Public Only",
  render: () => <CreateGuildComposer {...baseComposer} allowAnonymousIdentity={false} />,
};

export const SpacesImportPending: Story = {
  name: "Flow / Spaces Import Pending",
  render: () => (
    <CreateGuildComposer
      {...baseComposer}
      namespace={{
        family: "spaces",
        externalRoot: "@american",
        importStatus: "pending",
        ownerLabel: "pending proof",
        hnsDelegationMode: "owner_managed",
        spacesHandleMode: "owner_managed",
      }}
    />
  ),
};

export const AdultOnly: Story = {
  name: "Flow / Adult Only",
  render: () => <CreateGuildComposer {...baseComposer} defaultAgeGatePolicy="18_plus" />,
};
