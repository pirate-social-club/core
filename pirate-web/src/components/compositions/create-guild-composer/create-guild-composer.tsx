"use client";

import * as React from "react";
import { Handshake } from "@phosphor-icons/react";
import {
  AtSign,
  BadgeCheck,
  Check,
  ChevronDown,
  Globe2,
  Lock,
  ShieldCheck,
  Tag,
  Users,
} from "lucide-react";

import { Badge } from "@/components/primitives/badge";
import { Button } from "@/components/primitives/button";
import { Card, CardContent, CardFooter, CardHeader } from "@/components/primitives/card";
import { Checkbox } from "@/components/primitives/checkbox";
import { Input } from "@/components/primitives/input";
import { Label } from "@/components/primitives/label";
import { Pill } from "@/components/primitives/pill";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/primitives/select";
import { Textarea } from "@/components/primitives/textarea";
import { cn } from "@/lib/utils";

import type {
  AnonymousIdentityScope,
  ComposerStep,
  CreateGuildComposerProps,
  GateFamily,
  GateType,
  GuildDefaultAgeGatePolicy,
  GuildGovernanceMode,
  GuildMembershipMode,
  HandlePolicyState,
  HandlePolicyTemplate,
  HandlePricingModel,
  HnsDelegationMode,
  MultisigAttachmentState,
  NamespaceFamily,
  NamespaceImportState,
  SpacesHandleMode,
} from "./create-guild-composer.types";

const membershipMeta: Record<GuildMembershipMode, { label: string; icon: React.ReactNode }> = {
  open: { label: "Open", icon: <Globe2 className="size-5" /> },
  request: { label: "Request", icon: <ShieldCheck className="size-5" /> },
  gated: { label: "Gated", icon: <Lock className="size-5" /> },
};

const governanceMeta: Record<
  GuildGovernanceMode,
  { label: string; icon: React.ReactNode; disabledHint?: string }
> = {
  centralized: { label: "Creator-led", icon: <Tag className="size-5" /> },
  multisig: { label: "Multisig", icon: <ShieldCheck className="size-5" /> },
  majeur: {
    label: "Majeur DAO",
    icon: <Users className="size-5" />,
    disabledHint: "Majeur creation stays out of scope for the v0 guild flow.",
  },
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
    icon: <Handshake className="size-5" />,
  },
  spaces: {
    label: "Spaces",
    externalExample: "@kanye",
    detail: "Use a Spaces root like `@kanye` for `/g/@kanye` guild routes.",
    icon: <AtSign className="size-5" />,
  },
};

const hnsDelegationMeta: Record<HnsDelegationMode, { label: string; detail: string; disabledHint?: string }> = {
  owner_managed: {
    label: "Owner-managed",
    detail: "You keep external issuance control. Pirate only verifies and resolves.",
  },
  pirate_managed: {
    label: "Delegate DNS authority to Pirate",
    detail: "Pirate can issue handles under this root. Revocable at any time.",
    disabledHint: "Requires Pirate DNS authority to be detected during inspection.",
  },
};

const spacesHandleMeta: Record<SpacesHandleMode, { label: string; detail: string; disabledHint?: string }> = {
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

const handlePolicyTemplateMeta: Record<HandlePolicyTemplate, { label: string; detail: string; pricingModel: HandlePricingModel; disabledHint?: string }> = {
  standard: {
    label: "Standard",
    detail: "Free handles at 8+ characters. Shorter names increasingly restricted. Good default for most guilds.",
    pricingModel: "free",
  },
  premium: {
    label: "Premium",
    detail: "Short and high-signal names explicitly monetized. Reserved names individually priced or auctioned.",
    pricingModel: "flat_by_length",
  },
  membership_gated: {
    label: "Membership-gated",
    detail: "Gate or NFT check comes first. Names then free or cheap once eligible.",
    pricingModel: "gated_then_flat",
  },
  custom: {
    label: "Custom",
    detail: "Explicit policy values for advanced use cases.",
    pricingModel: "custom_curve",
    disabledHint: "Custom handle policy configuration is not available in v0.",
  },
};

const anonymousScopeMeta: Record<AnonymousIdentityScope, { label: string; detail: string }> = {
  guild_stable: {
    label: "Guild-stable",
    detail: "One persistent anonymous label per user across the entire guild. Best for moderation continuity.",
  },
  thread_stable: {
    label: "Thread-stable",
    detail: "One persistent anonymous label per user per thread. Different threads produce different labels.",
  },
  post_ephemeral: {
    label: "Post-ephemeral",
    detail: "Random label per post. No cross-post correlation. Limits moderation and strike capability.",
  },
};

const gateTypeMeta: Record<GateType, { label: string; family: GateFamily }> = {
  erc721_holding: { label: "ERC-721 NFT", family: "token_holding" },
  erc1155_holding: { label: "ERC-1155 NFT", family: "token_holding" },
  erc20_balance: { label: "ERC-20 token", family: "token_holding" },
  solana_nft_holding: { label: "Solana NFT", family: "token_holding" },
  unique_human: { label: "Unique human", family: "identity_proof" },
  age_over_18: { label: "Age 18+", family: "identity_proof" },
  nationality: { label: "Nationality", family: "identity_proof" },
  wallet_score: { label: "Wallet score", family: "identity_proof" },
};

const tokenGateTypes: GateType[] = ["erc721_holding", "erc1155_holding", "erc20_balance", "solana_nft_holding"];
const identityGateTypes: GateType[] = ["unique_human", "age_over_18", "nationality", "wallet_score"];

const stepMeta: Record<ComposerStep, { label: string; hint: string }> = {
  1: { label: "Namespace", hint: "Choose the root family, verify control, then set issuance posture." },
  2: { label: "Identity", hint: "Name your guild and describe what it is for." },
  3: { label: "Handle policy", hint: "Choose how handles under this namespace are governed and priced." },
  4: { label: "Policy & governance", hint: "Set membership, identity, and governance rules." },
  5: { label: "Review", hint: "Confirm your guild configuration before creation." },
};

const supportedGovernanceChains = [
  { id: "1", label: "Ethereum" },
  { id: "8453", label: "Base" },
  { id: "42161", label: "Arbitrum" },
  { id: "10", label: "Optimism" },
] as const;

function getChainLabel(chainId: string) {
  return supportedGovernanceChains.find((chain) => chain.id === chainId)?.label ?? chainId;
}

function shortenAddress(address: string) {
  if (address.length < 12) return address;
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function buildDefaultOwners(contractAddress: string) {
  if (!contractAddress) return ["sim_signer_1", "sim_signer_2", "sim_signer_3"];
  return ["sim_signer_1", "sim_signer_2", "sim_signer_3"];
}

function isValidAddress(value: string) {
  return /^0x[a-fA-F0-9]{40}$/.test(value);
}

function getGateFamily(type: GateType): GateFamily {
  if (tokenGateTypes.includes(type)) return "token_holding";
  return "identity_proof";
}

function getInitialMultisigState(multisig?: MultisigAttachmentState): MultisigAttachmentState {
  return {
    chainId: "8453",
    contractAddress: "",
    treasurySameAsContract: true,
    treasuryAddress: "",
    displayLabel: "",
    verificationState: "not_attached",
    owners: [],
    threshold: undefined,
    implementationLabel: "",
    masterCopyAddress: "",
    warnings: [],
    ...multisig,
  };
}

function resolveHandlePolicy(template: HandlePolicyTemplate): HandlePolicyState {
  return {
    policyTemplate: template,
    pricingModel: handlePolicyTemplateMeta[template].pricingModel,
    membershipRequiredForClaim: true,
  };
}

function getInitialHandlePolicy(handlePolicy?: HandlePolicyState): HandlePolicyState | null {
  if (!handlePolicy) return null;
  return {
    policyTemplate: handlePolicy.policyTemplate,
    pricingModel: handlePolicy.pricingModel,
    membershipRequiredForClaim: handlePolicy.membershipRequiredForClaim,
  };
}

function ShellPill({ children }: { children: React.ReactNode }) {
  return (
    <div className="inline-flex items-center gap-3 rounded-full bg-muted px-3.5 py-2.5 text-sm font-semibold text-foreground">
      <div className="grid size-8 place-items-center rounded-full bg-background text-muted-foreground">
        <Tag className="size-5" />
      </div>
      <span>{children}</span>
      <ChevronDown className="size-5 text-muted-foreground" />
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
  disabledKeys,
}: {
  options: Record<T, { label: string; icon?: React.ReactNode; disabledHint?: string }>;
  value: T;
  onChange: (next: T) => void;
  columns?: 2 | 3;
  disabledKeys?: Set<T>;
}) {
  return (
    <div className={cn("grid gap-2", columns === 2 ? "md:grid-cols-2" : "md:grid-cols-3")}>
      {(Object.keys(options) as T[]).map((key) => {
        const option = options[key];
        const active = key === value;
        const disabled = disabledKeys?.has(key) ?? false;

        return (
          <div key={key} className="space-y-1">
            <Pill
              className={cn(
                "gap-2 px-3 py-2",
                disabled ? "cursor-not-allowed opacity-60 hover:text-muted-foreground" : "",
              )}
              disabled={disabled}
              variant={active ? "active" : "outline"}
              onClick={() => !disabled && onChange(key)}
            >
              {option.icon}
              {option.label}
            </Pill>
            {disabled && option.disabledHint ? (
              <p className="px-1 text-sm text-muted-foreground">{option.disabledHint}</p>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function RadioCard<T extends string>({
  options,
  value,
  onChange,
  disabledKeys,
}: {
  options: Record<T, { label: string; detail: string; disabledHint?: string }>;
  value: T | null;
  onChange: (next: T) => void;
  disabledKeys?: Set<T>;
}) {
  return (
    <div className="space-y-2">
      {(Object.keys(options) as T[]).map((key) => {
        const option = options[key];
        const active = key === value;
        const disabled = disabledKeys?.has(key) ?? false;

        return (
          <button
            key={key}
            className={cn(
              "w-full rounded-[var(--radius-lg)] border px-4 py-3 text-left transition-colors",
              disabled
                ? "border-border-soft bg-muted/40 cursor-not-allowed opacity-60"
                : active
                  ? "border-primary bg-primary/5"
                  : "border-border-soft bg-background hover:border-foreground/20",
            )}
            disabled={disabled}
            onClick={() => !disabled && onChange(key)}
            type="button"
          >
            <p className={cn("text-sm font-semibold", disabled ? "text-muted-foreground" : "text-foreground")}>{option.label}</p>
            <p className="mt-0.5 text-sm text-muted-foreground">{option.detail}</p>
            {disabled && option.disabledHint ? (
              <p className="mt-1 text-sm text-amber-700">{option.disabledHint}</p>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

function StepIndicator({
  current,
  onStepClick,
}: {
  current: ComposerStep;
  onStepClick: (step: ComposerStep) => void;
}) {
  const steps: { step: ComposerStep; label: string }[] = [
    { step: 1, label: "Namespace" },
    { step: 2, label: "Identity" },
    { step: 3, label: "Handles" },
    { step: 4, label: "Policy" },
    { step: 5, label: "Review" },
  ];

  return (
    <div className="flex items-center gap-1 overflow-x-auto">
      {steps.map((s, i) => {
        const completed = current > s.step;
        const active = current === s.step;

        return (
          <React.Fragment key={s.step}>
            {i > 0 ? (
              <div
                className={cn(
                  "h-px w-4 shrink-0 md:w-8",
                  current > steps[i - 1].step ? "bg-primary" : "bg-border-soft",
                )}
              />
            ) : null}
            <button
              className={cn(
                "flex shrink-0 items-center gap-2 rounded-full px-2 py-1.5 text-sm font-medium transition-colors md:px-3",
                active
                  ? "bg-primary/10 text-primary"
                  : completed
                    ? "text-primary"
                    : "text-muted-foreground",
              )}
              disabled={s.step > current}
              onClick={() => onStepClick(s.step)}
              type="button"
            >
              <span
                className={cn(
                  "grid size-6 place-items-center rounded-full text-xs font-semibold",
                  active
                    ? "bg-primary text-primary-foreground"
                    : completed
                      ? "bg-primary/10 text-primary"
                      : "bg-muted text-muted-foreground",
                )}
              >
                {completed ? <Check className="size-3.5" /> : s.step}
              </span>
              <span className="hidden md:inline">{s.label}</span>
            </button>
          </React.Fragment>
        );
      })}
    </div>
  );
}

function ReviewField({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="space-y-0.5">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="text-sm font-medium text-foreground">{value || "\u2014"}</p>
    </div>
  );
}

function ReviewSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-3 rounded-[var(--radius-lg)] border border-border-soft bg-card px-4 py-4">
      <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      <div className="grid gap-3 md:grid-cols-2">{children}</div>
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
          <span className="inline-flex size-7 items-center justify-center rounded-full bg-primary/10 text-primary">
            <BadgeCheck className="size-5" />
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
  const { importStatus } = namespace;
  if (!importStatus || importStatus === "not_imported") return null;

  const verified = importStatus === "verified";
  const challengeReady = importStatus === "txt_challenge_ready";
  const expired = namespace.expiryDaysRemaining != null && namespace.expiryDaysRemaining < 90;
  const rootLabel = (namespace.externalRoot ?? "").replace(/^\./, "");
  const route = `/g/${rootLabel}`;
  const handleFormat = `name.${rootLabel}`;

  return (
    <div className="grid gap-3 rounded-[var(--radius-lg)] border border-border-soft bg-background px-4 py-4 md:grid-cols-[1fr_auto] md:items-start">
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <Badge>Handshake</Badge>
          {verified ? (
            <Badge variant="success">Root control verified</Badge>
          ) : importStatus === "pending" ? (
            <Badge variant="warning">Verification pending</Badge>
          ) : importStatus === "txt_challenge_ready" ? (
            <Badge variant="warning">TXT challenge required</Badge>
          ) : (
            <Badge variant="secondary">Inspected</Badge>
          )}
        </div>
        <p className="text-sm text-foreground">{namespace.externalRoot}</p>
        <p className="text-sm text-muted-foreground">
          Route: <span className="font-mono text-foreground">{route}</span>
        </p>
        <p className="text-sm text-muted-foreground">
          Handles: <span className="font-mono text-foreground">{handleFormat}</span>
        </p>
        {namespace.expiryDaysRemaining != null ? (
          <p className={cn("text-sm", expired ? "text-amber-700" : "text-muted-foreground")}>
            Expiry horizon: {namespace.expiryDaysRemaining} days remaining
            {expired ? " \u2014 below 90-day minimum for guild creation" : null}
          </p>
        ) : null}
        <p className="text-sm text-muted-foreground">
          Pirate DNS authority: {namespace.pirateDnsDetected ? "detected" : "not detected"}
        </p>
        {challengeReady && namespace.txtChallenge ? (
          <div className="space-y-1 rounded-[var(--radius-lg)] border border-border-soft bg-muted/50 px-3 py-2">
            <p className="text-sm text-muted-foreground">Add this TXT record to prove control:</p>
            <p className="font-mono text-sm text-foreground">{namespace.txtChallenge}</p>
          </div>
        ) : null}
      </div>
      {!verified ? (
        <Button disabled={!challengeReady || expired} onClick={onVerify} size="sm">
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
  const { importStatus } = namespace;
  if (!importStatus || importStatus === "not_imported") return null;

  const verified = importStatus === "verified";
  const rootLabel = (namespace.externalRoot ?? "").replace(/^@/, "");
  const route = `/g/@${rootLabel}`;
  const handleFormat = `name@${rootLabel}`;

  return (
    <div className="grid gap-3 rounded-[var(--radius-lg)] border border-border-soft bg-background px-4 py-4 md:grid-cols-[1fr_auto] md:items-start">
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <Badge>Spaces</Badge>
          {verified ? (
            <Badge variant="success">Root key proof verified</Badge>
          ) : importStatus === "pending" ? (
            <Badge variant="warning">Verification pending</Badge>
          ) : null}
        </div>
        <p className="text-sm text-foreground">{namespace.externalRoot}</p>
        <p className="text-sm text-muted-foreground">
          Route: <span className="font-mono text-foreground">{route}</span>
        </p>
        <p className="text-sm text-muted-foreground">
          Handles: <span className="font-mono text-foreground">{handleFormat}</span>
        </p>
        {verified ? (
          <p className="text-sm text-muted-foreground">
            Certificates required for {namespace.externalRoot} handles
          </p>
        ) : null}
      </div>
      {!verified ? (
        <Button disabled={importStatus === "pending"} onClick={onVerify} size="sm">
          Verify root control
        </Button>
      ) : null}
    </div>
  );
}

function MultisigAttachmentStatus({
  multisig,
}: {
  multisig: MultisigAttachmentState;
}) {
  const verificationState = multisig.verificationState ?? "not_attached";
  const statusVariant =
    verificationState === "verified"
      ? "success" as const
      : verificationState === "pending"
        ? "warning" as const
        : verificationState === "broken"
          ? "destructive" as const
          : "secondary" as const;

  return (
    <div className="space-y-4 rounded-[var(--radius-lg)] border border-border-soft bg-background px-4 py-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge>Safe attachment</Badge>
        <Badge variant={statusVariant}>
          {verificationState === "verified"
            ? "Verified"
            : verificationState === "pending"
              ? "Verification pending"
              : verificationState === "broken"
                ? "Needs review"
                : "Not verified"}
        </Badge>
      </div>

      <div className="grid gap-3 text-sm md:grid-cols-2">
        <div className="space-y-1">
          <p className="text-muted-foreground">Chain</p>
          <p className="font-medium text-foreground">
            {multisig.chainId ? getChainLabel(multisig.chainId) : "Select a chain"}
          </p>
        </div>
        <div className="space-y-1">
          <p className="text-muted-foreground">Safe address</p>
          <p className="font-mono text-foreground">
            {multisig.contractAddress || "Paste a Safe address to verify"}
          </p>
        </div>
        <div className="space-y-1">
          <p className="text-muted-foreground">Treasury</p>
          <p className="font-medium text-foreground">
            {multisig.treasurySameAsContract !== false
              ? "Same Safe as governance"
              : multisig.treasuryAddress || "Separate treasury pending"}
          </p>
        </div>
        <div className="space-y-1">
          <p className="text-muted-foreground">Label</p>
          <p className="font-medium text-foreground">
            {multisig.displayLabel || "Optional internal label"}
          </p>
        </div>
      </div>

      {verificationState === "verified" ? (
        <div className="space-y-4 border-t border-border-soft pt-4">
          <div className="grid gap-3 text-sm md:grid-cols-3">
            <div className="space-y-1">
              <p className="text-muted-foreground">Owners</p>
              <p className="font-medium text-foreground">{multisig.owners?.length ?? 0} signers</p>
            </div>
            <div className="space-y-1">
              <p className="text-muted-foreground">Threshold</p>
              <p className="font-medium text-foreground">
                {multisig.threshold ? `${multisig.threshold}-of-${multisig.owners?.length ?? 0}` : "\u2014"}
              </p>
            </div>
            <div className="space-y-1">
              <p className="text-muted-foreground">Implementation</p>
              <p className="font-medium text-foreground">
                {multisig.implementationLabel || "Safe-compatible"}
              </p>
            </div>
          </div>

          {multisig.owners?.length ? (
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">Current signers</p>
              <div className="flex flex-wrap gap-2">
                {multisig.owners.map((owner) => (
                    <Badge key={owner} variant="outline" className="font-medium">
                      {owner}
                    </Badge>
                ))}
              </div>
            </div>
          ) : null}

          {multisig.masterCopyAddress ? (
            <p className="text-sm text-muted-foreground">
              Master copy:{" "}
              <span className="font-mono text-foreground">
                {shortenAddress(multisig.masterCopyAddress)}
              </span>
            </p>
          ) : null}

          {multisig.warnings?.length ? (
            <div className="space-y-2 rounded-[var(--radius-lg)] border border-amber-500/20 bg-amber-500/5 px-4 py-3">
              <p className="text-sm font-semibold text-foreground">Warnings</p>
              <ul className="space-y-1 text-sm text-muted-foreground">
                {multisig.warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : verificationState === "pending" || verificationState === "broken" ? (
        <div className="border-t border-border-soft pt-4">
          <p className="text-sm text-muted-foreground">
            Pirate verifies the Safe contract, checks EIP-1271 attachment proof, then snapshots
            owners, threshold, and implementation metadata.
          </p>
        </div>
      ) : null}
    </div>
  );
}

export function CreateGuildComposer({
  displayName = "American Voices",
  description = "National discourse, local moderation, verified context when it matters.",
  draftsLabel = "Templates",
  membershipMode = "request",
  governanceMode = "centralized",
  defaultAgeGatePolicy = "none",
  allowAnonymousIdentity = true,
  anonymousIdentityScope: anonymousIdentityScopeProp,
  endaomentUrl = "https://app.endaoment.org/orgs/musicares",
  namespace,
  multisig,
  handlePolicy,
  creatorEligible = true,
  initialStep,
}: CreateGuildComposerProps) {
  const initialNamespace = namespace ?? {
    family: "hns",
    externalRoot: ".american",
    importStatus: "not_imported",
    ownerLabel: "",
    hnsDelegationMode: "owner_managed",
    spacesHandleMode: "owner_managed",
  };
  const initialMultisig = getInitialMultisigState(multisig);

  const [activeStep, setActiveStep] = React.useState<ComposerStep>(initialStep ?? 1);
  const [activeMembershipMode, setActiveMembershipMode] =
    React.useState<GuildMembershipMode>(membershipMode);
  const [activeGovernanceMode, setActiveGovernanceMode] =
    React.useState<GuildGovernanceMode>(governanceMode);
  const [activeDefaultAgeGatePolicy, setActiveDefaultAgeGatePolicy] =
    React.useState<GuildDefaultAgeGatePolicy>(defaultAgeGatePolicy);
  const [activeAllowAnonymousIdentity, setActiveAllowAnonymousIdentity] =
    React.useState<boolean>(allowAnonymousIdentity);
  const [activeAnonymousScope, setActiveAnonymousScope] =
    React.useState<AnonymousIdentityScope>(anonymousIdentityScopeProp ?? "guild_stable");
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
  const [expiryDaysRemaining, setExpiryDaysRemaining] = React.useState<number | undefined>(
    initialNamespace.expiryDaysRemaining,
  );
  const [pirateDnsDetected, setPirateDnsDetected] = React.useState(
    initialNamespace.pirateDnsDetected ?? false,
  );
  const [txtChallenge, setTxtChallenge] = React.useState<string | undefined>(
    initialNamespace.txtChallenge,
  );
  const [activeDisplayName, setActiveDisplayName] = React.useState(displayName ?? "");
  const [activeDescription, setActiveDescription] = React.useState(description ?? "");
  const [activeEndaomentUrl, setActiveEndaomentUrl] = React.useState(endaomentUrl ?? "");
  const [activeHandlePolicy, setActiveHandlePolicy] =
    React.useState<HandlePolicyState | null>(getInitialHandlePolicy(handlePolicy));
  const [activeGateTypes, setActiveGateTypes] = React.useState<Set<GateType>>(new Set());
  const [multisigState, setMultisigState] =
    React.useState<MultisigAttachmentState>(initialMultisig);
  const [multisigAddressTouched, setMultisigAddressTouched] = React.useState(
    Boolean(initialMultisig.contractAddress),
  );
  const namespaceTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const multisigTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  React.useEffect(() => { setActiveMembershipMode(membershipMode); }, [membershipMode]);
  React.useEffect(() => { setActiveGovernanceMode(governanceMode); }, [governanceMode]);
  React.useEffect(() => { setActiveDefaultAgeGatePolicy(defaultAgeGatePolicy); }, [defaultAgeGatePolicy]);
  React.useEffect(() => { setActiveAllowAnonymousIdentity(allowAnonymousIdentity); }, [allowAnonymousIdentity]);
  React.useEffect(() => {
    if (anonymousIdentityScopeProp) setActiveAnonymousScope(anonymousIdentityScopeProp);
  }, [anonymousIdentityScopeProp]);
  React.useEffect(() => { setActiveNamespaceFamily(initialNamespace.family ?? "hns"); }, [initialNamespace.family]);
  React.useEffect(() => {
    setMultisigState(getInitialMultisigState(multisig));
    setMultisigAddressTouched(Boolean(multisig?.contractAddress));
  }, [multisig]);
  React.useEffect(() => {
    setActiveHandlePolicy(getInitialHandlePolicy(handlePolicy));
  }, [handlePolicy]);

  React.useEffect(() => {
    if (!pirateDnsDetected && activeHnsDelegationMode === "pirate_managed") {
      setActiveHnsDelegationMode("owner_managed");
    }
  }, [pirateDnsDetected, activeHnsDelegationMode]);

  const clearNamespaceTimer = React.useCallback(() => {
    if (namespaceTimerRef.current) {
      clearTimeout(namespaceTimerRef.current);
      namespaceTimerRef.current = null;
    }
  }, []);

  const clearMultisigTimer = React.useCallback(() => {
    if (multisigTimerRef.current) {
      clearTimeout(multisigTimerRef.current);
      multisigTimerRef.current = null;
    }
  }, []);

  React.useEffect(() => clearNamespaceTimer, [clearNamespaceTimer]);
  React.useEffect(() => clearMultisigTimer, [clearMultisigTimer]);

  const namespaceMeta = namespaceFamilyMeta[activeNamespaceFamily];
  const derivedRoot = activeNamespaceFamily === "hns" ? ".american" : "@american";
  const displayRoot = rootInput || derivedRoot;
  const rootLabel = displayRoot.replace(/^[@.]/, "");
  const guildRoute =
    activeNamespaceFamily === "hns" ? `/g/${rootLabel}` : `/g/@${rootLabel}`;
  const handleFormat =
    activeNamespaceFamily === "hns" ? `name.${rootLabel}` : `name@${rootLabel}`;

  const handleInspect = React.useCallback(() => {
    clearNamespaceTimer();
    setNamespaceImportStatus("inspected");
    setExpiryDaysRemaining(247);
    setPirateDnsDetected(false);
    setTxtChallenge(undefined);
    namespaceTimerRef.current = setTimeout(() => {
      setNamespaceImportStatus("txt_challenge_ready");
      setTxtChallenge("pirate-verify=a3f7c9e2");
    }, 800);
  }, [clearNamespaceTimer]);

  const handleVerify = React.useCallback(() => {
    clearNamespaceTimer();
    setNamespaceImportStatus("pending");
    namespaceTimerRef.current = setTimeout(() => {
      setNamespaceImportStatus("verified");
      namespaceTimerRef.current = null;
    }, 1500);
  }, [clearNamespaceTimer]);

  const handleVerifyMultisig = React.useCallback(() => {
    clearMultisigTimer();
    setMultisigState((current) => ({
      ...current,
      verificationState: "pending",
    }));

    multisigTimerRef.current = setTimeout(() => {
      setMultisigState((current) => ({
        ...current,
        verificationState: "verified",
        owners: current.owners?.length ? current.owners : buildDefaultOwners(current.contractAddress ?? ""),
        threshold: current.threshold ?? 2,
        implementationLabel: current.implementationLabel || "Safe v1.4.1",
        masterCopyAddress:
          current.masterCopyAddress || "0x29fcB43b46531BcA003ddC8FCB67FFE91900C762",
        warnings:
          current.warnings?.length
            ? current.warnings
            : [
                "Module inspection is partial in v0. Advanced modules and guards may still require manual review.",
              ],
      }));
      multisigTimerRef.current = null;
    }, 1500);
  }, [clearMultisigTimer]);

  const handleFamilyChange = React.useCallback((family: NamespaceFamily) => {
    clearNamespaceTimer();
    setActiveNamespaceFamily(family);
    setNamespaceImportStatus("not_imported");
    setRootInput(family === "hns" ? ".american" : "@american");
    setExpiryDaysRemaining(undefined);
    setPirateDnsDetected(false);
    setTxtChallenge(undefined);
  }, [clearNamespaceTimer]);

  const handleStepClick = React.useCallback((step: ComposerStep) => {
    setActiveStep(step);
  }, []);

  const handleNext = React.useCallback(() => {
    setActiveStep((s) => Math.min(s + 1, 5) as ComposerStep);
  }, []);

  const handleBack = React.useCallback(() => {
    setActiveStep((s) => Math.max(s - 1, 1) as ComposerStep);
  }, []);

  const toggleGateType = React.useCallback((type: GateType) => {
    setActiveGateTypes((prev) => {
      const next = new Set(prev);
      if (next.has(type)) {
        next.delete(type);
      } else {
        next.add(type);
      }
      return next;
    });
  }, []);

  const expirySafe = expiryDaysRemaining == null || expiryDaysRemaining >= 90;
  const hasMultisigInput = Boolean(multisigState.chainId && multisigState.contractAddress);
  const multisigAddressValid =
    !multisigAddressTouched ||
    !multisigState.contractAddress ||
    isValidAddress(multisigState.contractAddress);

  const canProceed = React.useMemo(() => {
    switch (activeStep) {
      case 1:
        return namespaceImportStatus === "verified" && expirySafe;
      case 2:
        return activeDisplayName.trim().length > 0;
      case 3:
        return activeHandlePolicy != null;
      case 4:
        if (activeGovernanceMode === "multisig") {
          return multisigState.verificationState === "verified" && multisigAddressValid;
        }
        if (activeMembershipMode === "gated") return activeGateTypes.size > 0;
        return true;
      case 5:
        return canCreateGuild;
      default:
        return false;
    }
  }, [
    activeStep,
    namespaceImportStatus,
    expirySafe,
    activeDisplayName,
    activeHandlePolicy,
    activeGovernanceMode,
    multisigState,
    multisigAddressValid,
    activeMembershipMode,
    activeGateTypes,
  ]);

  const canCreateGuild = React.useMemo(
    () =>
      creatorEligible &&
      namespaceImportStatus === "verified" &&
      expirySafe &&
      multisigAddressValid &&
      activeHandlePolicy != null &&
      activeDisplayName.trim().length > 0 &&
      (activeGovernanceMode !== "multisig" || multisigState.verificationState === "verified") &&
      activeGovernanceMode !== "majeur" &&
      (activeMembershipMode !== "gated" || activeGateTypes.size > 0),
    [
      creatorEligible,
      namespaceImportStatus,
      expirySafe,
      multisigAddressValid,
      activeHandlePolicy,
      activeDisplayName,
      activeGovernanceMode,
      multisigState,
      activeMembershipMode,
      activeGateTypes,
    ],
  );

  const namespaceState: NamespaceImportState = {
    ...initialNamespace,
    family: activeNamespaceFamily,
    externalRoot: displayRoot,
    importStatus: namespaceImportStatus,
    hnsDelegationMode: activeHnsDelegationMode,
    spacesHandleMode: activeSpacesHandleMode,
    expiryDaysRemaining,
    pirateDnsDetected,
    txtChallenge,
  };

  const resolvedHandlePolicyLabel =
    activeHandlePolicy != null
      ? handlePolicyTemplateMeta[activeHandlePolicy.policyTemplate].label
      : null;

  const resolvedPricingLabel =
    activeHandlePolicy != null
      ? activeHandlePolicy.pricingModel === "free"
        ? "Free"
        : activeHandlePolicy.pricingModel === "flat_by_length"
          ? "Flat by length"
          : activeHandlePolicy.pricingModel === "gated_then_flat"
            ? "Gated then flat"
            : "Custom"
      : null;

  const membershipLabel = membershipMeta[activeMembershipMode].label;
  const governanceLabel = governanceMeta[activeGovernanceMode].label;

  return (
    <div className="mx-auto w-full max-w-4xl space-y-4">
      <div className="flex items-start justify-between gap-4">
        <h2 className="text-3xl font-semibold tracking-tight">Create guild</h2>
        <button className="text-sm font-semibold text-foreground" type="button">
          {draftsLabel}
        </button>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <ShellPill>Namespace-backed guild</ShellPill>
      </div>

      {!creatorEligible ? (
        <div className="rounded-[var(--radius-lg)] border border-amber-500/20 bg-amber-500/5 px-4 py-3">
          <p className="text-sm font-semibold text-foreground">Identity verification required</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Complete unique human verification before creating a namespace-backed guild.
          </p>
        </div>
      ) : null}

      <Card className="overflow-hidden bg-background shadow-none">
        <CardHeader className="space-y-4 border-b border-border-soft px-5 py-4">
          <StepIndicator current={activeStep} onStepClick={handleStepClick} />
          <div className="space-y-1">
            <p className="text-sm font-semibold uppercase tracking-[0.08em] text-muted-foreground">
              Step {activeStep} &mdash; {stepMeta[activeStep].label}
            </p>
            <p className="text-sm text-muted-foreground">
              {stepMeta[activeStep].hint}
            </p>
          </div>
        </CardHeader>

        <CardContent className="space-y-4 p-5">
          {activeStep === 1 ? (
            <>
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
                    onChange={(e) => {
                      clearNamespaceTimer();
                      setRootInput(e.target.value);
                      setTxtChallenge(undefined);
                      if (namespaceImportStatus !== "not_imported") {
                        setNamespaceImportStatus("not_imported");
                        setExpiryDaysRemaining(undefined);
                        setPirateDnsDetected(false);
                      }
                    }}
                    placeholder={namespaceMeta.externalExample}
                    value={displayRoot}
                  />
                </div>
                {activeNamespaceFamily === "hns" ? (
                  <Button
                    className="h-12 px-5"
                    disabled={namespaceImportStatus !== "not_imported"}
                    onClick={handleInspect}
                    variant="secondary"
                  >
                    Inspect root
                  </Button>
                ) : (
                  <Button
                    className="h-12 px-5"
                    disabled={namespaceImportStatus !== "not_imported"}
                    onClick={handleVerify}
                    variant="secondary"
                  >
                    Verify root control
                  </Button>
                )}
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

              {activeNamespaceFamily === "spaces" ? (
                <Section
                  hint="How handles under this root get issued and verified."
                  title="Subspace handles"
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
                  title="Handle issuance"
                >
                  <RadioCard
                    disabledKeys={pirateDnsDetected ? undefined : new Set<HnsDelegationMode>(["pirate_managed"])}
                    onChange={setActiveHnsDelegationMode}
                    options={hnsDelegationMeta}
                    value={activeHnsDelegationMode}
                  />
                </Section>
              ) : null}
            </>
          ) : null}

          {activeStep === 2 ? (
            <Section title="Guild basics">
              <div className="grid gap-4">
                <div>
                  <FieldLabel label="Display name" />
                  <Input
                    className="h-12 rounded-[var(--radius-lg)]"
                    onChange={(e) => setActiveDisplayName(e.target.value)}
                    placeholder="Guild name"
                    value={activeDisplayName}
                  />
                </div>

                <div>
                  <FieldLabel label="Description" />
                  <Textarea
                    className="min-h-24"
                    onChange={(e) => setActiveDescription(e.target.value)}
                    placeholder="What is this guild for?"
                    value={activeDescription}
                  />
                </div>
              </div>
            </Section>
          ) : null}

          {activeStep === 3 ? (
            <Section
              hint="Every namespace must have a handle policy. Templates set sensible defaults for pricing, length tiers, and claim gating."
              title="Handle policy template"
            >
              <RadioCard
                disabledKeys={new Set<HandlePolicyTemplate>(["custom"])}
                onChange={(template) => setActiveHandlePolicy(resolveHandlePolicy(template))}
                options={handlePolicyTemplateMeta}
                value={activeHandlePolicy?.policyTemplate ?? null}
              />

              {activeHandlePolicy != null && activeHandlePolicy.policyTemplate !== "custom" ? (
                <div className="grid gap-3 rounded-[var(--radius-lg)] border border-border-soft bg-background px-4 py-3 text-sm md:grid-cols-2">
                  <div className="space-y-0.5">
                    <p className="text-muted-foreground">Pricing model</p>
                    <p className="font-medium text-foreground">{resolvedPricingLabel}</p>
                  </div>
                  <div className="space-y-0.5">
                    <p className="text-muted-foreground">Membership required for claim</p>
                    <p className="font-medium text-foreground">
                      {activeHandlePolicy.membershipRequiredForClaim ? "Yes" : "No"}
                    </p>
                  </div>
                </div>
              ) : null}
            </Section>
          ) : null}

          {activeStep === 4 ? (
            <>
              <Section title="Membership">
                <div className="space-y-4">
                  <div className="space-y-2">
                    <FieldLabel label="Membership mode" />
                    <Segmented
                      onChange={setActiveMembershipMode}
                      options={membershipMeta}
                      value={activeMembershipMode}
                    />
                  </div>

                  {activeMembershipMode === "gated" ? (
                    <div className="space-y-3 rounded-[var(--radius-lg)] border border-border-soft bg-background px-4 py-3">
                      <div className="space-y-1">
                        <p className="text-sm font-semibold text-foreground">Membership gates</p>
                        <p className="text-sm text-muted-foreground">
                          Select at least one gate type. Members must satisfy these checks before joining.
                        </p>
                      </div>

                      <div className="space-y-3">
                        <div className="space-y-2">
                          <p className="text-sm font-medium text-muted-foreground">Token holding</p>
                          <p className="text-sm text-muted-foreground">
                            Token gates require chain, contract, and threshold configuration. Add them after guild creation in settings.
                          </p>
                        </div>

                        <div className="space-y-2">
                          <p className="text-sm font-medium text-muted-foreground">Identity proof</p>
                          <div className="flex flex-wrap gap-2">
                            {identityGateTypes.map((type) => (
                              <Pill
                                key={type}
                                variant={activeGateTypes.has(type) ? "active" : "outline"}
                                onClick={() => toggleGateType(type)}
                              >
                                {gateTypeMeta[type].label}
                              </Pill>
                            ))}
                          </div>
                        </div>
                      </div>

                      {activeGateTypes.size > 0 ? (
                        <p className="text-sm text-muted-foreground">
                          {activeGateTypes.size} gate{activeGateTypes.size > 1 ? "s" : ""} configured.
                          Advanced per-gate settings can be refined after creation.
                        </p>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              </Section>

              <Section title="Identity & access">
                <div className="space-y-4">
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

                  {activeAllowAnonymousIdentity ? (
                    <div className="space-y-2">
                      <FieldLabel label="Anonymous identity scope" />
                      <RadioCard
                        options={anonymousScopeMeta}
                        value={activeAnonymousScope}
                        onChange={setActiveAnonymousScope}
                      />
                      {activeAnonymousScope === "post_ephemeral" ? (
                        <div className="rounded-[var(--radius-lg)] border border-amber-500/20 bg-amber-500/5 px-4 py-3">
                          <p className="text-sm text-foreground">
                            Post-ephemeral scope prevents cross-post behavioral tracking and strike accumulation.
                            Content safety classification and at least one active moderator are required.
                          </p>
                        </div>
                      ) : null}
                    </div>
                  ) : null}

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
                <Section
                  hint="Creator-led keeps constitutional control in Pirate. Multisig attaches an existing Safe. Majeur stays the advanced DAO path."
                  title="Governance"
                >
                  <Segmented
                    columns={3}
                    disabledKeys={new Set<GuildGovernanceMode>(["majeur"])}
                    onChange={setActiveGovernanceMode}
                    options={governanceMeta}
                    value={activeGovernanceMode}
                  />

                  {activeGovernanceMode === "multisig" ? (
                    <div className="space-y-4 rounded-[var(--radius-lg)] border border-border-soft bg-muted/30 px-4 py-4">
                      <div className="space-y-1">
                        <p className="text-sm font-semibold text-foreground">Attach existing Safe</p>
                        <p className="text-sm text-muted-foreground">
                          Pirate does not deploy the wallet. Paste a supported Safe address, verify
                          attachment, then use that Safe as constitutional admin and treasury.
                        </p>
                      </div>

                      <div className="grid gap-4 md:grid-cols-2">
                        <div className="space-y-2">
                          <FieldLabel label="Chain" />
                          <Select
                            onValueChange={(value) =>
                              setMultisigState((current) => ({
                                ...current,
                                chainId: value,
                                verificationState: "not_attached",
                              }))
                            }
                            value={multisigState.chainId}
                          >
                            <SelectTrigger className="h-12 rounded-[var(--radius-lg)]">
                              <SelectValue placeholder="Select chain" />
                            </SelectTrigger>
                            <SelectContent>
                              {supportedGovernanceChains.map((chain) => (
                                <SelectItem key={chain.id} value={chain.id}>
                                  {chain.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>

                        <div className="space-y-2">
                          <FieldLabel label="Display label" />
                          <Input
                            className="h-12 rounded-[var(--radius-lg)]"
                            onChange={(e) =>
                              setMultisigState((current) => ({
                                ...current,
                                displayLabel: e.target.value,
                              }))
                            }
                            placeholder="Treasury Safe"
                            value={multisigState.displayLabel ?? ""}
                          />
                        </div>
                      </div>

                      <div className="grid gap-4 md:grid-cols-[1fr_auto] md:items-end">
                        <div className="space-y-2">
                          <FieldLabel label="Safe address" />
                          <Input
                            className="h-12 rounded-[var(--radius-lg)] font-mono"
                            onChange={(e) => {
                              const nextValue = e.target.value;
                              setMultisigAddressTouched(nextValue.length > 0);
                              setMultisigState((current) => ({
                                ...current,
                                contractAddress: nextValue,
                                treasuryAddress:
                                  current.treasurySameAsContract !== false ? nextValue : current.treasuryAddress,
                                verificationState: "not_attached",
                              }));
                            }}
                            placeholder="0x..."
                            value={multisigState.contractAddress ?? ""}
                          />
                          {!multisigAddressValid ? (
                            <p className="text-sm text-destructive">
                              Enter a valid Safe address in `0x` + 40 hex format before verification.
                            </p>
                          ) : null}
                        </div>
                        <Button
                          className="h-12 px-5"
                          disabled={
                            !multisigState.chainId ||
                            !multisigState.contractAddress ||
                            !multisigAddressValid ||
                            multisigState.verificationState === "pending"
                          }
                          onClick={handleVerifyMultisig}
                          variant="secondary"
                        >
                          {multisigState.verificationState === "pending" ? "Checking..." : "Verify"}
                        </Button>
                      </div>

                      <div className="flex items-start gap-3 rounded-[var(--radius-lg)] border border-border-soft bg-background px-4 py-3">
                        <Checkbox
                          checked={multisigState.treasurySameAsContract !== false}
                          className="mt-0.5"
                          disabled
                          id="guild-safe-is-treasury"
                        />
                        <div className="space-y-1">
                          <Label htmlFor="guild-safe-is-treasury">This Safe is the treasury</Label>
                          <p className="text-sm text-muted-foreground">
                            Split treasury stays out of scope in v0. Pirate reads balances from the
                            same Safe used for governance.
                          </p>
                        </div>
                      </div>

                      {hasMultisigInput ? <MultisigAttachmentStatus multisig={multisigState} /> : null}
                    </div>
                  ) : null}

                </Section>

                <Section title="Optional">
                  <div className="space-y-2">
                    <FieldLabel label="External beneficiary URL" />
                    <Input
                      className="h-12 rounded-[var(--radius-lg)]"
                      onChange={(e) => setActiveEndaomentUrl(e.target.value)}
                      placeholder="https://app.endaoment.org/orgs/..."
                      value={activeEndaomentUrl}
                    />
                    <p className="text-sm text-muted-foreground">
                      Optional. Used when the guild routes creator donations through an approved Endaoment beneficiary.
                    </p>
                  </div>
                </Section>
              </section>
            </>
          ) : null}

          {activeStep === 5 ? (
            <div className="space-y-4">
              <ReviewSection title="Namespace">
                <ReviewField label="Family" value={namespaceFamilyMeta[activeNamespaceFamily].label} />
                <ReviewField label="Root" value={displayRoot} />
                <ReviewField label="Route" value={<span className="font-mono">{guildRoute}</span>} />
                <ReviewField label="Handle format" value={<span className="font-mono">{handleFormat}</span>} />
                <ReviewField
                  label="Verification"
                  value={
                    namespaceImportStatus === "verified"
                      ? "Root control verified"
                      : namespaceImportStatus
                  }
                />
                <ReviewField
                  label="Issuance"
                  value={
                    activeNamespaceFamily === "hns"
                      ? hnsDelegationMeta[activeHnsDelegationMode].label
                      : spacesHandleMeta[activeSpacesHandleMode].label
                  }
                />
              </ReviewSection>

              <ReviewSection title="Guild identity">
                <ReviewField label="Display name" value={activeDisplayName} />
                <div className="md:col-span-2">
                  <ReviewField label="Description" value={activeDescription || "\u2014"} />
                </div>
              </ReviewSection>

              <ReviewSection title="Handle policy">
                <ReviewField label="Template" value={resolvedHandlePolicyLabel} />
                <ReviewField label="Pricing model" value={resolvedPricingLabel} />
                <ReviewField
                  label="Membership required for claim"
                  value={activeHandlePolicy?.membershipRequiredForClaim ? "Yes" : "No"}
                />
              </ReviewSection>

              <ReviewSection title="Policy & governance">
                <ReviewField label="Membership" value={membershipLabel} />
                {activeMembershipMode === "gated" && activeGateTypes.size > 0 ? (
                  <div className="md:col-span-2">
                    <ReviewField
                      label="Membership gates"
                      value={Array.from(activeGateTypes).map((t) => gateTypeMeta[t].label).join(", ")}
                    />
                  </div>
                ) : null}
                <ReviewField
                  label="Anonymous posting"
                  value={activeAllowAnonymousIdentity ? "Enabled" : "Disabled"}
                />
                {activeAllowAnonymousIdentity ? (
                  <ReviewField
                    label="Anonymous scope"
                    value={anonymousScopeMeta[activeAnonymousScope].label}
                  />
                ) : null}
                <ReviewField
                  label="Age gate"
                  value={activeDefaultAgeGatePolicy === "18_plus" ? "18+" : "None"}
                />
                <ReviewField label="Governance" value={governanceLabel} />
                {activeGovernanceMode === "multisig" && multisigState.verificationState === "verified" ? (
                  <>
                    <ReviewField
                      label="Chain"
                      value={multisigState.chainId ? getChainLabel(multisigState.chainId) : "\u2014"}
                    />
                    <ReviewField
                      label="Safe address"
                      value={
                        multisigState.contractAddress
                          ? <span className="font-mono">{shortenAddress(multisigState.contractAddress)}</span>
                          : "\u2014"
                      }
                    />
                  </>
                ) : null}
              </ReviewSection>

              {!creatorEligible ? (
                <div className="rounded-[var(--radius-lg)] border border-destructive/20 bg-destructive/5 px-4 py-3">
                  <p className="text-sm font-semibold text-foreground">
                    Creator identity verification is incomplete. Guild creation is blocked until unique human verification passes.
                  </p>
                </div>
              ) : null}
            </div>
          ) : null}
        </CardContent>

        <CardFooter className="justify-between border-t border-border-soft p-5">
          <div>
            <Button variant="secondary">Save Draft</Button>
          </div>
          <div className="flex gap-3">
            {activeStep > 1 ? (
              <Button onClick={handleBack} variant="secondary">
                Back
              </Button>
            ) : null}
            {activeStep < 5 ? (
              <Button disabled={!canProceed} onClick={handleNext}>
                Next
              </Button>
            ) : (
              <Button disabled={!canCreateGuild}>Create Guild</Button>
            )}
          </div>
        </CardFooter>
      </Card>
    </div>
  );
}
