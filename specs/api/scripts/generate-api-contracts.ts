import { existsSync } from "node:fs";
import { parse } from "yaml";
import { IMPLEMENTED_BUNDLE_FILE } from "./_shared";
import { loadSourceSchemas, type BundleSpec, TypeGenerator } from "./_typegen";

const SOURCE_SCHEMA_DIR = "specs/api/src/components/schemas";
function defaultApiContractsDir(): string {
  if (existsSync("pirate-api/services/contracts")) {
    return "pirate-api/services/contracts";
  }
  if (existsSync("../../pirate-api/services/contracts")) {
    return "../../pirate-api/services/contracts";
  }
  return "pirate-api/services/contracts";
}

const API_CONTRACTS_DIR = process.env.API_CONTRACTS_DIR || defaultApiContractsDir();
const OUTPUT_FILE = process.env.API_CONTRACTS_OUTPUT_FILE || `${API_CONTRACTS_DIR}/src/index.ts`;

const TYPE_EXPORTS = [
  { name: "ErrorResponse", ref: "#/components/schemas/Error" },
  {
    name: "AuthProof",
    ref: "#/paths/~1auth~1session~1exchange/post/requestBody/content/application~1json/schema/properties/proof",
  },
  {
    name: "SessionExchangeRequest",
    ref: "#/paths/~1auth~1session~1exchange/post/requestBody/content/application~1json/schema",
  },
  { name: "VerificationCapabilities", ref: "#/components/schemas/VerificationCapabilities" },
  { name: "User", ref: "#/components/schemas/User" },
  { name: "GlobalHandle", ref: "#/components/schemas/GlobalHandle" },
  { name: "Profile", ref: "#/components/schemas/Profile" },
  { name: "RedditVerification", ref: "#/components/schemas/RedditVerification" },
  { name: "RedditImportSummary", ref: "#/components/schemas/RedditImportSummary" },
  { name: "OnboardingStatus", ref: "#/components/schemas/OnboardingStatus" },
  { name: "WalletAttachmentSummary", ref: "#/components/schemas/WalletAttachmentSummary" },
  { name: "VerificationSession", ref: "#/components/schemas/VerificationSession" },
  { name: "VerificationSessionLaunch", ref: "#/components/schemas/VerificationSessionLaunch" },
  { name: "VeryWidgetLaunch", ref: "#/components/schemas/VeryWidgetLaunch" },
  { name: "RequestedVerificationCapability", ref: "#/components/schemas/RequestedVerificationCapability" },
  { name: "VerificationRequirement", ref: "#/components/schemas/VerificationRequirement" },
  { name: "VerificationIntent", ref: "#/components/schemas/VerificationIntent" },
  { name: "AgentOwnershipProvider", ref: "#/components/schemas/AgentOwnershipProvider" },
  { name: "AgentOwnershipSessionKind", ref: "#/components/schemas/AgentOwnershipSessionKind" },
  { name: "AgentOwnershipSessionStatus", ref: "#/components/schemas/AgentOwnershipSessionStatus" },
  { name: "UserAgentStatus", ref: "#/components/schemas/UserAgentStatus" },
  { name: "AgentHandleStatus", ref: "#/components/schemas/AgentHandleStatus" },
  { name: "AgentOwnershipState", ref: "#/components/schemas/AgentOwnershipState" },
  { name: "AgentChallenge", ref: "#/components/schemas/AgentChallenge" },
  { name: "AgentActionProof", ref: "#/components/schemas/AgentActionProof" },
  { name: "SelfAgentOwnershipLaunch", ref: "#/components/schemas/SelfAgentOwnershipLaunch" },
  { name: "ClawkeyRegistrationLaunch", ref: "#/components/schemas/ClawkeyRegistrationLaunch" },
  { name: "AgentOwnershipSessionLaunch", ref: "#/components/schemas/AgentOwnershipSessionLaunch" },
  { name: "StartAgentOwnershipSessionRequest", ref: "#/components/schemas/StartAgentOwnershipSessionRequest" },
  { name: "CompleteAgentOwnershipSessionRequest", ref: "#/components/schemas/CompleteAgentOwnershipSessionRequest" },
  { name: "AgentOwnershipPairing", ref: "#/components/schemas/AgentOwnershipPairing" },
  { name: "AgentOwnershipPairingClaimRequest", ref: "#/components/schemas/AgentOwnershipPairingClaimRequest" },
  { name: "AgentOwnershipPairingClaimResult", ref: "#/components/schemas/AgentOwnershipPairingClaimResult" },
  { name: "ProviderAgentOwnershipCallbackRequest", ref: "#/components/schemas/ProviderAgentOwnershipCallbackRequest" },
  { name: "AgentOwnershipRecord", ref: "#/components/schemas/AgentOwnershipRecord" },
  { name: "AgentOwnershipSession", ref: "#/components/schemas/AgentOwnershipSession" },
  { name: "AgentDelegatedCredentialIssueRequest", ref: "#/components/schemas/AgentDelegatedCredentialIssueRequest" },
  { name: "AgentDelegatedCredentialRefreshRequest", ref: "#/components/schemas/AgentDelegatedCredentialRefreshRequest" },
  { name: "AgentDelegatedCredential", ref: "#/components/schemas/AgentDelegatedCredential" },
  { name: "UserAgent", ref: "#/components/schemas/UserAgent" },
  { name: "UserAgentListResponse", ref: "#/components/schemas/UserAgentListResponse" },
  { name: "AgentHandle", ref: "#/components/schemas/AgentHandle" },
  { name: "UpdateAgentHandleRequest", ref: "#/components/schemas/UpdateAgentHandleRequest" },
  { name: "UpdateUserAgentRequest", ref: "#/components/schemas/UpdateUserAgentRequest" },
  { name: "PublicAgentResolution", ref: "#/components/schemas/PublicAgentResolution" },
  { name: "NamespaceVerificationAssertions", ref: "#/components/schemas/NamespaceVerificationAssertions" },
  { name: "NamespaceVerificationCapabilities", ref: "#/components/schemas/NamespaceVerificationCapabilities" },
  { name: "NamespaceVerificationSession", ref: "#/components/schemas/NamespaceVerificationSession" },
  { name: "NamespaceVerification", ref: "#/components/schemas/NamespaceVerification" },
  { name: "SessionExchangeResponse", ref: "#/components/schemas/SessionExchangeResponse" },
  { name: "Community", ref: "#/components/schemas/Community" },
  { name: "CommunityMoneyPolicy", ref: "#/components/schemas/CommunityMoneyPolicy" },
  { name: "CommunityPricingPolicy", ref: "#/components/schemas/CommunityPricingPolicy" },
  { name: "CommunityListing", ref: "#/components/schemas/CommunityListing" },
  { name: "CreateCommunityListingRequest", ref: "#/components/schemas/CreateCommunityListingRequest" },
  { name: "UpdateCommunityListingRequest", ref: "#/components/schemas/UpdateCommunityListingRequest" },
  { name: "CommunityListingListResponse", ref: "#/components/schemas/CommunityListingListResponse" },
  { name: "CommunityPurchase", ref: "#/components/schemas/CommunityPurchase" },
  { name: "CommunityPurchaseListResponse", ref: "#/components/schemas/CommunityPurchaseListResponse" },
  { name: "CommunityPurchaseQuotePreflightRequest", ref: "#/components/schemas/CommunityPurchaseQuotePreflightRequest" },
  { name: "CommunityPurchaseQuotePreflight", ref: "#/components/schemas/CommunityPurchaseQuotePreflight" },
  { name: "CommunityPurchaseQuoteRequest", ref: "#/components/schemas/CommunityPurchaseQuoteRequest" },
  { name: "CommunityPurchaseQuote", ref: "#/components/schemas/CommunityPurchaseQuote" },
  { name: "CommunityPurchaseSettlementRequest", ref: "#/components/schemas/CommunityPurchaseSettlementRequest" },
  { name: "CommunityPurchaseSettlement", ref: "#/components/schemas/CommunityPurchaseSettlement" },
  {
    name: "CommunityPurchaseSettlementFailureRequest",
    ref: "#/components/schemas/CommunityPurchaseSettlementFailureRequest",
  },
  { name: "CommunityPurchaseSettlementFailure", ref: "#/components/schemas/CommunityPurchaseSettlementFailure" },
  { name: "MembershipResult", ref: "#/components/schemas/MembershipResult" },
  { name: "Job", ref: "#/components/schemas/Job" },
  { name: "CommunityCreateAcceptedResponse", ref: "#/components/schemas/CommunityCreateAcceptedResponse" },
  { name: "CreateCommunityRequest", ref: "#/components/schemas/CreateCommunityRequest" },
  { name: "UpdateCommunityMoneyPolicyRequest", ref: "#/components/schemas/UpdateCommunityMoneyPolicyRequest" },
  { name: "UpdateCommunityPricingPolicyRequest", ref: "#/components/schemas/UpdateCommunityPricingPolicyRequest" },
  { name: "StartVerificationSessionRequest", ref: "#/components/schemas/StartVerificationSessionRequest" },
  { name: "CompleteVerificationSessionRequest", ref: "#/components/schemas/CompleteVerificationSessionRequest" },
  {
    name: "StartNamespaceVerificationSessionRequest",
    ref: "#/components/schemas/StartNamespaceVerificationSessionRequest",
  },
  {
    name: "CompleteNamespaceVerificationSessionRequest",
    ref: "#/components/schemas/CompleteNamespaceVerificationSessionRequest",
  },
  { name: "CreateSongArtifactUploadRequest", ref: "#/components/schemas/CreateSongArtifactUploadRequest" },
  { name: "CreateSongArtifactBundleRequest", ref: "#/components/schemas/CreateSongArtifactBundleRequest" },
  { name: "CreatePostRequest", ref: "#/components/schemas/CreatePostRequest" },
  { name: "CreateCommentRequest", ref: "#/components/schemas/CreateCommentRequest" },
  { name: "Asset", ref: "#/components/schemas/Asset" },
  { name: "AssetAccessResponse", ref: "#/components/schemas/AssetAccessResponse" },
  { name: "SongArtifactUpload", ref: "#/components/schemas/SongArtifactUpload" },
  { name: "SongArtifactBundle", ref: "#/components/schemas/SongArtifactBundle" },
  { name: "SongPreviewGeneratePayload", ref: "#/components/schemas/SongPreviewGeneratePayload" },
  { name: "Post", ref: "#/components/schemas/Post" },
  { name: "Comment", ref: "#/components/schemas/Comment" },
  { name: "CommentListItem", ref: "#/components/schemas/CommentListItem" },
  { name: "CommentThreadSnapshot", ref: "#/components/schemas/CommentThreadSnapshot" },
  { name: "CommentListResponse", ref: "#/components/schemas/CommentListResponse" },
  { name: "CommentContext", ref: "#/components/schemas/CommentContext" },
  { name: "PostVoteResponse", ref: "#/components/schemas/PostVoteResponse" },
  { name: "CommentVoteResponse", ref: "#/components/schemas/CommentVoteResponse" },
  { name: "ModerationSignalSeverity", ref: "#/components/schemas/ModerationSignalSeverity" },
  { name: "UserReportReasonCode", ref: "#/components/schemas/UserReportReasonCode" },
  { name: "ModerationActionType", ref: "#/components/schemas/ModerationActionType" },
  { name: "CreateUserReportRequest", ref: "#/components/schemas/CreateUserReportRequest" },
  { name: "UserReport", ref: "#/components/schemas/UserReport" },
  { name: "ModerationSignal", ref: "#/components/schemas/ModerationSignal" },
  { name: "ModerationAction", ref: "#/components/schemas/ModerationAction" },
  { name: "ModerationCase", ref: "#/components/schemas/ModerationCase" },
  { name: "ModerationCaseDetail", ref: "#/components/schemas/ModerationCaseDetail" },
  { name: "ModerationCaseListResponse", ref: "#/components/schemas/ModerationCaseListResponse" },
  { name: "CreateModerationActionRequest", ref: "#/components/schemas/CreateModerationActionRequest" },
  { name: "LocalizedPostResponse", ref: "#/components/schemas/LocalizedPostResponse" },
  { name: "MembershipGateSummary", ref: "#/components/schemas/MembershipGateSummary" },
  { name: "CommunityPreview", ref: "#/components/schemas/CommunityPreview" },
  { name: "JoinEligibility", ref: "#/components/schemas/JoinEligibility" },
  { name: "GateFailureDetails", ref: "#/components/schemas/GateFailureDetails" },
  { name: "HomeFeedCommunitySummary", ref: "#/components/schemas/HomeFeedCommunitySummary" },
  { name: "HomeFeedItem", ref: "#/components/schemas/FeedItem" },
  { name: "HomeFeedResponse", ref: "#/components/schemas/FeedResponse" },
  { name: "HomeFeedSort", ref: "#/components/parameters/FeedSort/schema" },
  { name: "LinkedHandle", ref: "#/components/schemas/LinkedHandle" },
  { name: "SelfVerificationDisclosures", ref: "#/components/schemas/SelfVerificationDisclosures" },
  { name: "SelfVerificationLaunch", ref: "#/components/schemas/SelfVerificationLaunch" },
  { name: "UserTaskType", ref: "#/components/schemas/UserTaskType" },
  { name: "UserTaskStatus", ref: "#/components/schemas/UserTaskStatus" },
  { name: "NotificationEventType", ref: "#/components/schemas/NotificationEventType" },
  { name: "UserTask", ref: "#/components/schemas/UserTask" },
  { name: "NotificationEvent", ref: "#/components/schemas/NotificationEvent" },
  { name: "NotificationReceipt", ref: "#/components/schemas/NotificationReceipt" },
  { name: "NotificationSummary", ref: "#/components/schemas/NotificationSummary" },
  { name: "NotificationFeedItem", ref: "#/components/schemas/NotificationFeedItem" },
  { name: "NotificationFeedResponse", ref: "#/components/schemas/NotificationFeedResponse" },
  { name: "NotificationTasksResponse", ref: "#/components/schemas/NotificationTasksResponse" },
  { name: "MarkNotificationsReadRequest", ref: "#/components/schemas/MarkNotificationsReadRequest" },
  { name: "DismissTaskRequest", ref: "#/components/schemas/DismissTaskRequest" },
] as const;

const ROUTE_EXPORTS = [
  { name: "authSessionExchange", path: "/auth/session/exchange" },
  { name: "usersMe", path: "/users/me" },
  { name: "onboardingStatus", path: "/onboarding/status" },
  { name: "onboardingRedditVerification", path: "/onboarding/reddit-verification" },
  { name: "onboardingRedditImports", path: "/onboarding/reddit-imports" },
  { name: "onboardingRedditImportsLatest", path: "/onboarding/reddit-imports/latest" },
  { name: "verificationSessions", path: "/verification-sessions" },
  { name: "verificationSession", path: "/verification-sessions/{verification_session_id}" },
  { name: "verificationSessionComplete", path: "/verification-sessions/{verification_session_id}/complete" },
  { name: "agentOwnershipSessions", path: "/agent-ownership-sessions" },
  { name: "agentOwnershipPairing", path: "/agent-ownership-pairing" },
  { name: "agentOwnershipPairingClaim", path: "/agent-ownership-pairing/claim" },
  { name: "agentOwnershipSession", path: "/agent-ownership-sessions/{agent_ownership_session_id}" },
  {
    name: "agentOwnershipSessionComplete",
    path: "/agent-ownership-sessions/{agent_ownership_session_id}/complete",
  },
  { name: "agents", path: "/agents" },
  { name: "agent", path: "/agents/{agent_id}" },
  { name: "agentHandle", path: "/agents/{agent_id}/handle" },
  { name: "agentCredential", path: "/agents/{agent_id}/credential" },
  { name: "agentCredentialRefresh", path: "/agents/{agent_id}/credential/refresh" },
  { name: "publicAgent", path: "/public-agents/{handle_label}" },
  { name: "namespaceVerificationSessions", path: "/namespace-verification-sessions" },
  { name: "namespaceVerificationSession", path: "/namespace-verification-sessions/{namespace_verification_session_id}" },
  {
    name: "namespaceVerificationSessionComplete",
    path: "/namespace-verification-sessions/{namespace_verification_session_id}/complete",
  },
  { name: "namespaceVerification", path: "/namespace-verifications/{namespace_verification_id}" },
  { name: "communities", path: "/communities" },
  { name: "community", path: "/communities/{community_id}" },
  { name: "communityMoneyPolicy", path: "/communities/{community_id}/money-policy" },
  { name: "communityPricingPolicy", path: "/communities/{community_id}/pricing-policy" },
  { name: "communityListings", path: "/communities/{community_id}/listings" },
  { name: "communityListing", path: "/communities/{community_id}/listings/{listing_id}" },
  { name: "communityPurchases", path: "/communities/{community_id}/purchases" },
  { name: "communityPurchase", path: "/communities/{community_id}/purchases/{purchase_id}" },
  { name: "communityPurchaseQuotePreflight", path: "/communities/{community_id}/purchase-quote-preflight" },
  { name: "communityPurchaseQuotes", path: "/communities/{community_id}/purchase-quotes" },
  { name: "communityPurchaseSettlements", path: "/communities/{community_id}/purchase-settlements" },
  { name: "communityPurchaseSettlementFailures", path: "/communities/{community_id}/purchase-settlements/fail" },
  { name: "communityPosts", path: "/communities/{community_id}/posts" },
  { name: "communityPostComments", path: "/communities/{community_id}/posts/{post_id}/comments" },
  { name: "communityPostReports", path: "/communities/{community_id}/posts/{post_id}/reports" },
  { name: "communityCommentReports", path: "/communities/{community_id}/comments/{comment_id}/reports" },
  { name: "communityModerationCases", path: "/communities/{community_id}/moderation/cases" },
  { name: "communityModerationCase", path: "/communities/{community_id}/moderation/cases/{moderation_case_id}" },
  { name: "communityModerationCaseActions", path: "/communities/{community_id}/moderation/cases/{moderation_case_id}/actions" },
  { name: "communityPreview", path: "/communities/{community_id}/preview" },
  { name: "communityJoinEligibility", path: "/communities/{community_id}/join-eligibility" },
  { name: "communitySongArtifactUploads", path: "/communities/{community_id}/song-artifact-uploads" },
  {
    name: "communitySongArtifactUploadContent",
    path: "/communities/{community_id}/song-artifact-uploads/{song_artifact_upload_id}/content",
  },
  { name: "communitySongArtifacts", path: "/communities/{community_id}/song-artifacts" },
  { name: "communitySongArtifact", path: "/communities/{community_id}/song-artifacts/{song_artifact_bundle_id}" },
  { name: "job", path: "/jobs/{job_id}" },
  { name: "post", path: "/posts/{post_id}" },
  { name: "postVote", path: "/posts/{post_id}/vote" },
  { name: "comment", path: "/comments/{comment_id}" },
  { name: "commentReplies", path: "/comments/{comment_id}/replies" },
  { name: "commentContext", path: "/comments/{comment_id}/context" },
  { name: "commentVote", path: "/comments/{comment_id}/vote" },
  { name: "notificationsSummary", path: "/notifications/summary" },
  { name: "notificationsTasks", path: "/notifications/tasks" },
  { name: "notificationsFeed", path: "/notifications/feed" },
  { name: "notificationsMarkRead", path: "/notifications/mark-read" },
  { name: "notificationsDismissTask", path: "/notifications/dismiss-task" },
] as const;

const GENERATED_FILE_BANNER = `// GENERATED FILE. Edit specs/api/src/** and run \`rtk bun specs/api/scripts/generate-api-contracts.ts\`.\n`;

function toCamelCase(value: string): string {
  return value.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase());
}

function renderRoute(entry: { name: string; path: string }): string {
  const params = Array.from(entry.path.matchAll(/\{([^}]+)\}/g)).map((match) => match[1]);
  if (params.length === 0) {
    return `  ${entry.name}: ${JSON.stringify(entry.path)},`;
  }

  const argumentsList = params.map((param) => `${toCamelCase(param)}: string`).join(", ");
  let template = entry.path;
  for (const param of params) {
    template = template.replace(`{${param}}`, `\${${toCamelCase(param)}}`);
  }

  return `  ${entry.name}: (${argumentsList}) => \`${template}\`,`;
}

function renderRoutes(bundle: BundleSpec): string {
  const pathKeys = new Set(Object.keys(bundle.paths ?? {}));
  for (const entry of ROUTE_EXPORTS) {
    if (!pathKeys.has(entry.path)) {
      throw new Error(`Missing implemented route ${entry.path}`);
    }
  }

  return `export const apiRoutes = {\n${ROUTE_EXPORTS.map(renderRoute).join("\n")}\n} as const\n`;
}

async function main() {
  const bundle = parse(await Bun.file(IMPLEMENTED_BUNDLE_FILE).text()) as BundleSpec;
  const sourceSchemas = await loadSourceSchemas(SOURCE_SCHEMA_DIR);
  const generator = new TypeGenerator(bundle, sourceSchemas, TYPE_EXPORTS);
  const output = `${GENERATED_FILE_BANNER}\n${generator.generate(TYPE_EXPORTS)}\n${renderRoutes(bundle)}`;

  await Bun.write(OUTPUT_FILE, output);
  console.log(
    JSON.stringify(
      {
        output: OUTPUT_FILE,
        exported_types: TYPE_EXPORTS.map((entry) => entry.name),
        exported_type_count: TYPE_EXPORTS.length,
        exported_routes: ROUTE_EXPORTS.map((entry) => entry.name),
        exported_route_count: ROUTE_EXPORTS.length,
      },
      null,
      2,
    ),
  );
}

await main();
