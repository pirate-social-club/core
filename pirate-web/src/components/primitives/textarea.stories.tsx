import type { Meta, StoryObj } from "@storybook/react-vite";

import { Textarea } from "./textarea";

const meta = {
  title: "Primitives/Textarea",
  component: Textarea,
  args: {
    placeholder: "Type your message here...",
  },
} satisfies Meta<typeof Textarea>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Disabled: Story = {
  render: () => <Textarea placeholder="Disabled textarea" disabled />,
};

export const WithLabel: Story = {
  render: () => (
    <div className="grid w-full max-w-sm gap-2">
      <label className="text-sm font-medium leading-none">Message</label>
      <Textarea placeholder="Type your message here." />
      <p className="text-sm text-muted-foreground">Your message will be copied to the support team.</p>
    </div>
  ),
};
