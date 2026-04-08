import type { Meta, StoryObj } from "@storybook/react-vite";

import { Label } from "./label";

const meta = {
  title: "Primitives/Label",
  component: Label,
  args: {
    children: "Email address",
  },
  argTypes: {
    tone: {
      control: "select",
      options: ["default", "muted"],
    },
  },
} satisfies Meta<typeof Label>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Tones: Story = {
  render: () => (
    <div className="space-y-2">
      <Label tone="default">Default label</Label>
      <Label tone="muted">Muted label</Label>
    </div>
  ),
};

export const WithInput: Story = {
  render: () => (
    <div className="space-y-2">
      <Label htmlFor="email">Email</Label>
      <input
        id="email"
        type="email"
        className="flex h-11 w-full rounded-full border border-input bg-background px-4 py-2 text-sm"
        placeholder="name@example.com"
      />
    </div>
  ),
};
