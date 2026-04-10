import { parse } from "yaml";
import { IMPLEMENTED_BUNDLE_FILE } from "./_shared";
import { loadSourceSchemas, type BundleSpec, TypeGenerator } from "./_typegen";

const SOURCE_SCHEMA_DIR = "specs/api/src/components/schemas";
const OUTPUT_FILE = "pirate-api/services/contracts/src/index.ts";

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
  { name: "SongArtifactUpload", ref: "#/components/schemas/SongArtifactUpload" },
  { name: "SongArtifactBundle", ref: "#/components/schemas/SongArtifactBundle" },
  { name: "Post", ref: "#/components/schemas/Post" },
  { name: "LocalizedPostResponse", ref: "#/components/schemas/LocalizedPostResponse" },
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
  { name: "communitySongArtifactUploads", path: "/communities/{community_id}/song-artifact-uploads" },
  {
    name: "communitySongArtifactUploadContent",
    path: "/communities/{community_id}/song-artifact-uploads/{song_artifact_upload_id}/content",
  },
  { name: "communitySongArtifacts", path: "/communities/{community_id}/song-artifacts" },
  { name: "communitySongArtifact", path: "/communities/{community_id}/song-artifacts/{song_artifact_bundle_id}" },
  { name: "job", path: "/jobs/{job_id}" },
  { name: "post", path: "/posts/{post_id}" },
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
