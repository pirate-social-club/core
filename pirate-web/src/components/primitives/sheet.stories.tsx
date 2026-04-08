import type { Meta, StoryObj } from "@storybook/react-vite";

import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "./sheet";
import { Button } from "./button";

const meta = {
  title: "Primitives/Sheet",
  component: SheetContent,
} satisfies Meta<typeof SheetContent>;

export default meta;

type Story = StoryObj<typeof meta>;

const Template = (args: { side: "top" | "bottom" | "left" | "right" }) => (
  <Sheet>
    <SheetTrigger asChild>
      <Button variant="outline">Open ({args.side})</Button>
    </SheetTrigger>
    <SheetContent side={args.side}>
      <SheetHeader>
        <SheetTitle>Sheet Title</SheetTitle>
        <SheetDescription>This is a sheet sliding in from the {args.side}.</SheetDescription>
      </SheetHeader>
      <div className="py-4">
        <p className="text-sm text-muted-foreground">Sheet body content goes here.</p>
      </div>
      <SheetFooter>
        <SheetClose asChild>
          <Button variant="outline">Close</Button>
        </SheetClose>
        <Button>Confirm</Button>
      </SheetFooter>
    </SheetContent>
  </Sheet>
);

export const Right = {
  render: () => <Template side="right" />,
};

export const Left = {
  render: () => <Template side="left" />,
};

export const Bottom = {
  render: () => <Template side="bottom" />,
};

export const Top = {
  render: () => <Template side="top" />,
};
