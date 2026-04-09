import * as React from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import {
  Clapperboard,
  Compass,
  Home,
  Info,
  Plus,
  ScrollText,
  Shield,
  Users,
} from "lucide-react";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "./accordion";

import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarProvider,
  SidebarRail,
  SidebarSeparator,
  SidebarTrigger,
} from "./sidebar";

const meta = {
  title: "Primitives/Sidebar",
  component: Sidebar,
  decorators: [
    (Story: () => React.ReactNode) => (
      <div style={{ height: 720, width: "100%", minHeight: 720 }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Sidebar>;

export default meta;

type Story = StoryObj<typeof meta>;

const sectionLabelClassName =
  "px-4 py-3 text-[15px] font-semibold uppercase tracking-[0.18em] text-sidebar-foreground/55 hover:no-underline";

const navRowClassName = "h-12 rounded-xl px-4 text-[18px] font-medium";

type TopLevelItem = {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  active?: boolean;
};

type ResourceLink = {
  label: string;
  icon?: React.ComponentType<{ className?: string }>;
};

const topLevelItems: TopLevelItem[] = [
  {
    icon: Compass,
    label: "Home",
    active: true,
  },
  {
    icon: Users,
    label: "Your Clubs",
  },
  {
    icon: Clapperboard,
    label: "Videos",
  },
  {
    icon: Plus,
    label: "Start a Club",
  },
];

const recentClubs = ["g/club1", "g/club2", "g/club3"];

const joinedClubs = [
  "g/usersjoinedclub1",
  "g/usersjoinedclub2",
];

const resources: ResourceLink[] = [
  { label: "About Pirate", icon: Info },
  { label: "Advertise" },
  { label: "LLMs.txt" },
  { label: "Blog" },
];

const legalLinks: ResourceLink[] = [
  { label: "Privacy Policy", icon: Shield },
  { label: "User Agreement", icon: ScrollText },
  { label: "Terms of Service" },
];

function SidebarSection({
  title,
  items,
  defaultOpen = true,
}: {
  title: string;
  items: string[];
  defaultOpen?: boolean;
}) {
  return (
    <Accordion
      className="px-4 group-data-[collapsible=icon]:hidden"
      collapsible
      defaultValue={defaultOpen ? title : undefined}
      type="single"
    >
      <AccordionItem className="border-b-0" value={title}>
        <AccordionTrigger className={sectionLabelClassName}>
          {title}
        </AccordionTrigger>
        <AccordionContent>
          <SidebarGroup className="gap-0 px-0 py-0">
            <SidebarGroupContent>
              <SidebarMenuSub className="mx-0 translate-x-0 border-l-0 px-0 py-0">
                {items.map((item) => (
                  <SidebarMenuSubItem key={item}>
                    <SidebarMenuSubButton
                      className="h-12 rounded-xl px-4 text-[18px] font-medium"
                      href="#"
                      size="md"
                    >
                      <span className="truncate">{item}</span>
                    </SidebarMenuSubButton>
                  </SidebarMenuSubItem>
                ))}
              </SidebarMenuSub>
            </SidebarGroupContent>
          </SidebarGroup>
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  );
}

function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  return (
    <Sidebar collapsible="icon" {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton className="h-12 rounded-xl px-4" size="lg">
              <div className="flex aspect-square size-9 items-center justify-center rounded-xl bg-sidebar-primary text-sidebar-primary-foreground shadow-sm">
                <Home className="size-5" />
              </div>
              <div className="grid flex-1 text-left text-lg leading-tight">
                <span className="truncate font-semibold">Pirate</span>
              </div>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent className="gap-3 overflow-y-auto px-0 pb-4">
        <SidebarGroup className="px-4 pt-2">
          <SidebarGroupContent>
            <SidebarMenu className="gap-1">
              {topLevelItems.map((item) => {
                const Icon = item.icon;

                return (
                  <SidebarMenuItem key={item.label}>
                    <SidebarMenuButton
                      className={navRowClassName}
                      isActive={item.active}
                      tooltip={item.label}
                    >
                      <Icon className="size-5" />
                      <div className="flex min-w-0 flex-1 items-center">
                        <span className="truncate">{item.label}</span>
                      </div>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        <SidebarSection defaultOpen items={recentClubs} title="Recent" />
        <SidebarSection items={joinedClubs} title="Clubs" />
        <SidebarGroup className="gap-0 px-4 py-0">
          <SidebarGroupLabel className={sectionLabelClassName}>
            Resources
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu className="gap-1">
              {resources.map((item) => {
                const Icon = item.icon;

                return (
                  <SidebarMenuItem key={item.label}>
                    <SidebarMenuButton
                      className={navRowClassName}
                      tooltip={item.label}
                    >
                      {Icon ? <Icon className="size-5" /> : <div className="size-5" aria-hidden="true" />}
                      <span>{item.label}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        <SidebarSeparator className="mx-4" />
        <SidebarGroup className="gap-0 px-4 py-0">
          <SidebarGroupContent>
            <SidebarMenu className="gap-1">
              {legalLinks.map((item) => {
                const Icon = item.icon;

                return (
                  <SidebarMenuItem key={item.label}>
                    <SidebarMenuButton
                      className={navRowClassName}
                      tooltip={item.label}
                    >
                      {Icon ? <Icon className="size-5" /> : <div className="size-5" aria-hidden="true" />}
                      <span>{item.label}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarRail />
    </Sidebar>
  );
}

export const Default: Story = {
  render: () => (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <header className="flex h-16 shrink-0 items-center gap-2 px-4">
          <SidebarTrigger className="-ml-1" />
          <span className="text-base font-medium">Content area</span>
        </header>
      </SidebarInset>
    </SidebarProvider>
  ),
};
