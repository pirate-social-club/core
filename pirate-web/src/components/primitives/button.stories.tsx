import type { Meta, StoryObj } from "@storybook/react-vite";
import { ArrowRight, Play } from "@phosphor-icons/react";

import { Button } from "./button";
import { Spinner } from "./spinner";

const meta = {
  title: "Primitives/Button",
  component: Button,
  args: {
    children: "Continue",
  },
  argTypes: {
    variant: {
      control: "select",
      options: ["default", "secondary", "outline", "ghost", "destructive"],
    },
    size: {
      control: "select",
      options: ["default", "sm", "lg", "icon"],
    },
  },
} satisfies Meta<typeof Button>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const VariantRow: Story = {
  render: () => (
    <div className="flex flex-wrap gap-3">
      <Button>Default</Button>
      <Button variant="secondary">Secondary</Button>
      <Button variant="outline">Outline</Button>
      <Button variant="ghost">Ghost</Button>
      <Button variant="destructive">Destructive</Button>
    </div>
  ),
};

export const Sizes: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-3">
      <Button size="sm">Small</Button>
      <Button size="default">Default</Button>
      <Button size="lg">Large</Button>
      <Button size="icon" aria-label="Icon button">+</Button>
    </div>
  ),
};

export const WithIcons: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-3">
      <Button leadingIcon={<Play className="size-5" weight="fill" />}>Play</Button>
      <Button trailingIcon={<ArrowRight className="size-5" />} variant="secondary">
        View Song
      </Button>
      <Button loading variant="outline">Loading</Button>
    </div>
  ),
};

export const LoadingStates: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-3">
      <Button loading>Continue</Button>
      <Button loading size="lg" variant="secondary">Add funds</Button>
      <Button leadingIcon={<Play className="size-5" weight="fill" />} size="lg">
        Preview
      </Button>
    </div>
  ),
};
