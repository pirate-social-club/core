import type { Meta, StoryObj } from "@storybook/react-vite";

import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "./card";
import { Button } from "./button";

const meta = {
  title: "Primitives/Card",
  component: Card,
} satisfies Meta<typeof Card>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <Card className="w-[380px]">
      <CardHeader>
        <CardTitle>Card Title</CardTitle>
        <CardDescription>Card description goes here.</CardDescription>
      </CardHeader>
      <CardContent>
        <p className="text-sm">This is the card content area. Place any content you like here.</p>
      </CardContent>
      <CardFooter>
        <Button>Action</Button>
      </CardFooter>
    </Card>
  ),
};

export const Simple: Story = {
  render: () => (
    <Card className="w-[380px]">
      <CardHeader>
        <CardTitle>Notifications</CardTitle>
        <CardDescription>You have 3 unread messages.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        <div className="flex items-center gap-3 rounded-lg bg-muted p-3">
          <div className="size-2 rounded-full bg-primary" />
          <span className="text-sm">New message from Alice</span>
        </div>
        <div className="flex items-center gap-3 rounded-lg bg-muted p-3">
          <div className="size-2 rounded-full bg-primary" />
          <span className="text-sm">New message from Bob</span>
        </div>
        <div className="flex items-center gap-3 rounded-lg bg-muted p-3">
          <div className="size-2 rounded-full bg-primary" />
          <span className="text-sm">New message from Charlie</span>
        </div>
      </CardContent>
    </Card>
  ),
};
