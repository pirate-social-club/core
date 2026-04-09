import type { Meta, StoryObj } from "@storybook/react-vite";
import { MusicNote, Star } from "@phosphor-icons/react";

import { Item, ItemGroup, ItemMedia, ItemContent, ItemTitle, ItemDescription, ItemActions } from "./item";
import { Button } from "./button";

const meta = {
  title: "Primitives/Item",
  component: Item,
} satisfies Meta<typeof Item>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <Item>
      <ItemMedia variant="icon">
        <MusicNote className="size-5 text-muted-foreground" />
      </ItemMedia>
      <ItemContent>
        <ItemTitle>Song Title</ItemTitle>
        <ItemDescription>Artist name goes here</ItemDescription>
      </ItemContent>
    </Item>
  ),
};

export const Variants: Story = {
  render: () => (
    <ItemGroup className="w-[360px]">
      <Item variant="default">
        <ItemContent>
          <ItemTitle>Default</ItemTitle>
          <ItemDescription>No border, transparent background</ItemDescription>
        </ItemContent>
      </Item>
      <Item variant="outline">
        <ItemContent>
          <ItemTitle>Outline</ItemTitle>
          <ItemDescription>Subtle border styling</ItemDescription>
        </ItemContent>
      </Item>
      <Item variant="muted">
        <ItemContent>
          <ItemTitle>Muted</ItemTitle>
          <ItemDescription>Interactive surface background</ItemDescription>
        </ItemContent>
      </Item>
    </ItemGroup>
  ),
};

export const Sizes: Story = {
  render: () => (
    <ItemGroup className="w-[360px]">
      <Item size="dense">
        <ItemMedia variant="icon"><MusicNote className="size-5 text-muted-foreground" /></ItemMedia>
        <ItemContent>
          <ItemTitle>Dense</ItemTitle>
        </ItemContent>
      </Item>
      <Item size="sm">
        <ItemMedia variant="icon"><MusicNote className="size-5 text-muted-foreground" /></ItemMedia>
        <ItemContent>
          <ItemTitle>Small</ItemTitle>
        </ItemContent>
      </Item>
      <Item size="default">
        <ItemMedia variant="icon"><MusicNote className="size-5 text-muted-foreground" /></ItemMedia>
        <ItemContent>
          <ItemTitle>Default</ItemTitle>
        </ItemContent>
      </Item>
    </ItemGroup>
  ),
};

export const WithActions: Story = {
  render: () => (
    <ItemGroup className="w-[400px]">
      <Item>
        <ItemMedia variant="icon">
          <MusicNote className="size-5 text-muted-foreground" />
        </ItemMedia>
        <ItemContent>
          <ItemTitle>Favorite Song</ItemTitle>
          <ItemDescription>With action buttons on the right</ItemDescription>
        </ItemContent>
        <ItemActions>
          <Button variant="ghost" size="sm"><Star className="size-5" /></Button>
          <Button variant="ghost" size="sm">Play</Button>
        </ItemActions>
      </Item>
    </ItemGroup>
  ),
};
