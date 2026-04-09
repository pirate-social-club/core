import type { Meta, StoryObj } from "@storybook/react-vite";
import * as React from "react";

import { CreateGuildComposer } from "../create-guild-composer";
import type { CreateGuildComposerProps } from "../create-guild-composer.types";

const baseComposer: CreateGuildComposerProps = {
  displayName: "American Voices",
  description:
    "A national-interest guild where verified context matters, but moderation still needs a safe anonymous layer.",
  membershipMode: "request",
  governanceMode: "centralized",
  defaultAgeGatePolicy: "none",
  allowAnonymousIdentity: true,
  endaomentUrl: "https://app.endaoment.org/orgs/musicares",
  namespace: {
    family: "hns",
    externalRoot: ".american",
    importStatus: "verified",
    ownerLabel: "0x83c4...f91a",
    hnsDelegationMode: "pirate_managed",
    expiryDaysRemaining: 247,
    pirateDnsDetected: true,
  },
  handlePolicy: {
    policyTemplate: "standard",
    pricingModel: "free",
    membershipRequiredForClaim: true,
  },
};

const verifiedMultisig = {
  chainId: "8453",
  contractAddress: "0x29fcB43b46531BcA003ddC8FCB67FFE91900C762",
  treasurySameAsContract: true,
  displayLabel: "American Voices Treasury",
  verificationState: "verified" as const,
  owners: ["sim_signer_1", "sim_signer_2", "sim_signer_3"],
  threshold: 2,
  implementationLabel: "Safe v1.4.1",
  masterCopyAddress: "0x29fcB43b46531BcA003ddC8FCB67FFE91900C762",
  warnings: ["Module inspection is partial in v0. Advanced modules still require manual review."],
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
        spacesHandleMode: "owner_managed",
      }}
    />
  ),
};

export const HnsInspected: Story = {
  name: "Flow / HNS Inspected",
  render: () => (
    <CreateGuildComposer
      {...baseComposer}
      namespace={{
        family: "hns",
        externalRoot: ".american",
        importStatus: "inspected",
        ownerLabel: "",
        hnsDelegationMode: "owner_managed",
        expiryDaysRemaining: 247,
        pirateDnsDetected: false,
      }}
    />
  ),
};

export const HnsTxtChallenge: Story = {
  name: "Flow / HNS TXT Challenge",
  render: () => (
    <CreateGuildComposer
      {...baseComposer}
      namespace={{
        family: "hns",
        externalRoot: ".american",
        importStatus: "txt_challenge_ready",
        ownerLabel: "",
        hnsDelegationMode: "owner_managed",
        expiryDaysRemaining: 247,
        pirateDnsDetected: false,
        txtChallenge: "pirate-verify=a3f7c9e2",
      }}
    />
  ),
};

export const HnsNearExpiry: Story = {
  name: "Flow / HNS Near Expiry",
  render: () => (
    <CreateGuildComposer
      {...baseComposer}
      namespace={{
        family: "hns",
        externalRoot: ".american",
        importStatus: "txt_challenge_ready",
        ownerLabel: "",
        hnsDelegationMode: "owner_managed",
        expiryDaysRemaining: 45,
        pirateDnsDetected: false,
        txtChallenge: "pirate-verify=a3f7c9e2",
      }}
    />
  ),
};

export const AdultOnly: Story = {
  name: "Flow / Adult Only",
  render: () => <CreateGuildComposer {...baseComposer} defaultAgeGatePolicy="18_plus" initialStep={4} />,
};

export const MultisigVerified: Story = {
  name: "Flow / Multisig Verified",
  render: () => (
    <CreateGuildComposer {...baseComposer} governanceMode="multisig" multisig={verifiedMultisig} initialStep={4} />
  ),
};

export const MultisigPending: Story = {
  name: "Flow / Multisig Pending",
  render: () => (
    <CreateGuildComposer
      {...baseComposer}
      governanceMode="multisig"
      multisig={{
        chainId: "8453",
        contractAddress: "0x06f94e552f6f0b5e5dd0a1d8e0e8d7e5b5a8d5d3",
        treasurySameAsContract: true,
        displayLabel: "American Voices Council",
        verificationState: "pending",
      }}
      initialStep={4}
    />
  ),
};

export const MultisigNotAttached: Story = {
  name: "Flow / Multisig Not Attached",
  render: () => (
    <CreateGuildComposer
      {...baseComposer}
      governanceMode="multisig"
      multisig={{
        chainId: "8453",
        treasurySameAsContract: true,
        verificationState: "not_attached",
      }}
      initialStep={4}
    />
  ),
};

export const MultisigBroken: Story = {
  name: "Flow / Multisig Broken",
  render: () => (
    <CreateGuildComposer
      {...baseComposer}
      governanceMode="multisig"
      multisig={{
        chainId: "1",
        contractAddress: "0x29fcB43b46531BcA003ddC8FCB67FFE91900C762",
        treasurySameAsContract: true,
        displayLabel: "American Voices Treasury",
        verificationState: "broken",
        warnings: ["Pirate can no longer confirm the Safe backend. Re-run verification before creating the guild."],
      }}
      initialStep={4}
    />
  ),
};

export const MajeurPlaceholder: Story = {
  name: "Flow / Majeur Placeholder",
  render: () => <CreateGuildComposer {...baseComposer} governanceMode="majeur" initialStep={4} />,
};

export const HandlePolicyStep: Story = {
  name: "Flow / Handle Policy Step",
  render: () => <CreateGuildComposer {...baseComposer} handlePolicy={undefined} initialStep={3} />,
};

export const ReviewStep: Story = {
  name: "Flow / Review",
  render: () => <CreateGuildComposer {...baseComposer} initialStep={5} />,
};

export const CreatorNotEligible: Story = {
  name: "Flow / Creator Not Eligible",
  render: () => <CreateGuildComposer {...baseComposer} creatorEligible={false} />,
};
