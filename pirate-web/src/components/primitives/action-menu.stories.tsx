import type { Meta, StoryObj } from "@storybook/react-vite";
import { Bookmark, Flag, Link2, EyeOff } from "lucide-react";

import { ActionMenu } from "./action-menu";

const meta = {
  title: "Primitives/ActionMenu",
  component: ActionMenu,
  args: {
    label: "Post actions",
    items: [
      { key: "save", label: "Save post", icon: <Bookmark className="size-4" /> },
      { key: "hide", label: "Hide post", icon: <EyeOff className="size-4" /> },
      { key: "copy", label: "Copy link", icon: <Link2 className="size-4" />, separatorBefore: true },
      { key: "report", label: "Report", icon: <Flag className="size-4" />, destructive: true },
    ],
  },
} satisfies Meta<typeof ActionMenu>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const CompactList: Story = {
  args: {
    items: [
      { key: "edit", label: "Edit" },
      { key: "duplicate", label: "Duplicate" },
      { key: "archive", label: "Archive", separatorBefore: true },
    ],
  },
};
