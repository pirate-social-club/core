"use client";

import * as React from "react";
import {
  Check,
  ChevronDown,
  Image as ImageIcon,
  Link2,
  List,
  Mic,
  MoreHorizontal,
  Music2,
  Plus,
  Search,
  SquareDashed,
  Tag,
  Trash2,
  Video,
} from "lucide-react";

import { Button } from "@/components/primitives/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/primitives/card";
import { Checkbox } from "@/components/primitives/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/primitives/dropdown-menu";
import { Input } from "@/components/primitives/input";
import { Label } from "@/components/primitives/label";
import { Tabs, TabsList, TabsTrigger } from "@/components/primitives/tabs";
import { Textarea } from "@/components/primitives/textarea";
import { cn } from "@/lib/utils";

import type {
  ComposerReference,
  ComposerTab,
  ComposerIdentityState,
  IdentityMode,
  LiveAccessMode,
  LiveComposerState,
  LiveRoomKind,
  LiveSetlistItemInput,
  LiveSetlistItemKind,
  LiveVisibility,
  PostComposerProps,
} from "./post-composer.types";

const tabMeta: Record<ComposerTab, { label: string; icon: React.ReactNode }> = {
  text: { label: "Text", icon: <SquareDashed className="size-4" /> },
  image: { label: "Image", icon: <ImageIcon className="size-4" /> },
  video: { label: "Video", icon: <Video className="size-4" /> },
  link: { label: "Link", icon: <Link2 className="size-4" /> },
  song: { label: "Song", icon: <Music2 className="size-4" /> },
  live: { label: "Live", icon: <Mic className="size-4" /> },
};

const defaultTabs: ComposerTab[] = ["text", "image", "video", "link", "song", "live"];
const anonymousEligibleTabs: ComposerTab[] = ["text", "image", "video", "link"];

const roomKindOptions: { value: LiveRoomKind; label: string }[] = [
  { value: "solo", label: "Solo" },
  { value: "duet", label: "Duet" },
];

const accessModeOptions: { value: LiveAccessMode; label: string }[] = [
  { value: "free", label: "Free" },
  { value: "gated", label: "Gated" },
  { value: "paid", label: "Paid" },
];

const visibilityOptions: { value: LiveVisibility; label: string }[] = [
  { value: "public", label: "Public" },
  { value: "unlisted", label: "Unlisted" },
];

const setlistItemKindOptions: { value: LiveSetlistItemKind; label: string }[] = [
  { value: "original", label: "Original" },
  { value: "cover", label: "Cover" },
  { value: "remix", label: "Remix" },
  { value: "dj_playback", label: "DJ playback" },
  { value: "unknown", label: "Unknown" },
];

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

function LinkPreviewCard({
  title,
  domain,
  description,
  imageSrc,
}: {
  title: string;
  domain: string;
  description?: string;
  imageSrc?: string;
}) {
  return (
    <div className="overflow-hidden rounded-[var(--radius-lg)] border border-border-soft bg-card">
      <div className="flex min-h-28 flex-col md:flex-row">
        <div className="flex-1 space-y-2 px-4 py-4">
          <p className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">
            Preview
          </p>
          <p className="text-sm font-semibold text-foreground">{title}</p>
          {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
          <p className="text-sm text-muted-foreground">{domain}</p>
        </div>
        {imageSrc ? (
          <img
            alt=""
            className="h-28 w-full border-t border-border-soft object-cover md:h-auto md:w-40 md:border-l md:border-t-0"
            src={imageSrc}
          />
        ) : null}
      </div>
    </div>
  );
}

function deriveSelectedQualifierIds(
  identity: NonNullable<PostComposerProps["identity"]>,
): string[] {
  return identity.selectedQualifierIds ?? [];
}

function SetlistItemRow({
  item,
  index,
  onRemove,
  onUpdate,
}: {
  item: LiveSetlistItemInput;
  index: number;
  onRemove: (index: number) => void;
  onUpdate: (index: number, field: keyof LiveSetlistItemInput, value: string) => void;
}) {
  return (
    <div className="space-y-2 rounded-[var(--radius-lg)] border border-border-soft bg-background px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs font-semibold text-muted-foreground">{index + 1}</span>
        <button
          className="text-muted-foreground hover:text-foreground"
          onClick={() => onRemove(index)}
          type="button"
        >
          <Trash2 className="size-4" />
        </button>
      </div>
      <div className="space-y-2">
        <FieldLabel label="Track search" />
        <div className="relative">
          <Search className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="h-10 rounded-[var(--radius-lg)] pl-10"
            placeholder="Search Pirate songbase"
            defaultValue={item.declaredTrackId ?? ""}
            onChange={(e) => onUpdate(index, "declaredTrackId", e.target.value)}
          />
        </div>
        <p className="text-xs text-muted-foreground">
          Choose a canonical track first. Manual title and artist are only fallback metadata.
        </p>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <Input
          className="h-10 rounded-[var(--radius-lg)]"
          placeholder="Manual song title"
          defaultValue={item.titleText}
          onChange={(e) => onUpdate(index, "titleText", e.target.value)}
        />
        <Input
          className="h-10 rounded-[var(--radius-lg)]"
          placeholder="Manual artist"
          defaultValue={item.artistText ?? ""}
          onChange={(e) => onUpdate(index, "artistText", e.target.value)}
        />
      </div>
      <div className="flex flex-wrap gap-2">
        {setlistItemKindOptions.map((opt) => (
          <button
            key={opt.value}
            className={cn(
              "rounded-full px-3 py-1 text-xs font-medium transition-colors",
              item.performanceKind === opt.value
                ? "bg-primary/10 text-primary"
                : "bg-muted text-muted-foreground hover:text-foreground",
            )}
            onClick={() => onUpdate(index, "performanceKind", opt.value)}
            type="button"
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function LiveTabContent({
  live,
  onLiveChange,
}: {
  live: LiveComposerState;
  onLiveChange: (state: LiveComposerState) => void;
}) {
  const handleSetlistItemUpdate = (
    index: number,
    field: keyof LiveSetlistItemInput,
    value: string,
  ) => {
    const updated = [...live.setlistItems];
    updated[index] = { ...updated[index], [field]: value };
    onLiveChange({ ...live, setlistItems: updated });
  };

  const handleAddSetlistItem = () => {
    onLiveChange({
      ...live,
      setlistItems: [
        ...live.setlistItems,
        { titleText: "", performanceKind: "unknown" },
      ],
    });
  };

  const handleRemoveSetlistItem = (index: number) => {
    const updated = live.setlistItems.filter((_, i) => i !== index);
    onLiveChange({ ...live, setlistItems: updated });
  };

  return (
    <div className="space-y-5">
      <div className="grid gap-3 md:grid-cols-3">
        <div>
          <FieldLabel label="Room kind" />
          <div className="flex flex-wrap gap-2">
            {roomKindOptions.map((opt) => (
              <button
                key={opt.value}
                className={cn(
                  "rounded-full px-3 py-1.5 text-sm font-medium transition-colors",
                  live.roomKind === opt.value
                    ? "bg-primary/10 text-primary"
                    : "bg-muted text-muted-foreground hover:text-foreground",
                )}
                onClick={() => onLiveChange({ ...live, roomKind: opt.value })}
                type="button"
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
        <div>
          <FieldLabel label="Access" />
          <div className="flex flex-wrap gap-2">
            {accessModeOptions.map((opt) => (
              <button
                key={opt.value}
                className={cn(
                  "rounded-full px-3 py-1.5 text-sm font-medium transition-colors",
                  live.accessMode === opt.value
                    ? "bg-primary/10 text-primary"
                    : "bg-muted text-muted-foreground hover:text-foreground",
                )}
                onClick={() => onLiveChange({ ...live, accessMode: opt.value })}
                type="button"
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
        <div>
          <FieldLabel label="Visibility" />
          <div className="flex flex-wrap gap-2">
            {visibilityOptions.map((opt) => (
              <button
                key={opt.value}
                className={cn(
                  "rounded-full px-3 py-1.5 text-sm font-medium transition-colors",
                  live.visibility === opt.value
                    ? "bg-primary/10 text-primary"
                    : "bg-muted text-muted-foreground hover:text-foreground",
                )}
                onClick={() => onLiveChange({ ...live, visibility: opt.value })}
                type="button"
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {live.roomKind === "duet" ? (
        <div>
          <FieldLabel label="Guest performer" />
          <Input
            className="h-10 rounded-[var(--radius-lg)]"
            placeholder="Search for a collaborator"
            defaultValue={live.guestUserId ?? ""}
          />
          <p className="mt-1 text-xs text-muted-foreground">
            Invite a collaborator for this duet session.
          </p>
        </div>
      ) : null}

      <div className="space-y-3 rounded-[var(--radius-lg)] border border-border-soft bg-card px-4 py-4">
        <div className="space-y-1">
          <h3 className="text-sm font-semibold text-foreground">Performer allocations</h3>
          <p className="text-sm text-muted-foreground">
            {live.roomKind === "solo"
              ? "The host receives 100% of performer-side proceeds."
              : "Split performer-side proceeds between host and collaborator."}
          </p>
        </div>
        <div className="space-y-2">
          {live.performerAllocations.map((alloc, i) => (
            <div
              key={i}
              className="flex items-center justify-between rounded-[var(--radius-lg)] border border-border-soft bg-background px-4 py-3"
            >
              <div className="flex items-center gap-3">
                <span
                  className={cn(
                    "rounded-full px-2.5 py-1 text-xs font-medium",
                    alloc.role === "host"
                      ? "bg-primary/10 text-primary"
                      : "bg-muted text-muted-foreground",
                  )}
                >
                  {alloc.role === "host" ? "Host" : "Guest"}
                </span>
                <span className="text-sm text-foreground">
                  {alloc.role === "host" ? "You" : live.guestUserId || "Collaborator"}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <Input
                  className="h-8 w-16 rounded-[var(--radius-lg)] text-center text-sm"
                  defaultValue={String(alloc.sharePct)}
                  onChange={(e) => {
                    const val = parseInt(e.target.value, 10);
                    if (isNaN(val)) return;
                    const updated = [...live.performerAllocations];
                    updated[i] = { ...updated[i], sharePct: val };
                    onLiveChange({ ...live, performerAllocations: updated });
                  }}
                  type="number"
                  min={0}
                  max={100}
                />
                <span className="text-sm text-muted-foreground">%</span>
              </div>
            </div>
          ))}
        </div>
        {live.performerAllocations.reduce((sum, a) => sum + a.sharePct, 0) !== 100 ? (
          <p className="text-xs font-medium text-destructive">
            Allocations must sum to 100%
          </p>
        ) : null}
      </div>

      <div>
        <div className="mb-2 flex items-center justify-between gap-3">
          <div className="space-y-1">
            <h3 className="text-sm font-semibold text-foreground">Setlist</h3>
            <p className="text-xs text-muted-foreground">
              Search Pirate&apos;s songbase for the songs you plan to perform. Required before going live.
            </p>
          </div>
          <button
            className="inline-flex items-center gap-1.5 rounded-full bg-muted px-3 py-1.5 text-sm font-medium text-foreground hover:bg-muted/80"
            onClick={handleAddSetlistItem}
            type="button"
          >
            <Plus className="size-3.5" />
            Add song
          </button>
        </div>
        {live.setlistItems.length === 0 ? (
          <div className="rounded-[var(--radius-lg)] border border-dashed border-border-soft px-4 py-6 text-center text-sm text-muted-foreground">
            No songs yet. Add at least one song before going live.
          </div>
        ) : (
          <div className="space-y-2">
            {live.setlistItems.map((item, i) => (
              <SetlistItemRow
                key={i}
                item={item}
                index={i}
                onRemove={handleRemoveSetlistItem}
                onUpdate={handleSetlistItemUpdate}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function IdentitySection({
  identity,
  identityMode,
  onIdentityModeChange,
}: {
  identity: ComposerIdentityState;
  identityMode: IdentityMode;
  onIdentityModeChange: (mode: IdentityMode) => void;
}) {
  const handleLabel = identity.publicHandle ?? "@handle";
  const anonymousLabel = identity.anonymousLabel ?? "anon_guild";

  return (
    <section className="space-y-3 rounded-[var(--radius-lg)] border border-border-soft bg-card px-4 py-4">
      <div className="space-y-1">
        <h3 className="text-sm font-semibold text-foreground">Post As</h3>
        <p className="text-sm text-muted-foreground">
          {identityMode === "anonymous" ? anonymousLabel : handleLabel}
        </p>
      </div>
      <div className="flex items-start gap-3 rounded-[var(--radius-lg)] border border-border-soft bg-background px-4 py-3">
        <Checkbox
          checked={identityMode === "anonymous"}
          className="mt-0.5"
          id="post-anonymously"
          onCheckedChange={(next) => onIdentityModeChange(next === true ? "anonymous" : "public")}
        />
        <div className="space-y-1">
          <Label htmlFor="post-anonymously">Post anonymously</Label>
        </div>
      </div>
    </section>
  );
}

function QualifierSection({
  identity,
  selectedQualifierIds,
  onToggleQualifier,
}: {
  identity: ComposerIdentityState;
  selectedQualifierIds: string[];
  onToggleQualifier: (qualifierId: string) => void;
}) {
  const availableQualifiers = (identity.availableQualifiers ?? []).filter(
    (qualifier) => !qualifier.suppressedByGuildGate,
  );
  const activeQualifiers = availableQualifiers.filter((qualifier) =>
    selectedQualifierIds.includes(qualifier.qualifierId),
  );
  const helpText =
    identity.helpText ??
    "Attach verified qualifiers to this post. Qualifiers already implied by guild gates are omitted.";

  return (
    <section className="space-y-3 rounded-[var(--radius-lg)] border border-border-soft bg-card px-4 py-4">
      <div className="space-y-1">
        <h3 className="text-sm font-semibold text-foreground">Qualifiers</h3>
        <p className="text-sm text-muted-foreground">{helpText}</p>
      </div>

      {availableQualifiers.length > 0 ? (
        <div className="space-y-3">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button className="justify-between" variant="secondary">
                <span>
                  {activeQualifiers.length > 0
                    ? `${activeQualifiers.length} qualifier${activeQualifiers.length === 1 ? "" : "s"} attached`
                    : "Add qualifiers"}
                </span>
                <ChevronDown className="size-4 text-muted-foreground" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-[320px]">
              {availableQualifiers.map((qualifier) => {
                const selected = selectedQualifierIds.includes(qualifier.qualifierId);
                return (
                  <DropdownMenuItem
                    key={qualifier.qualifierId}
                    className="items-start justify-between gap-3"
                    onSelect={(event) => {
                      event.preventDefault();
                      onToggleQualifier(qualifier.qualifierId);
                    }}
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-foreground">{qualifier.label}</p>
                      {qualifier.description ? (
                        <p className="text-xs text-muted-foreground">{qualifier.description}</p>
                      ) : null}
                    </div>
                    <span
                      className={cn(
                        "mt-0.5 inline-flex size-5 items-center justify-center rounded-full border",
                        selected
                          ? "border-primary bg-primary/10 text-primary"
                          : "border-border-soft text-transparent",
                      )}
                    >
                      <Check className="size-3.5" />
                    </span>
                  </DropdownMenuItem>
                );
              })}
            </DropdownMenuContent>
          </DropdownMenu>

          {activeQualifiers.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {activeQualifiers.map((qualifier) => (
                <button
                  key={qualifier.qualifierId}
                  className="rounded-full bg-muted px-3 py-1.5 text-sm font-medium text-foreground hover:bg-muted/80"
                  onClick={() => onToggleQualifier(qualifier.qualifierId)}
                  type="button"
                >
                  {qualifier.label}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      {availableQualifiers.length === 0 ? (
        <div className="rounded-[var(--radius-lg)] border border-dashed border-border-soft px-4 py-4 text-sm text-muted-foreground">
          No optional qualifiers are available for this guild.
        </div>
      ) : null}
    </section>
  );
}

export function PostComposer({
  guildName,
  guildAvatarSrc,
  draftsLabel = "Drafts",
  mode,
  availableTabs = defaultTabs,
  canCreateSongPost = false,
  titleValue = "",
  titleCountLabel = "0/300",
  textBodyValue = "",
  captionValue = "",
  lyricsValue = "",
  linkUrlValue = "",
  linkPreview,
  songMode = "original",
  derivativeStep,
  monetization,
  identity,
  live,
}: PostComposerProps) {
  const visibleTabs = React.useMemo(
    () => availableTabs.filter((tab) => tab !== "song" || canCreateSongPost),
    [availableTabs, canCreateSongPost],
  );
  const [activeTab, setActiveTab] = React.useState<ComposerTab>(visibleTabs[0] ?? "text");
  const [activeSongMode, setActiveSongMode] = React.useState(songMode);
  const [identityMode, setIdentityMode] = React.useState<IdentityMode>(
    identity?.identityMode ?? "public",
  );
  const [selectedQualifierIds, setSelectedQualifierIds] = React.useState<string[]>(
    identity ? deriveSelectedQualifierIds(identity) : [],
  );
  const [liveState, setLiveState] = React.useState<LiveComposerState>(
    live ?? {
      roomKind: "solo",
      accessMode: "free",
      visibility: "public",
      setlistItems: [],
      setlistStatus: "draft",
      performerAllocations: [{ userId: "", role: "host", sharePct: 100 }],
    },
  );
  const [prevRoomKind, setPrevRoomKind] = React.useState<LiveRoomKind>(liveState.roomKind);

  React.useEffect(() => {
    if (liveState.roomKind !== prevRoomKind) {
      const hostAlloc = liveState.performerAllocations.find((a) => a.role === "host");
      if (liveState.roomKind === "solo") {
        setLiveState({
          ...liveState,
          performerAllocations: [{ ...hostAlloc!, sharePct: 100 }],
          guestUserId: undefined,
        });
      } else if (liveState.roomKind === "duet") {
        setLiveState({
          ...liveState,
          performerAllocations: [
            { ...hostAlloc!, sharePct: 50 },
            { userId: "", role: "guest", sharePct: 50 },
          ],
        });
      }
      setPrevRoomKind(liveState.roomKind);
    }
  }, [liveState.roomKind]);

  React.useEffect(() => {
    if (visibleTabs.includes(mode)) {
      setActiveTab(mode);
      return;
    }

    setActiveTab(visibleTabs[0] ?? "text");
  }, [mode, visibleTabs]);

  React.useEffect(() => {
    setActiveSongMode(songMode);
  }, [songMode]);

  React.useEffect(() => {
    if (live) {
      setLiveState(live);
    }
  }, [live]);

  React.useEffect(() => {
    if (!identity) {
      return;
    }

    setIdentityMode(identity.identityMode ?? "public");
    setSelectedQualifierIds(deriveSelectedQualifierIds(identity));
  }, [identity]);

  React.useEffect(() => {
    if (!anonymousEligibleTabs.includes(activeTab) && identityMode === "anonymous") {
      setIdentityMode("public");
    }
  }, [activeTab, identityMode]);

  React.useEffect(() => {
    if (identityMode === "anonymous" && identity?.allowQualifiersOnAnonymousPosts === false) {
      setSelectedQualifierIds([]);
    }
  }, [identity?.allowQualifiersOnAnonymousPosts, identityMode]);

  React.useEffect(() => {
    if (identityMode !== "anonymous" && selectedQualifierIds.length > 0) {
      setSelectedQualifierIds([]);
    }
  }, [identityMode, selectedQualifierIds]);

  const shouldShowDerivativeStep = Boolean(
    derivativeStep?.visible || (activeTab === "song" && activeSongMode === "remix"),
  );
  const shouldShowIdentity =
    Boolean(identity?.allowAnonymousIdentity) && anonymousEligibleTabs.includes(activeTab);
  const shouldShowQualifiers =
    Boolean(identity) &&
    Boolean(identity?.availableQualifiers?.some((qualifier) => !qualifier.suppressedByGuildGate)) &&
    identityMode === "anonymous" &&
    identity?.allowQualifiersOnAnonymousPosts !== false;

  const renderPrimaryArea = () => {
    switch (activeTab) {
      case "text":
        return <EditorChrome value={textBodyValue} />;
      case "image":
        return (
          <div className="space-y-3">
            <UploadField accept="image/*" label="Image" />
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
      case "link":
        return (
          <div className="space-y-3">
            <div>
              <FieldLabel label="URL" />
              <Input
                className="h-14 rounded-[var(--radius-lg)]"
                defaultValue={linkUrlValue}
                placeholder="https://"
              />
            </div>
            <Textarea
              className="min-h-28"
              placeholder="Add commentary"
              defaultValue={captionValue}
            />
            {linkPreview ? <LinkPreviewCard {...linkPreview} /> : null}
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
              <div className="space-y-3 rounded-[var(--radius-lg)] border border-border-soft bg-card px-4 py-4">
                <div className="space-y-1">
                  <h3 className="text-sm font-semibold text-foreground">Stems</h3>
                  <p className="text-sm text-muted-foreground">
                    Optional uploads for karaoke and remix workflows.
                  </p>
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                  <UploadField accept="audio/*" label="Instrumental stem" />
                  <UploadField accept="audio/*" label="Vocal stem" />
                </div>
              </div>
            </div>
          );
        case "live":
          return <LiveTabContent live={liveState} onLiveChange={setLiveState} />;
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
      </div>

      <Card className="overflow-hidden bg-background shadow-none">
        <CardHeader className="border-b border-border-soft px-0 pb-0 pt-0">
          <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as ComposerTab)}>
            <TabsList className="h-auto w-full justify-start rounded-none border-b border-border-soft bg-transparent p-0">
              {visibleTabs.map((tab) => (
                <TabsTrigger
                  key={tab}
                  value={tab}
                  className={cn(
                    "rounded-none border-b-2 border-transparent px-5 py-4 text-sm font-semibold data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none",
                  )}
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

          {shouldShowIdentity ? (
            <IdentitySection
              identity={identity!}
              identityMode={identityMode}
              onIdentityModeChange={setIdentityMode}
            />
          ) : null}

          {shouldShowQualifiers ? (
            <QualifierSection
              identity={identity!}
              onToggleQualifier={(qualifierId) =>
                setSelectedQualifierIds((current) =>
                  current.includes(qualifierId)
                    ? current.filter((id) => id !== qualifierId)
                    : [...current, qualifierId],
                )
              }
              selectedQualifierIds={selectedQualifierIds}
            />
          ) : null}

          {renderPrimaryArea()}

          {shouldShowDerivativeStep ? (
            <section className="space-y-3 rounded-[var(--radius-lg)] border border-border-soft bg-card px-4 py-4">
              <div className="space-y-1">
                <h3 className="text-sm font-semibold text-foreground">
                  Find source audio or upstream work
                </h3>
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
