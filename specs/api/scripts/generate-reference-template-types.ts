import { parse } from "yaml";
import { IMPLEMENTED_BUNDLE_FILE } from "./_shared";
import { loadSourceSchemas, type BundleSpec, TypeGenerator } from "./_typegen";

const SOURCE_SCHEMA_DIR = "specs/api/src/components/schemas";
const OUTPUT_FILE = "references/templates/api-worker-auth-first-slice/src/types/api.ts";

const EXPORTS = [
  { name: "VerificationCapabilityState", ref: "#/components/schemas/VerificationCapabilityState" },
  { name: "VerifiedCapabilityState", ref: "#/components/schemas/VerifiedCapabilityState" },
  { name: "SanctionsClearCapabilityState", ref: "#/components/schemas/SanctionsClearCapabilityState" },
  { name: "WalletScoreCapabilityState", ref: "#/components/schemas/WalletScoreCapabilityState" },
  { name: "VerificationCapabilities", ref: "#/components/schemas/VerificationCapabilities" },
  { name: "User", ref: "#/components/schemas/User" },
  { name: "GlobalHandle", ref: "#/components/schemas/GlobalHandle" },
  { name: "Profile", ref: "#/components/schemas/Profile" },
  { name: "RedditVerification", ref: "#/components/schemas/RedditVerification" },
  { name: "RedditImportSummary", ref: "#/components/schemas/RedditImportSummary" },
  { name: "OnboardingStatus", ref: "#/components/schemas/OnboardingStatus" },
  { name: "WalletAttachmentSummary", ref: "#/components/schemas/WalletAttachmentSummary" },
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
  { name: "UpdateCommunityMoneyPolicyRequest", ref: "#/components/schemas/UpdateCommunityMoneyPolicyRequest" },
  { name: "UpdateCommunityPricingPolicyRequest", ref: "#/components/schemas/UpdateCommunityPricingPolicyRequest" },
  { name: "Job", ref: "#/components/schemas/Job" },
  { name: "JobAcceptedResponse", ref: "#/components/schemas/JobAcceptedResponse" },
  { name: "CommunityCreateAcceptedResponse", ref: "#/components/schemas/CommunityCreateAcceptedResponse" },
  { name: "ErrorShape", ref: "#/components/schemas/Error" },
] as const;

const GENERATED_FILE_BANNER = `// GENERATED FILE. Edit specs/api/src/** and run \`rtk bun specs/api/scripts/generate-reference-template-types.ts\`.\n`;

async function main() {
  const bundle = parse(await Bun.file(IMPLEMENTED_BUNDLE_FILE).text()) as BundleSpec;
  const sourceSchemas = await loadSourceSchemas(SOURCE_SCHEMA_DIR);
  const generator = new TypeGenerator(bundle, sourceSchemas, EXPORTS);
  const output = `${GENERATED_FILE_BANNER}\n${generator.generate(EXPORTS)}`;

  await Bun.write(OUTPUT_FILE, output);
  console.log(
    JSON.stringify(
      {
        output: OUTPUT_FILE,
        exported_types: EXPORTS.map((entry) => entry.name),
        exported_count: EXPORTS.length,
      },
      null,
      2,
    ),
  );
}

await main();
