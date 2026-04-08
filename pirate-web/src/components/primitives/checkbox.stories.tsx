import type { Meta, StoryObj } from "@storybook/react-vite";
import * as React from "react";

import { Checkbox } from "./checkbox";
import { Label } from "./label";

const meta = {
  title: "Primitives/Checkbox",
  component: Checkbox,
} satisfies Meta<typeof Checkbox>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <div className="flex items-center gap-3">
      <Checkbox id="checkbox-default" />
      <Label htmlFor="checkbox-default">Post anonymously</Label>
    </div>
  ),
};

export const Checked: Story = {
  render: () => (
    <div className="flex items-center gap-3">
      <Checkbox checked id="checkbox-checked" />
      <Label htmlFor="checkbox-checked">Allow anonymous posting</Label>
    </div>
  ),
};

export const Controlled: Story = {
  render: () => {
    const [checked, setChecked] = React.useState(false);

    return (
      <div className="flex items-center gap-3">
        <Checkbox
          checked={checked}
          id="checkbox-controlled"
          onCheckedChange={(next) => setChecked(next === true)}
        />
        <Label htmlFor="checkbox-controlled">
          {checked ? "Anonymous enabled" : "Anonymous disabled"}
        </Label>
      </div>
    );
  },
};

export const Disabled: Story = {
  render: () => (
    <div className="flex items-center gap-3 opacity-70">
      <Checkbox defaultChecked disabled id="checkbox-disabled" />
      <Label htmlFor="checkbox-disabled">18+ community</Label>
    </div>
  ),
};
