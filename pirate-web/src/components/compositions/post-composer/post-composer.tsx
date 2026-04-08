"use client";

import * as React from "react";
import {
  ChevronDown,
  Image as ImageIcon,
  Link2,
  List,
  MoreHorizontal,
  Music2,
  Radio,
  Search,
  SquareDashed,
  Tag,
  Video,
} from "lucide-react";

import { Button } from "@/components/primitives/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/primitives/card";
import { Input } from "@/components/primitives/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/primitives/tabs";
import { Textarea } from "@/components/primitives/textarea";
import { cn } from "@/lib/utils";

import type {
  ComposerReference,
  ComposerTab,
  PostComposerProps,
} from "./post-composer.types";

const tabMeta: Record<ComposerTab, { label: string; icon: React.ReactNode }> = {
  text: { label: "Text", icon: <SquareDashed className="size-4" /> },
  image: { label: "Image", icon: <ImageIcon className="size-4" /> },
  video: { label: "Video", icon: <Video className="size-4" /> },
  song: { label: "Song", icon: <Music2 className="size-4" /> },
  room: { label: "Room", icon: <Radio className="size-4" /> },
};

function ShellPill({
  avatarSrc,
  children,
}: {
  avatarSrc?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="inline-flex items-center gap-3 rounded-full bg-muted px-3 py-2 text-sm font-semibold text-foreground">
      {avatarSrc ? (
        <img alt="" className="size-7 rounded-full object-cover" src={avatarSrc} />
      ) : (
        <div className="grid size-7 place-items-center rounded-full bg-background text-muted-foreground">
          <Tag className="size-4" />
        </div>
      )}
      <span>{children}</span>
      <ChevronDown className="size-4 text-muted-foreground" />
    </div>
  );
}

function FieldLabel({
  label,
  counter,
}: {
  label: string;
  counter?: string;
}) {
  return (
    <div className="mb-2 flex items-center justify-between gap-3">
      <span className="text-sm font-medium text-muted-foreground">{label}</span>
      {counter ? <span className="text-sm text-muted-foreground">{counter}</span> : null}
    </div>
  );
}

function UploadField({
  label,
  accept,
  multiple = false,
}: {
  label: string;
  accept: string;
  multiple?: boolean;
}) {
  return (
    <label className="block">
      <FieldLabel label={label} />
      <input
        accept={accept}
        className={cn(
          "block w-full rounded-[var(--radius-lg)] border border-border-soft bg-background px-4 py-3 text-sm text-foreground file:mr-3 file:rounded-full file:border-0 file:bg-muted file:px-3 file:py-1.5 file:text-sm file:font-semibold file:text-foreground",
        )}
        multiple={multiple}
        type="file"
      />
    </label>
  );
}

function EditorChrome({
  value,
}: {
  value: string;
}) {
  const toolbar = ["B", "i", "S", "x2", "T", "link", "list", "ordered", "more"];

  return (
    <div className="rounded-[var(--radius-lg)] border border-border-soft bg-background">
      <div className="flex flex-wrap items-center gap-3 border-b border-border-soft px-4 py-3 text-muted-foreground">
        {toolbar.map((item) => (
          <span key={item} className="text-sm font-medium">
            {item === "link" ? <Link2 className="size-4" /> : null}
            {item === "list" ? <List className="size-4" /> : null}
            {item === "ordered" ? <List className="size-4" /> : null}
            {item === "more" ? <MoreHorizontal className="size-4" /> : null}
            {!["link", "list", "ordered", "more"].includes(item) ? item : null}
          </span>
        ))}
      </div>
      <Textarea
        className="min-h-44 rounded-none border-0 shadow-none focus-visible:ring-0"
        defaultValue={value}
      />
    </div>
  );
}

function References({
  items,
}: {
  items?: ComposerReference[];
}) {
  if (!items || items.length === 0) {
    return (
      <div className="rounded-[var(--radius-lg)] border border-dashed border-border-soft px-4 py-4 text-sm text-muted-foreground">
        No upstream works attached yet.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {items.map((item) => (
        <div
          key={item.id}
          className="flex items-center justify-between gap-3 rounded-[var(--radius-lg)] border border-border-soft bg-card px-4 py-3"
        >
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-foreground">{item.title}</p>
            {item.subtitle ? (
              <p className="truncate text-sm text-muted-foreground">{item.subtitle}</p>
            ) : null}
          </div>
          <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground">
            attached
          </span>
        </div>
      ))}
    </div>
  );
}

export function PostComposer({
  guildName,
  guildAvatarSrc,
  draftsLabel = "Drafts",
  mode,
  canCreateSongPost = false,
  canGoLive = false,
  titleValue = "",
  titleCountLabel = "0/300",
  textBodyValue = "",
  captionValue = "",
  lyricsValue = "",
  songMode = "original",
  derivativeStep,
  moreOptions,
  monetization,
}: PostComposerProps) {
  const [activeTab, setActiveTab] = React.useState<ComposerTab>(mode);
  const [activeSongMode, setActiveSongMode] = React.useState(songMode);
  const [moreOptionsOpen, setMoreOptionsOpen] = React.useState(Boolean(moreOptions?.open));

  React.useEffect(() => {
    setActiveTab(mode);
  }, [mode]);

  React.useEffect(() => {
    setActiveSongMode(songMode);
  }, [songMode]);

  React.useEffect(() => {
    setMoreOptionsOpen(Boolean(moreOptions?.open));
  }, [moreOptions?.open]);

  const shouldShowDerivativeStep = Boolean(
    derivativeStep?.visible || (activeTab === "song" && activeSongMode === "remix"),
  );

  const renderPrimaryArea = () => {
    switch (activeTab) {
      case "text":
        return <EditorChrome value={textBodyValue} />;
      case "image":
        return (
          <div className="space-y-3">
            <UploadField accept="image/*" label="Images" multiple />
            <Textarea
              className="min-h-28"
              placeholder="Add a caption"
              defaultValue={captionValue}
            />
          </div>
        );
      case "video":
        return (
          <div className="space-y-3">
            <UploadField accept="video/*" label="Video" />
            <Textarea
              className="min-h-28"
              placeholder="Add a caption"
              defaultValue={captionValue}
            />
          </div>
        );
      case "song":
        return (
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 rounded-full bg-muted p-1">
                {(["original", "remix"] as const).map((value) => (
                  <button
                    key={value}
                    onClick={() => setActiveSongMode(value)}
                    className={cn(
                      "rounded-full px-3 py-1.5 text-sm font-medium capitalize transition-colors",
                      activeSongMode === value
                        ? "bg-card text-foreground shadow-sm"
                        : "text-muted-foreground",
                    )}
                    type="button"
                  >
                    {value}
                  </button>
                ))}
              </div>
              <span className="text-sm text-muted-foreground">Song</span>
            </div>
            <UploadField accept="audio/*" label="Audio" />
            <Textarea
              className="min-h-24"
              placeholder="Add a caption"
              defaultValue={captionValue}
            />
            <Textarea
              className="min-h-36"
              placeholder="Paste lyrics"
              defaultValue={lyricsValue}
            />
          </div>
        );
      case "room":
        return (
          <div className="space-y-3">
            <Textarea
              className="min-h-28"
              placeholder="Describe the room"
              defaultValue={captionValue}
            />
          </div>
        );
      default:
        return null;
    }
  };

  return (
    <div className="mx-auto w-full max-w-5xl space-y-4">
      <div className="flex items-start justify-between gap-4">
        <CardTitle className="text-3xl">Create post</CardTitle>
        <button className="text-sm font-semibold text-foreground" type="button">
          {draftsLabel}
        </button>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <ShellPill avatarSrc={guildAvatarSrc}>{guildName}</ShellPill>
        {canGoLive ? (
          <Button size="sm" variant="outline" leadingIcon={<Radio className="size-4" />}>
            Go Live
          </Button>
        ) : null}
      </div>

      <Card className="overflow-hidden bg-background shadow-none">
        <CardHeader className="border-b border-border-soft px-0 pb-0 pt-0">
          <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as ComposerTab)}>
            <TabsList className="h-auto w-full justify-start rounded-none border-b border-border-soft bg-transparent p-0">
              {(["text", "image", "video", "song", "room"] as const).map((tab) => (
                <TabsTrigger
                  key={tab}
                  value={tab}
                  className={cn(
                    "rounded-none border-b-2 border-transparent px-5 py-4 text-sm font-semibold data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none",
                  )}
                  disabled={tab === "song" && !canCreateSongPost}
                >
                  <span className="inline-flex items-center gap-2">
                    {tabMeta[tab].icon}
                    {tabMeta[tab].label}
                  </span>
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        </CardHeader>

        <CardContent className="space-y-5 p-5">
          <div>
            <FieldLabel counter={titleCountLabel} label="Title" />
            <Input
              className="h-14 rounded-[var(--radius-lg)]"
              placeholder="Title"
              defaultValue={titleValue}
            />
          </div>

          {renderPrimaryArea()}

          {shouldShowDerivativeStep ? (
            <section className="space-y-3 rounded-[var(--radius-lg)] border border-border-soft bg-card px-4 py-4">
              <div className="space-y-1">
                <h3 className="text-sm font-semibold text-foreground">Find original / upstream work</h3>
                <p className="text-sm text-muted-foreground">Attach the source before posting when required.</p>
              </div>
              <div className="relative">
                <Search className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  className="rounded-[var(--radius-lg)] pl-10"
                  placeholder="Search Pirate / Story assets"
                  defaultValue={derivativeStep?.query ?? ""}
                />
              </div>
              {derivativeStep?.requirementLabel ? (
                <div className="rounded-[var(--radius-lg)] bg-muted px-4 py-3 text-sm text-foreground">
                  {derivativeStep.requirementLabel}
                </div>
              ) : null}
              <References items={derivativeStep?.references} />
            </section>
          ) : null}

          {moreOptions && (activeTab === "song" || moreOptions.ageGateChecked) ? (
            <section className="rounded-[var(--radius-lg)] border border-border-soft bg-card px-4 py-4">
              <button
                className="flex w-full items-center justify-between gap-3 text-left"
                onClick={() => setMoreOptionsOpen((current) => !current)}
                type="button"
              >
                <span className="text-sm font-semibold text-foreground">More options</span>
                <ChevronDown
                  className={cn(
                    "size-4 text-muted-foreground transition-transform",
                    moreOptionsOpen && "rotate-180",
                  )}
                />
              </button>

              {moreOptionsOpen ? (
                <div className="mt-4 grid gap-3 md:grid-cols-2">
                  <label className="flex items-center gap-3 rounded-[var(--radius-lg)] border border-border-soft px-4 py-3">
                    <input
                      defaultChecked={Boolean(moreOptions.ageGateChecked)}
                      className="size-4 accent-[var(--color-primary)]"
                      type="checkbox"
                    />
                    <span className="text-sm font-medium text-foreground">18+ content</span>
                  </label>
                  {activeTab === "song" ? (
                    <div className="grid gap-3 md:col-span-2 md:grid-cols-2">
                      <UploadField accept="audio/*" label="Instrumental stem" />
                      <UploadField accept="audio/*" label="Vocal stem" />
                    </div>
                  ) : null}
                </div>
              ) : null}
            </section>
          ) : null}

          {monetization?.visible ? (
            <section className="rounded-[var(--radius-lg)] border border-border-soft bg-card px-4 py-4">
              <div className="space-y-1">
                <h3 className="text-sm font-semibold text-foreground">Listing / monetization</h3>
                <p className="text-sm text-muted-foreground">
                  Donation only appears in the monetized flow, not on free posts.
                </p>
              </div>
              <div className="mt-3 grid gap-3 md:grid-cols-2">
                <div className="rounded-[var(--radius-lg)] border border-border-soft px-4 py-3">
                  <p className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">Price</p>
                  <p className="mt-1 text-sm text-foreground">{monetization.priceLabel ?? "Unset"}</p>
                </div>
                {monetization.donationAvailable ? (
                  <div className="rounded-[var(--radius-lg)] border border-border-soft px-4 py-3">
                    <p className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">Donation</p>
                    <p className="mt-1 text-sm text-foreground">
                      {monetization.donationOptIn
                        ? `Donate ${monetization.donationSharePct}% to ${monetization.donationPartnerName}`
                        : `Optional for ${monetization.donationPartnerName}`}
                    </p>
                  </div>
                ) : null}
              </div>
            </section>
          ) : null}
        </CardContent>

        <CardFooter className="justify-end gap-3 border-t border-border-soft p-5">
          <Button variant="secondary">Save Draft</Button>
          <Button>Post</Button>
        </CardFooter>
      </Card>
    </div>
  );
}
