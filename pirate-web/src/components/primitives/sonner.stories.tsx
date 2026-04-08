import type { Meta, StoryObj } from "@storybook/react-vite";

import { toast, Toaster } from "./sonner";
import { Button } from "./button";

const meta = {
  title: "Primitives/Sonner",
  component: Toaster,
} satisfies Meta<typeof Toaster>;

export default meta;

type Story = StoryObj<typeof meta>;

function ToastDemo() {
  return (
    <div>
      <Toaster />
      <div className="flex flex-wrap gap-3">
        <Button onClick={() => toast("Event created", { description: "Monday, January 3rd at 6:00 PM" })}>
          Default
        </Button>
        <Button variant="secondary" onClick={() => toast.success("Success!", { description: "Your changes have been saved." })}>
          Success
        </Button>
        <Button variant="outline" onClick={() => toast.error("Error", { description: "Something went wrong." })}>
          Error
        </Button>
        <Button variant="outline" onClick={() => toast.warning("Warning", { description: "Please review your input." })}>
          Warning
        </Button>
        <Button variant="ghost" onClick={() => toast.info("Info", { description: "Here is some information." })}>
          Info
        </Button>
        <Button variant="destructive" onClick={() => {
          const promise = () => new Promise<{ name: string }>((resolve) => setTimeout(() => resolve({ name: "Sonner" }), 2000));
          toast.promise(promise, {
            loading: "Loading...",
            success: (data) => `${data.name} toast loaded`,
            error: "Error",
          });
        }}>
          Promise
        </Button>
      </div>
    </div>
  );
}

export const Default: Story = {
  render: () => <ToastDemo />,
};
