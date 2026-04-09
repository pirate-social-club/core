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
          Pirate is a club-first social product for discovering communities, posts, and shared resources.
        </AccordionContent>
      </AccordionItem>
      <AccordionItem value="item-2">
        <AccordionTrigger>How do clubs work?</AccordionTrigger>
        <AccordionContent>
          Clubs organize people around a topic or identity, making discovery and participation easier than flat feeds.
        </AccordionContent>
      </AccordionItem>
      <AccordionItem value="item-3">
        <AccordionTrigger>Can I start my own club?</AccordionTrigger>
        <AccordionContent>
          Yes. Starting a club creates a new space for posts, members, and shared resources around your community.
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
          g/club1
          <br />
          g/club2
          <br />
          g/club3
        </AccordionContent>
      </AccordionItem>
      <AccordionItem value="item-2">
        <AccordionTrigger>Clubs</AccordionTrigger>
        <AccordionContent>
          g/usersjoinedclub1
          <br />
          g/usersjoinedclub2
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
