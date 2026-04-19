#!/usr/bin/env bun

import { doctorControlPlane, provisionCommunity, rotateCommunityToken } from "../lib/turso-control-plane";

type Command = "provision-community" | "rotate-community-token" | "doctor";

type Options = {
  command: Command;
  communityId: string;
  creatorUserId: string;
  displayName: string;
  namespaceVerificationId: string;
  groupLocation: string;
  description?: string;
  membershipMode: "open" | "request" | "gated";
  defaultAgeGatePolicy: "none" | "18_plus";
  membershipUniqueHumanProvider?: "self" | "very";
  postingUniqueHumanProvider?: "self" | "very";
  handlePolicyTemplate: "standard" | "premium" | "membership_gated" | "custom";
  handlePricingModel?: string;
  namespaceLabel?: string;
  databaseTokenExpiration?: string;
  reason?: string;
};

function usage(): never {
  console.error(`Usage:
  bun scripts/turso/turso-control-plane.ts provision-community --community-id ID --creator-user-id ID --display-name NAME --namespace-verification-id ID --group-location LOC [options]
  bun scripts/turso/turso-control-plane.ts rotate-community-token --community-id ID [options]
  bun scripts/turso/turso-control-plane.ts doctor [--community-id ID]

Environment:
  CONTROL_PLANE_DATABASE_URL           Required for every command.
  TURSO_CONTROL_PLANE_AUTH_TOKEN       Required when CONTROL_PLANE_DATABASE_URL targets a protected libsql/Turso endpoint.
  TURSO_PLATFORM_API_TOKEN             Required for provision-community and rotate-community-token.
  TURSO_ORGANIZATION_SLUG              Required for provision-community.
  TURSO_COMMUNITY_DB_WRAP_KEY          Required for provision-community, rotate-community-token, and doctor.
  TURSO_COMMUNITY_DB_WRAP_KEY_VERSION  Required positive integer for provision-community and rotate-community-token.

Options:
  --community-id ID                    Required.
  --creator-user-id ID                 Required.
  --display-name NAME                  Required.
  --namespace-verification-id ID       Required.
  --group-location LOC                 Required.
  --description TEXT                   Optional.
  --membership-mode MODE               Default: open
  --default-age-gate-policy POLICY     Default: none
  --membership-unique-human-provider P Optional.
  --posting-unique-human-provider P    Optional.
  --handle-policy-template TEMPLATE    Default: standard
  --handle-pricing-model MODEL         Optional.
  --namespace-label LABEL              Optional.
  --database-token-expiration VALUE    Optional Turso token expiration string.
  --reason TEXT                        Optional rotation reason.
  -h, --help                           Show this help text.`);
  process.exit(1);
}

function parseArgs(argv: string[]): Options {
  const command = argv[0];
  if (!command || command === "-h" || command === "--help") {
    usage();
  }
  if (command !== "provision-community" && command !== "rotate-community-token" && command !== "doctor") {
    console.error(`unknown command: ${command}`);
    usage();
  }

  const options: Options = {
    command,
    communityId: "",
    creatorUserId: "",
    displayName: "",
    namespaceVerificationId: "",
    groupLocation: "",
    membershipMode: "open",
    defaultAgeGatePolicy: "none",
    handlePolicyTemplate: "standard",
  };

  for (let index = 1; index < argv.length; ) {
    const arg = argv[index];
    const value = argv[index + 1];

    switch (arg) {
      case "--community-id":
        options.communityId = value ?? options.communityId;
        index += 2;
        break;
      case "--creator-user-id":
        options.creatorUserId = value ?? options.creatorUserId;
        index += 2;
        break;
      case "--display-name":
        options.displayName = value ?? options.displayName;
        index += 2;
        break;
      case "--namespace-verification-id":
        options.namespaceVerificationId = value ?? options.namespaceVerificationId;
        index += 2;
        break;
      case "--group-location":
        options.groupLocation = value ?? options.groupLocation;
        index += 2;
        break;
      case "--description":
        options.description = value;
        index += 2;
        break;
      case "--membership-mode":
        options.membershipMode = value as Options["membershipMode"];
        index += 2;
        break;
      case "--default-age-gate-policy":
        options.defaultAgeGatePolicy = value as Options["defaultAgeGatePolicy"];
        index += 2;
        break;
      case "--membership-unique-human-provider":
        options.membershipUniqueHumanProvider = value as Options["membershipUniqueHumanProvider"];
        index += 2;
        break;
      case "--posting-unique-human-provider":
        options.postingUniqueHumanProvider = value as Options["postingUniqueHumanProvider"];
        index += 2;
        break;
      case "--handle-policy-template":
        options.handlePolicyTemplate = value as Options["handlePolicyTemplate"];
        index += 2;
        break;
      case "--handle-pricing-model":
        options.handlePricingModel = value;
        index += 2;
        break;
      case "--namespace-label":
        options.namespaceLabel = value;
        index += 2;
        break;
      case "--database-token-expiration":
        options.databaseTokenExpiration = value;
        index += 2;
        break;
      case "--reason":
        options.reason = value;
        index += 2;
        break;
      case "-h":
      case "--help":
        usage();
        break;
      default:
        console.error(`unknown argument: ${arg}`);
        usage();
    }
  }

  if (!options.communityId && options.command !== "doctor") {
    usage();
  }

  if (
    options.command === "provision-community"
    && (
      !options.creatorUserId
      || !options.displayName
      || !options.namespaceVerificationId
      || !options.groupLocation
    )
  ) {
    usage();
  }

  return options;
}

function requireEnv(name: string): string {
  const value = String(process.env[name] ?? "").trim();
  if (!value) {
    console.error(`missing required env var: ${name}`);
    process.exit(1);
  }
  return value;
}

function requirePositiveIntString(name: string): number {
  const raw = requireEnv(name);
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    console.error(`${name} must be a positive integer`);
    process.exit(1);
  }
  return parsed;
}

const options = parseArgs(process.argv.slice(2));
const controlPlaneDatabaseUrl = requireEnv("CONTROL_PLANE_DATABASE_URL");
const controlPlaneAuthToken = String(process.env.TURSO_CONTROL_PLANE_AUTH_TOKEN ?? "").trim() || null;

if (options.command === "provision-community") {
  const result = await provisionCommunity({
    controlPlaneDatabaseUrl,
    controlPlaneAuthToken,
    tursoPlatformApiToken: requireEnv("TURSO_PLATFORM_API_TOKEN"),
    tursoOrganizationSlug: requireEnv("TURSO_ORGANIZATION_SLUG"),
    tursoCommunityDbWrapKey: requireEnv("TURSO_COMMUNITY_DB_WRAP_KEY"),
    tursoCommunityDbWrapKeyVersion: requirePositiveIntString("TURSO_COMMUNITY_DB_WRAP_KEY_VERSION"),
    communityId: options.communityId,
    creatorUserId: options.creatorUserId,
    displayName: options.displayName,
    namespaceVerificationId: options.namespaceVerificationId,
    groupLocation: options.groupLocation,
    description: options.description,
    membershipMode: options.membershipMode,
    defaultAgeGatePolicy: options.defaultAgeGatePolicy,
    membershipUniqueHumanProvider: options.membershipUniqueHumanProvider,
    postingUniqueHumanProvider: options.postingUniqueHumanProvider,
    handlePolicyTemplate: options.handlePolicyTemplate,
    handlePricingModel: options.handlePricingModel,
    namespaceLabel: options.namespaceLabel,
    databaseTokenExpiration: options.databaseTokenExpiration,
  });

  console.log(`community Turso provisioning complete
community_id: ${result.communityId}
job_id: ${result.jobId}
binding_id: ${result.communityDatabaseBindingId}
credential_id: ${result.communityDbCredentialId}
group_name: ${result.groupName}
database_name: ${result.databaseName}
database_url: ${result.databaseUrl}
token_name: ${result.tokenName}
rotation_number: ${result.rotationNumber}`);
}

if (options.command === "rotate-community-token") {
  const result = await rotateCommunityToken({
    controlPlaneDatabaseUrl,
    controlPlaneAuthToken,
    tursoPlatformApiToken: requireEnv("TURSO_PLATFORM_API_TOKEN"),
    tursoCommunityDbWrapKey: requireEnv("TURSO_COMMUNITY_DB_WRAP_KEY"),
    tursoCommunityDbWrapKeyVersion: requirePositiveIntString("TURSO_COMMUNITY_DB_WRAP_KEY_VERSION"),
    communityId: options.communityId,
    reason: options.reason,
    databaseTokenExpiration: options.databaseTokenExpiration,
  });

  console.log(`community Turso token rotation complete
community_id: ${result.communityId}
binding_id: ${result.communityDatabaseBindingId}
credential_id: ${result.communityDbCredentialId}
database_name: ${result.databaseName}
database_url: ${result.databaseUrl}
token_name: ${result.tokenName}
rotation_number: ${result.rotationNumber}`);
}

if (options.command === "doctor") {
  const result = await doctorControlPlane({
    controlPlaneDatabaseUrl,
    controlPlaneAuthToken,
    communityId: options.communityId || null,
    tursoCommunityDbWrapKey: requireEnv("TURSO_COMMUNITY_DB_WRAP_KEY"),
  });

  console.log(`community Turso doctor complete
checked_communities: ${result.checkedCommunityCount}
checked_bindings: ${result.checkedBindingCount}
checked_credentials: ${result.checkedCredentialCount}
findings: ${result.findingCount}`);

  for (const finding of result.findings) {
    console.log(`${finding.severity}: ${finding.code}: community=${finding.communityId}${finding.communityDatabaseBindingId ? ` binding=${finding.communityDatabaseBindingId}` : ""} ${finding.message}`);
  }

  if (result.findingCount > 0) {
    process.exit(1);
  }
}
