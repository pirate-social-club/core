import path from "node:path";
import { parse, stringify } from "yaml";

export const API_DIR = "specs/api";
export const SOURCE_DIR = path.posix.join(API_DIR, "src");
export const BUNDLE_FILE = path.posix.join(API_DIR, "openapi.yaml");
export const IMPLEMENTED_BUNDLE_FILE = path.posix.join(API_DIR, "openapi-implemented.yaml");

const SCHEMA_GROUPS: Record<string, readonly string[]> = {
  common: ["Error"],
  auth: ["SessionExchangeResponse"],
  verification: [
    "VerificationCapabilities",
    "RequestedVerificationCapability",
    "VerificationIntent",
    "VerificationCapabilityState",
    "VerifiedCapabilityState",
    "SanctionsClearCapabilityState",
    "WalletScoreCapabilityState",
    "StartVerificationSessionRequest",
    "CompleteVerificationSessionRequest",
    "ProviderVerificationCallbackRequest",
    "SelfVerificationDisclosures",
    "SelfVerificationLaunch",
    "VeryWidgetLaunch",
    "VerySessionBinding",
    "VerificationSessionLaunch",
    "VerificationSession",
  ],
  agents: [
    "AgentOwnershipProvider",
    "AgentOwnershipSessionKind",
    "AgentOwnershipSessionStatus",
    "UserAgentStatus",
    "AgentHandleStatus",
    "AgentOwnershipState",
    "AgentChallenge",
    "AgentActionProof",
    "SelfAgentOwnershipLaunch",
    "ClawkeyRegistrationLaunch",
    "AgentOwnershipSessionLaunch",
    "StartAgentOwnershipSessionRequest",
    "CompleteAgentOwnershipSessionRequest",
    "ProviderAgentOwnershipCallbackRequest",
    "AgentOwnershipRecord",
    "AgentOwnershipSession",
    "UserAgent",
    "UserAgentListResponse",
    "AgentHandle",
    "UpdateAgentHandleRequest",
    "UpdateUserAgentRequest",
    "PublicAgentResolution",
  ],
  onboarding: ["RedditVerification", "RedditImportSummary", "OnboardingStatus"],
  users: ["User"],
  profiles: ["Profile", "GlobalHandle", "HandleUpgradeQuote"],
  "communities-core": [
    "CreateCommunityRequestBase",
    "GateRuleInput",
    "GateRule",
    "ProofRequirement",
    "RootPostQuotaRule",
    "RootPostQuotaByTrustTier",
    "ReplyQuotaRule",
    "ReplyQuotaByTrustTier",
    "CreateCommunityRequest",
    "UpdateCommunityRequest",
    "Community",
    "MembershipResult",
  ],
  "communities-governance": [
    "CreateCentralizedCommunityRequest",
    "CreateMultisigCommunityRequest",
    "CreateMajeurCommunityRequest",
    "AttachGovernanceRequest",
    "AttachMultisigGovernanceRequest",
    "AttachMajeurGovernanceRequest",
    "GovernanceAction",
    "GovernanceVerificationState",
    "CommunityGovernanceBackend",
    "CentralizedGovernanceBackend",
    "MultisigGovernanceAttachmentInput",
    "MultisigAttachmentProofInput",
    "MultisigGovernanceBackend",
    "MultisigGovernanceMetadata",
    "MajeurGovernanceCreateInput",
    "MajeurGovernanceAttachInput",
    "MajeurSafeSummonInput",
    "MajeurSafeConfigInput",
    "MajeurGovernanceBackend",
    "MajeurGovernanceMetadata",
  ],
  "communities-community": [
    "CreateCommunityDonationPolicyInput",
    "UpdateCommunityDonationPolicyRequest",
    "DonationPartnerSummary",
    "CommunityDonationPolicy",
    "CommunityFundingRouteStatusPolicy",
    "CommunityPolicyOrigin",
    "CommunityMoneyAssetRef",
    "CommunityMoneyChainRef",
    "CreateCommunityMoneyPolicyInput",
    "UpdateCommunityMoneyPolicyRequest",
    "CommunityMoneyPolicy",
    "CreateCommunityPricingPolicyInput",
    "UpdateCommunityPricingPolicyRequest",
    "CommunityPricingPolicy",
    "CommunityListing",
    "CreateCommunityListingRequest",
    "UpdateCommunityListingRequest",
    "CommunityListingListResponse",
    "CommunityPurchase",
    "CommunityPurchaseListResponse",
    "CommunityPurchaseFundingMode",
    "CommunityPurchaseQuotePreflightRequest",
    "CommunityPurchaseQuotePreflight",
    "CommunityPurchaseQuoteRequest",
    "CommunityPurchaseQuote",
    "CreateCommunityBootstrapInput",
    "CreateCommunityLabelPolicyInput",
    "UpdateCommunityLabelPolicyRequest",
    "CreateCommunityLabelDefinitionInput",
    "UpdateCommunityLabelDefinitionInput",
    "CommunityLabelDefinitionMutationInput",
    "CommunityLabelDefinition",
    "CommunityLabelPolicy",
    "PostLabel",
    "CreateCommunityRuleInput",
    "UpdateCommunityRuleInput",
    "CommunityRuleMutationInput",
    "CommunityRule",
    "CreateCommunityResourceLinkInput",
    "UpdateCommunityResourceLinkInput",
    "CommunityResourceLinkMutationInput",
    "CommunityResourceLink",
    "CommunityProfile",
    "UpdateCommunityProfileRequest",
  ],
  "market-context": [
    "CreateCommunityMarketContextPolicyInput",
    "UpdateCommunityMarketContextPolicyRequest",
    "MarketContextProfileSummary",
    "CommunityMarketContextPolicy",
    "MarketContextSummary",
    "MarketContextMarket",
  ],
  handles: [
    "NamespaceAttachmentInput",
    "HandlePolicyInput",
    "HandleAvailability",
    "CommunityHandle",
  ],
  livestreams: [
    "CreateLiveRoomRequest",
    "InitialLiveSetlistInput",
    "LiveSetlistItemInput",
    "LiveRoomPerformerAllocationInput",
    "LiveRoom",
    "HostAttachRequest",
    "GuestAttachRequest",
    "LiveRoomAttachSession",
    "LiveRoomAccessView",
    "LiveRoomReplayView",
    "LiveRoomReplayAccessView",
  ],
  "song-artifacts": [
    "SongAudioArtifactDescriptor",
    "SongImageArtifactDescriptor",
    "SongVideoArtifactDescriptor",
    "CreateSongArtifactBundleRequest",
    "CreateSongArtifactUploadRequest",
    "SongArtifactUploadContentRequest",
    "SongArtifactUpload",
    "SongArtifactBundle",
  ],
  posts: [
    "CreatePostRequest",
    "Post",
    "LocalizedPostResponse",
    "MediaDescriptor",
    "PostEmbed",
    "XEmbedPreview",
    "XPostEmbed",
    "YouTubeEmbedPreview",
    "YouTubeVideoEmbed",
  ],
  questions: ["Question", "CreateQuestionRequest", "QuestionAnswer"],
  feeds: ["FeedResponse", "FeedItem"],
  tracks: [
    "TrackResolveRequest",
    "ListingDonationConfig",
    "PurchaseDonationSettlement",
    "Track",
  ],
  scrobbles: ["CreateScrobbleRequest", "Scrobble", "ListenerSummary"],
  jobs: ["Job", "JobAcceptedResponse"],
  mpp: [
    "MppChallenge",
    "PaymentFailure",
    "ThreadExportRequest",
    "ThreadExportAcceptedResponse",
  ],
};

export const PATH_GROUP_ORDER = [
  "auth",
  "verification",
  "agents",
  "onboarding",
  "users",
  "profiles",
  "communities",
  "livestreams",
  "questions",
  "handles",
  "posts",
  "feeds",
  "tracks",
  "scrobbles",
  "mpp",
  "jobs",
] as const;

export const SCHEMA_GROUP_ORDER = [
  "common",
  "auth",
  "verification",
  "agents",
  "onboarding",
  "users",
  "profiles",
  "communities-core",
  "communities-governance",
  "communities-community",
  "market-context",
  "handles",
  "livestreams",
  "song-artifacts",
  "posts",
  "questions",
  "feeds",
  "tracks",
  "scrobbles",
  "jobs",
  "mpp",
] as const;

export function classifyPath(pathname: string): string {
  if (pathname.startsWith("/auth/")) {
    return "auth";
  }
  if (
    pathname.startsWith("/verification/") ||
    pathname.startsWith("/verification-sessions") ||
    pathname.startsWith("/namespace-verification-sessions") ||
    pathname.startsWith("/namespace-verifications/")
  ) {
    return "verification";
  }
  if (pathname.startsWith("/agent-ownership-sessions") || pathname.startsWith("/agents")) {
    return "agents";
  }
  if (pathname.startsWith("/onboarding/")) {
    return "onboarding";
  }
  if (pathname.startsWith("/users/{user_id}/scrobbles") || pathname === "/scrobbles") {
    return "scrobbles";
  }
  if (pathname.startsWith("/users/")) {
    return "users";
  }
  if (pathname.startsWith("/profiles/")) {
    return "profiles";
  }
  if (pathname.startsWith("/communities/") && pathname.includes("/questions/")) {
    return "questions";
  }
  if (pathname.startsWith("/communities/")) {
    return "communities";
  }
  if (pathname === "/communities") {
    return "communities";
  }
  if (pathname.startsWith("/live-rooms/")) {
    return "livestreams";
  }
  if (pathname.startsWith("/namespaces/")) {
    return "handles";
  }
  if (pathname.startsWith("/posts")) {
    return "posts";
  }
  if (pathname.startsWith("/feeds/")) {
    return "feeds";
  }
  if (pathname.startsWith("/tracks")) {
    return "tracks";
  }
  if (pathname.startsWith("/mpp/")) {
    return "mpp";
  }
  if (pathname === "/jobs" || pathname.startsWith("/jobs/")) {
    return "jobs";
  }

  throw new Error(`Unmapped path group for ${pathname}`);
}

export function classifySchema(name: string): string {
  for (const [group, names] of Object.entries(SCHEMA_GROUPS)) {
    if (names.includes(name)) {
      return group;
    }
  }

  throw new Error(`Unmapped schema group for ${name}`);
}

export function pathAnchor(pathname: string): string {
  const pieces = pathname
    .split("/")
    .filter(Boolean)
    .map((segment) => {
      if (segment.startsWith("{") && segment.endsWith("}")) {
        return `by_${segment.slice(1, -1)}`;
      }

      return segment.replace(/[^A-Za-z0-9]+/g, "_");
    });

  return pieces.join("_");
}

export function ensureDotRelative(relativePath: string): string {
  if (relativePath === "") {
    return "./";
  }

  if (relativePath.startsWith(".")) {
    return relativePath;
  }

  return `./${relativePath}`;
}

export function parseRef(ref: string): { filePath: string; pointer: string } {
  const [filePath, pointer = ""] = ref.split("#");
  return { filePath, pointer: pointer.replace(/^\//, "") };
}

export function sourceRefForBundleRef(ref: string, currentFileRel: string): string {
  if (!ref.startsWith("#/components/")) {
    return ref;
  }

  const parts = ref.split("/");
  const section = parts[2];
  const name = parts[3];

  let targetRel: string;
  if (section === "parameters") {
    targetRel = "components/parameters.yaml";
  } else if (section === "responses") {
    targetRel = "components/responses.yaml";
  } else if (section === "schemas") {
    targetRel = `components/schemas/${classifySchema(name)}.yaml`;
  } else {
    return ref;
  }

  const relative = path.posix.relative(path.posix.dirname(currentFileRel), targetRel);
  return `${ensureDotRelative(relative)}#/${name}`;
}

export function internalRefForSourceRef(ref: string, currentFileRel: string): string | null {
  if (ref.startsWith("#/")) {
    return ref;
  }

  const { filePath, pointer } = parseRef(ref);
  const targetRel = path.posix.normalize(path.posix.join(path.posix.dirname(currentFileRel), filePath));

  if (targetRel === "components/parameters.yaml") {
    return `#/components/parameters/${pointer}`;
  }
  if (targetRel === "components/responses.yaml") {
    return `#/components/responses/${pointer}`;
  }
  if (targetRel.startsWith("components/schemas/")) {
    return `#/components/schemas/${pointer}`;
  }

  return null;
}

export async function readYaml(filePath: string): Promise<any> {
  return parse(await Bun.file(filePath).text());
}

export async function writeYaml(filePath: string, value: unknown): Promise<void> {
  await Bun.write(filePath, stringify(value, { lineWidth: 0 }));
}
