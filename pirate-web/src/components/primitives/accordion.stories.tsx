import type { Meta, StoryObj } from "@storybook/react-vite";

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "./accordion";

const meta = {
  title: "Primitives/Accordion",
  component: AccordionTrigger,
} satisfies Meta<typeof AccordionTrigger>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <Accordion className="w-[480px]" collapsible defaultValue="item-1" type="single">
      <AccordionItem value="item-1">
        <AccordionTrigger>What is Pirate?</AccordionTrigger>
        <AccordionContent>
          Pirate is a guild-first social product for discovering communities, posts, and shared resources.
        </AccordionContent>
      </AccordionItem>
      <AccordionItem value="item-2">
        <AccordionTrigger>How do guilds work?</AccordionTrigger>
        <AccordionContent>
          Guilds organize people around a topic or identity, making discovery and participation easier than flat feeds.
        </AccordionContent>
      </AccordionItem>
      <AccordionItem value="item-3">
        <AccordionTrigger>Can I start my own guild?</AccordionTrigger>
        <AccordionContent>
          Yes. Starting a guild creates a new space for posts, members, and shared resources around your community.
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  ),
};

export const Multiple: Story = {
  render: () => (
    <Accordion className="w-[480px]" defaultValue={["item-1", "item-2"]} type="multiple">
      <AccordionItem value="item-1">
        <AccordionTrigger>Recent</AccordionTrigger>
        <AccordionContent>
          g/guild1
          <br />
          g/guild2
          <br />
          g/guild3
        </AccordionContent>
      </AccordionItem>
      <AccordionItem value="item-2">
        <AccordionTrigger>Guilds</AccordionTrigger>
        <AccordionContent>
          g/usersjoinedguild1
          <br />
          g/usersjoinedguild2
        </AccordionContent>
      </AccordionItem>
      <AccordionItem value="item-3">
        <AccordionTrigger>Resources</AccordionTrigger>
        <AccordionContent>
          About Pirate
          <br />
          Advertise
          <br />
          LLMs.txt
          <br />
          Blog
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  ),
};
