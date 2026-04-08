"use client";

import * as React from "react";
import { Handshake } from "@phosphor-icons/react";
import {
  AtSign,
  BadgeCheck,
  ChevronDown,
  Globe2,
  Lock,
  ShieldCheck,
  Tag,
  Users,
} from "lucide-react";

import { Button } from "@/components/primitives/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/primitives/card";
import { Checkbox } from "@/components/primitives/checkbox";
import { Input } from "@/components/primitives/input";
import { Label } from "@/components/primitives/label";
import { Textarea } from "@/components/primitives/textarea";
import { cn } from "@/lib/utils";

import type {
  CreateGuildComposerProps,
  GuildDefaultAgeGatePolicy,
  GuildGovernanceMode,
  GuildMembershipMode,
  HnsDelegationMode,
  NamespaceFamily,
  NamespaceImportState,
  SpacesHandleMode,
} from "./create-guild-composer.types";

const membershipMeta: Record<GuildMembershipMode, { label: string; icon: React.ReactNode }> = {
  open: { label: "Open", icon: <Globe2 className="size-4" /> },
  request: { label: "Request", icon: <ShieldCheck className="size-4" /> },
  gated: { label: "Gated", icon: <Lock className="size-4" /> },
};

const governanceMeta: Record<GuildGovernanceMode, { label: string; icon: React.ReactNode }> = {
  creator_led: { label: "Creator-led", icon: <Tag className="size-4" /> },
  multisig_ready: { label: "Multisig", icon: <ShieldCheck className="size-4" /> },
  dao_ready: { label: "DAO-ready", icon: <Users className="size-4" /> },
};

const ageGateMeta: Record<GuildDefaultAgeGatePolicy, { detail: string }> = {
  none: { detail: "Normal guild viewing. Posts are still safety-scanned." },
  "18_plus": {
    detail: "Guild viewing requires age verification. Scanning still applies to posts and assets.",
  },
};

const anonymousIdentityMeta = {
  disabled: { detail: "Posts always show handles." },
  enabled: { detail: "Eligible post types may be posted anonymously." },
};

const namespaceFamilyMeta: Record<
  NamespaceFamily,
  {
    label: string;
    externalExample: string;
    detail: string;
    icon: React.ReactNode;
  }
> = {
  hns: {
    label: "Handshake",
    externalExample: ".kanye",
    detail: "Use a Handshake root like `.kanye` for bare `/g/kanye` guild routes.",
    icon: <Handshake className="size-4" />,
  },
  spaces: {
    label: "Spaces",
    externalExample: "@kanye",
    detail: "Use a Spaces root like `@kanye` for `/g/@kanye` guild routes.",
    icon: <AtSign className="size-4" />,
  },
};

const hnsDelegationMeta: Record<HnsDelegationMode, { label: string; detail: string }> = {
  owner_managed: {
    label: "Owner-managed",
    detail: "You keep external issuance control. Pirate only verifies and resolves.",
  },
  pirate_managed: {
    label: "Delegate DNS authority to Pirate",
    detail: "Pirate can issue handles under this root. Revocable at any time.",
  },
};

const spacesHandleMeta: Record<SpacesHandleMode, { label: string; detail: string }> = {
  owner_managed: {
    label: "Owner-managed",
    detail: "Pirate verifies issued certificates and displays valid handles.",
  },
  operator_brokered: {
    label: "Request through Pirate",
    detail: "Pirate collects requests; operator issues certificates. Handles go live after verification.",
  },
  attach_certificate: {
    label: "Attach issued certificate",
    detail: "Users attach existing subspace certificates. Pirate verifies before activation.",
  },
};

function ShellPill({ children }: { children: React.ReactNode }) {
  return (
    <div className="inline-flex items-center gap-3 rounded-full bg-muted px-3 py-2 text-sm font-semibold text-foreground">
      <div className="grid size-7 place-items-center rounded-full bg-background text-muted-foreground">
        <Tag className="size-4" />
      </div>
      <span>{children}</span>
      <ChevronDown className="size-4 text-muted-foreground" />
    </div>
  );
}

function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3 rounded-[var(--radius-lg)] border border-border-soft bg-card px-4 py-4">
      <div className="space-y-1">
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        {hint ? <p className="text-sm text-muted-foreground">{hint}</p> : null}
      </div>
      {children}
    </section>
  );
}

function FieldLabel({ label }: { label: string }) {
  return <p className="mb-2 text-sm font-medium text-muted-foreground">{label}</p>;
}

function Segmented<T extends string>({
  options,
  value,
  onChange,
  columns = 3,
}: {
  options: Record<T, { label: string; icon?: React.ReactNode }>;
  value: T;
  onChange: (next: T) => void;
  columns?: 2 | 3;
}) {
  return (
    <div className={cn("grid gap-2", columns === 2 ? "md:grid-cols-2" : "md:grid-cols-3")}>
      {(Object.keys(options) as T[]).map((key) => {
        const option = options[key];
        const active = key === value;

        return (
          <button
            key={key}
            className={cn(
              "inline-flex items-center justify-center gap-2 rounded-full border px-3 py-2 text-sm font-medium transition-colors",
              active
                ? "border-primary bg-primary/5 text-foreground"
                : "border-border-soft bg-background text-muted-foreground hover:text-foreground",
            )}
            onClick={() => onChange(key)}
            type="button"
          >
            {option.icon}
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

function RadioCard<T extends string>({
  options,
  value,
  onChange,
}: {
  options: Record<T, { label: string; detail: string }>;
  value: T;
  onChange: (next: T) => void;
}) {
  return (
    <div className="space-y-2">
      {(Object.keys(options) as T[]).map((key) => {
        const option = options[key];
        const active = key === value;

        return (
          <button
            key={key}
            className={cn(
              "w-full rounded-[var(--radius-lg)] border px-4 py-3 text-left transition-colors",
              active
                ? "border-primary bg-primary/5"
                : "border-border-soft bg-background hover:border-foreground/20",
            )}
            onClick={() => onChange(key)}
            type="button"
          >
            <p className="text-sm font-semibold text-foreground">{option.label}</p>
            <p className="mt-0.5 text-sm text-muted-foreground">{option.detail}</p>
          </button>
        );
      })}
    </div>
  );
}

function NamespaceChoice({
  family,
  active,
  onClick,
}: {
  family: NamespaceFamily;
  active: boolean;
  onClick: () => void;
}) {
  const meta = namespaceFamilyMeta[family];

  return (
    <button
      className={cn(
        "rounded-[var(--radius-lg)] border px-4 py-4 text-left transition-colors",
        active
          ? "border-primary bg-primary/5"
          : "border-border-soft bg-background hover:border-foreground/20",
      )}
      onClick={onClick}
      type="button"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <p className="inline-flex items-center gap-2 text-sm font-semibold text-foreground">
            {meta.icon}
            {meta.label}
          </p>
          <p className="text-sm text-muted-foreground">{meta.detail}</p>
        </div>
        {active ? (
          <span className="inline-flex size-6 items-center justify-center rounded-full bg-primary/10 text-primary">
            <BadgeCheck className="size-4" />
          </span>
        ) : null}
      </div>
    </button>
  );
}

function HnsNamespaceStatus({
  namespace,
  onVerify,
}: {
  namespace: NamespaceImportState;
  onVerify: () => void;
}) {
  const statusTone =
    namespace.importStatus === "verified"
      ? "bg-emerald-500/10 text-emerald-700"
      : namespace.importStatus === "pending"
        ? "bg-amber-500/10 text-amber-700"
        : "bg-muted text-muted-foreground";

  return (
    <div className="grid gap-3 rounded-[var(--radius-lg)] border border-border-soft bg-background px-4 py-4 md:grid-cols-[1fr_auto] md:items-center">
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full bg-primary/10 px-2.5 py-1 text-xs font-semibold text-foreground">
            Handshake
          </span>
          <span className={cn("rounded-full px-2.5 py-1 text-xs font-semibold", statusTone)}>
            {namespace.importStatus === "verified"
              ? "Root control verified"
              : namespace.importStatus === "pending"
                ? "Verification pending"
                : "Not imported"}
          </span>
        </div>
        <p className="text-sm text-foreground">{namespace.externalRoot}</p>
        <p className="text-sm text-muted-foreground">Owner: {namespace.ownerLabel}</p>
        <p className="text-sm text-muted-foreground">
          {namespace.hnsDelegationMode === "pirate_managed"
            ? "Pirate can issue handles under this root."
            : "Owner keeps external issuance control."}
        </p>
      </div>
      {namespace.importStatus !== "verified" ? (
        <Button onClick={onVerify} size="sm">
          Verify root control
        </Button>
      ) : null}
    </div>
  );
}

function SpacesNamespaceStatus({
  namespace,
  onVerify,
}: {
  namespace: NamespaceImportState;
  onVerify: () => void;
}) {
  const statusTone =
    namespace.importStatus === "verified"
      ? "bg-emerald-500/10 text-emerald-700"
      : namespace.importStatus === "pending"
        ? "bg-amber-500/10 text-amber-700"
        : "bg-muted text-muted-foreground";

  const rootLabel = namespace.externalRoot?.replace(/^@/, "") ?? "";
  const route = `/g/@${rootLabel}`;
  const handleFormat = `name@${rootLabel}`;

  return (
    <div className="grid gap-3 rounded-[var(--radius-lg)] border border-border-soft bg-background px-4 py-4 md:grid-cols-[1fr_auto] md:items-center">
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full bg-primary/10 px-2.5 py-1 text-xs font-semibold text-foreground">
            Spaces
          </span>
          <span className={cn("rounded-full px-2.5 py-1 text-xs font-semibold", statusTone)}>
            {namespace.importStatus === "verified"
              ? "Root key proof verified"
              : namespace.importStatus === "pending"
                ? "Verification pending"
                : "Not imported"}
          </span>
        </div>
        <p className="text-sm text-foreground">{namespace.externalRoot}</p>
        <p className="text-sm text-muted-foreground">
          Route: <span className="font-mono text-foreground">{route}</span>
        </p>
        <p className="text-sm text-muted-foreground">
          Handles: <span className="font-mono text-foreground">{handleFormat}</span>
        </p>
        {namespace.importStatus === "verified" ? (
          <p className="text-sm text-muted-foreground">
            Certificates required for {namespace.externalRoot} handles
          </p>
        ) : null}
      </div>
      {namespace.importStatus !== "verified" ? (
        <Button onClick={onVerify} size="sm">
          Verify root control
        </Button>
      ) : null}
    </div>
  );
}

export function CreateGuildComposer({
  displayName = "American Voices",
  description = "National discourse, local moderation, verified context when it matters.",
  draftsLabel = "Templates",
  membershipMode = "request",
  governanceMode = "creator_led",
  defaultAgeGatePolicy = "none",
  allowAnonymousIdentity = true,
  endaomentUrl = "https://app.endaoment.org/orgs/musicares",
  namespace,
}: CreateGuildComposerProps) {
  const initialNamespace = namespace ?? {
    family: "hns",
    externalRoot: ".american",
    importStatus: "not_imported",
    ownerLabel: "",
    hnsDelegationMode: "owner_managed",
    spacesHandleMode: "owner_managed",
  };

  const [activeMembershipMode, setActiveMembershipMode] =
    React.useState<GuildMembershipMode>(membershipMode);
  const [activeGovernanceMode, setActiveGovernanceMode] =
    React.useState<GuildGovernanceMode>(governanceMode);
  const [activeDefaultAgeGatePolicy, setActiveDefaultAgeGatePolicy] =
    React.useState<GuildDefaultAgeGatePolicy>(defaultAgeGatePolicy);
  const [activeAllowAnonymousIdentity, setActiveAllowAnonymousIdentity] =
    React.useState<boolean>(allowAnonymousIdentity);
  const [activeNamespaceFamily, setActiveNamespaceFamily] = React.useState<NamespaceFamily>(
    initialNamespace.family ?? "hns",
  );
  const [activeHnsDelegationMode, setActiveHnsDelegationMode] =
    React.useState<HnsDelegationMode>(initialNamespace.hnsDelegationMode ?? "owner_managed");
  const [activeSpacesHandleMode, setActiveSpacesHandleMode] =
    React.useState<SpacesHandleMode>(initialNamespace.spacesHandleMode ?? "owner_managed");
  const [rootInput, setRootInput] = React.useState(initialNamespace.externalRoot ?? "");
  const [namespaceImportStatus, setNamespaceImportStatus] =
    React.useState(initialNamespace.importStatus ?? "not_imported");

  React.useEffect(() => {
    setActiveMembershipMode(membershipMode);
  }, [membershipMode]);

  React.useEffect(() => {
    setActiveGovernanceMode(governanceMode);
  }, [governanceMode]);

  React.useEffect(() => {
    setActiveDefaultAgeGatePolicy(defaultAgeGatePolicy);
  }, [defaultAgeGatePolicy]);

  React.useEffect(() => {
    setActiveAllowAnonymousIdentity(allowAnonymousIdentity);
  }, [allowAnonymousIdentity]);

  React.useEffect(() => {
    setActiveNamespaceFamily(initialNamespace.family ?? "hns");
  }, [initialNamespace.family]);

  const namespaceMeta = namespaceFamilyMeta[activeNamespaceFamily];
  const derivedRoot = activeNamespaceFamily === "hns" ? ".american" : "@american";
  const displayRoot = rootInput || derivedRoot;
  const rootLabel = displayRoot.replace(/^[@.]/, "");
  const guildRoute =
    activeNamespaceFamily === "hns" ? `/g/${rootLabel}` : `/g/@${rootLabel}`;
  const handleFormat =
    activeNamespaceFamily === "hns" ? `name.${rootLabel}` : `name@${rootLabel}`;

  const handleVerify = React.useCallback(() => {
    setNamespaceImportStatus("pending");
    setTimeout(() => setNamespaceImportStatus("verified"), 1500);
  }, []);

  const handleFamilyChange = React.useCallback((family: NamespaceFamily) => {
    setActiveNamespaceFamily(family);
    setNamespaceImportStatus("not_imported");
    setRootInput(family === "hns" ? ".american" : "@american");
  }, []);

  const namespaceState: NamespaceImportState = {
    ...initialNamespace,
    family: activeNamespaceFamily,
    externalRoot: displayRoot,
    importStatus: namespaceImportStatus,
    hnsDelegationMode: activeHnsDelegationMode,
    spacesHandleMode: activeSpacesHandleMode,
  };

  return (
    <div className="mx-auto w-full max-w-4xl space-y-4">
      <div className="flex items-start justify-between gap-4">
        <CardTitle className="text-3xl">Create guild</CardTitle>
        <button className="text-sm font-semibold text-foreground" type="button">
          {draftsLabel}
        </button>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <ShellPill>Namespace-backed guild</ShellPill>
      </div>

      <Card className="overflow-hidden bg-background shadow-none">
        <CardHeader className="border-b border-border-soft px-5 py-4">
          <div className="space-y-1">
            <p className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">
              Guild setup
            </p>
            <p className="text-sm text-muted-foreground">
              Choose the root family, verify control, then finish policy.
            </p>
          </div>
        </CardHeader>

        <CardContent className="space-y-4 p-5">
          <Section
            hint="Pick Handshake or Spaces, enter the root you control, then prove ownership before creation."
            title="1. Namespace"
          >
            <div className="grid gap-3 md:grid-cols-2">
              <NamespaceChoice
                active={activeNamespaceFamily === "hns"}
                family="hns"
                onClick={() => handleFamilyChange("hns")}
              />
              <NamespaceChoice
                active={activeNamespaceFamily === "spaces"}
                family="spaces"
                onClick={() => handleFamilyChange("spaces")}
              />
            </div>

            <div className="grid gap-3 md:grid-cols-[1fr_auto] md:items-end">
              <div>
                <FieldLabel
                  label={
                    activeNamespaceFamily === "hns" ? "Handshake root" : "Spaces root"
                  }
                />
                <Input
                  className="h-12 rounded-[var(--radius-lg)]"
                  onChange={(e) => setRootInput(e.target.value)}
                  placeholder={namespaceMeta.externalExample}
                  value={displayRoot}
                />
              </div>
              <Button className="h-12 px-5" variant="secondary">
                {namespaceImportStatus === "not_imported"
                  ? `Check ${namespaceMeta.label}`
                  : namespaceImportStatus === "pending"
                    ? "Checking..."
                    : `Re-check ${namespaceMeta.label}`}
              </Button>
            </div>

            {activeNamespaceFamily === "hns" ? (
              <HnsNamespaceStatus namespace={namespaceState} onVerify={handleVerify} />
            ) : (
              <SpacesNamespaceStatus namespace={namespaceState} onVerify={handleVerify} />
            )}

            {activeNamespaceFamily === "spaces" ? (
              <p className="text-sm text-muted-foreground">
                Spaces roots are separate from Handshake roots.
              </p>
            ) : null}
          </Section>

          {namespaceImportStatus === "verified" ? (
            <>
              <Section title="2. Guild basics">
                <div className="grid gap-4">
                  <div>
                    <FieldLabel label="Display name" />
                    <Input
                      className="h-12 rounded-[var(--radius-lg)]"
                      defaultValue={displayName}
                      placeholder="Guild name"
                    />
                  </div>

                  <div>
                    <FieldLabel label="Description" />
                    <Textarea
                      className="min-h-24"
                      defaultValue={description}
                      placeholder="What is this guild for?"
                    />
                  </div>
                </div>
              </Section>

              {activeNamespaceFamily === "spaces" ? (
                <Section
                  hint="How handles under this root get issued and verified."
                  title="Subspace handle setup"
                >
                  <RadioCard
                    onChange={setActiveSpacesHandleMode}
                    options={spacesHandleMeta}
                    value={activeSpacesHandleMode}
                  />
                </Section>
              ) : null}

              {activeNamespaceFamily === "hns" ? (
                <Section
                  hint="Whether Pirate issues handles under this root or you keep issuance control."
                  title="DNS authority"
                >
                  <RadioCard
                    onChange={setActiveHnsDelegationMode}
                    options={hnsDelegationMeta}
                    value={activeHnsDelegationMode}
                  />
                </Section>
              ) : null}

              <Section hint="The rest should stay terse." title="3. Policy">
                <div className="space-y-4">
                  <div className="space-y-2">
                    <FieldLabel label="Membership" />
                    <Segmented
                      onChange={setActiveMembershipMode}
                      options={membershipMeta}
                      value={activeMembershipMode}
                    />
                  </div>

                  <div className="space-y-2">
                    <FieldLabel label="Posting identity" />
                    <div className="flex items-start gap-3 rounded-[var(--radius-lg)] border border-border-soft bg-background px-4 py-3">
                      <Checkbox
                        checked={activeAllowAnonymousIdentity}
                        className="mt-0.5"
                        id="guild-allow-anonymous-posting"
                        onCheckedChange={(next) => setActiveAllowAnonymousIdentity(next === true)}
                      />
                      <div className="space-y-1">
                        <Label htmlFor="guild-allow-anonymous-posting">Allow anonymous posting</Label>
                        <p className="text-sm text-muted-foreground">
                          {activeAllowAnonymousIdentity
                            ? anonymousIdentityMeta.enabled.detail
                            : anonymousIdentityMeta.disabled.detail}
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <FieldLabel label="Audience age gate" />
                    <div className="flex items-start gap-3 rounded-[var(--radius-lg)] border border-border-soft bg-background px-4 py-3">
                      <Checkbox
                        checked={activeDefaultAgeGatePolicy === "18_plus"}
                        className="mt-0.5"
                        id="guild-18-plus-community"
                        onCheckedChange={(next) =>
                          setActiveDefaultAgeGatePolicy(next === true ? "18_plus" : "none")
                        }
                      />
                      <div className="space-y-1">
                        <Label htmlFor="guild-18-plus-community">18+ community</Label>
                        <p className="text-sm text-muted-foreground">
                          {ageGateMeta[activeDefaultAgeGatePolicy].detail}
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              </Section>

              <section className="grid gap-4 md:grid-cols-[1fr_1fr]">
                <Section title="4. Governance">
                  <Segmented
                    columns={3}
                    onChange={setActiveGovernanceMode}
                    options={governanceMeta}
                    value={activeGovernanceMode}
                  />
                </Section>

                <Section title="Optional">
                  <div className="space-y-2">
                    <FieldLabel label="Endaoment URL" />
                    <Input
                      className="h-12 rounded-[var(--radius-lg)]"
                      defaultValue={endaomentUrl}
                      placeholder="https://app.endaoment.org/orgs/..."
                    />
                    <p className="text-sm text-muted-foreground">
                      Optional. Used when the guild routes creator donations through an approved Endaoment beneficiary.
                    </p>
                  </div>
                </Section>
              </section>
            </>
          ) : null}
        </CardContent>

        {namespaceImportStatus === "verified" ? (
          <CardFooter className="justify-end gap-3 border-t border-border-soft p-5">
            <Button variant="secondary">Save Draft</Button>
            <Button>Create Guild</Button>
          </CardFooter>
        ) : null}
      </Card>
    </div>
  );
}
