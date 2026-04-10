#!/usr/bin/env bun

import { resolve } from "node:path";

type Options = {
  databaseUrlEnv: string;
  communityDb: string;
  communityId: string;
  userId: string;
  displayName: string;
  namespaceVerificationId: string;
  description?: string;
  membershipMode: "open" | "request" | "gated";
  defaultAgeGatePolicy: "none" | "18_plus";
  handlePolicyTemplate: "standard" | "premium" | "membership_gated" | "custom";
  handlePricingModel?: string;
  namespaceLabel?: string;
};

function usage(): never {
  console.error(`Usage:
  bun scripts/bootstrap-community-slice.ts --database-url-env ENV_NAME --community-db PATH --community-id ID --user-id ID --display-name NAME --namespace-verification-id ID [options]

Creates a local stub community end to end:
- writes the control-plane community and job rows to Neon
- bootstraps the local community SQLite DB
- writes the local binding and completion audit row back to Neon

Options:
  --database-url-env ENV_NAME       Environment variable containing the control-plane DB URL. Required.
  --community-db PATH               Target local community database file path. Required.
  --community-id ID                 Community ID. Required.
  --user-id ID                      Creator / owner user ID. Required.
  --display-name NAME               Community display name. Required.
  --namespace-verification-id ID    Accepted namespace verification ID. Required.
  --description TEXT                Optional community description.
  --membership-mode MODE            Default: open
  --default-age-gate-policy POLICY  Default: none
  --handle-policy-template TPL      Default: standard
  --handle-pricing-model MODEL      Optional.
  --namespace-label LABEL           Optional. Defaults to lowercased community ID.
  -h, --help                        Show this help text.`);
  process.exit(1);
}

function parseArgs(argv: string[]): Options {
  const options: Partial<Options> = {
    membershipMode: "open",
    defaultAgeGatePolicy: "none",
    handlePolicyTemplate: "standard",
  };

  for (let index = 0; index < argv.length; ) {
    const arg = argv[index];
    const value = argv[index + 1];

    switch (arg) {
      case "--database-url-env":
        options.databaseUrlEnv = value;
        index += 2;
        break;
      case "--community-db":
        options.communityDb = value;
        index += 2;
        break;
      case "--community-id":
        options.communityId = value;
        index += 2;
        break;
      case "--user-id":
        options.userId = value;
        index += 2;
        break;
      case "--display-name":
        options.displayName = value;
        index += 2;
        break;
      case "--namespace-verification-id":
        options.namespaceVerificationId = value;
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
      case "-h":
      case "--help":
        usage();
        break;
      default:
        console.error(`unknown argument: ${arg}`);
        usage();
    }
  }

  if (
    !options.databaseUrlEnv ||
    !options.communityDb ||
    !options.communityId ||
    !options.userId ||
    !options.displayName ||
    !options.namespaceVerificationId
  ) {
    usage();
  }

  return options as Options;
}

function nowIso(date = new Date()): string {
  return date.toISOString();
}

function assertEnum<T extends string>(value: string, allowed: readonly T[], flag: string): T {
  if (!allowed.includes(value as T)) {
    throw new Error(`invalid ${flag}: ${value}`);
  }
  return value as T;
}

const options = parseArgs(process.argv.slice(2));
const databaseUrl = process.env[options.databaseUrlEnv];

if (!databaseUrl) {
  throw new Error(`missing database url env var: ${options.databaseUrlEnv}`);
}

assertEnum(options.membershipMode, ["open", "request", "gated"] as const, "--membership-mode");
assertEnum(options.defaultAgeGatePolicy, ["none", "18_plus"] as const, "--default-age-gate-policy");
assertEnum(
  options.handlePolicyTemplate,
  ["standard", "premium", "membership_gated", "custom"] as const,
  "--handle-policy-template",
);

const db = new Bun.SQL(databaseUrl);
const communityDbPath = resolve(options.communityDb);
const namespaceLabel = options.namespaceLabel ?? options.communityId.toLowerCase();
const databaseUrlForBinding = `file://${communityDbPath}`;
const createdAt = nowIso();

const bindingId = `cdb_${options.communityId}_primary`;
const jobId = `job_${options.communityId}_provisioning`;
const successAuditId = `audit_${options.communityId}_bootstrap_success`;
const failureAuditId = `audit_${options.communityId}_bootstrap_failed`;

const namespaceRows = await db<{
  namespace_verification_id: string;
  user_id: string;
  status: string;
  club_attach_allowed: number;
  normalized_root_label: string;
}[]>`
  SELECT
    namespace_verification_id,
    user_id,
    status,
    club_attach_allowed,
    normalized_root_label
  FROM namespace_verifications
  WHERE namespace_verification_id = ${options.namespaceVerificationId}
`;

const namespaceVerification = namespaceRows[0];
if (!namespaceVerification) {
  await db.end();
  throw new Error(`namespace verification not found: ${options.namespaceVerificationId}`);
}

if (namespaceVerification.user_id !== options.userId) {
  await db.end();
  throw new Error("namespace verification does not belong to the provided user");
}

if (namespaceVerification.status !== "verified" || namespaceVerification.club_attach_allowed !== 1) {
  await db.end();
  throw new Error("namespace verification is not attachable");
}

const existingCommunityRows = await db<{ community_id: string }[]>`
  SELECT community_id
  FROM communities
  WHERE namespace_verification_id = ${options.namespaceVerificationId}
`;

if (existingCommunityRows[0] && existingCommunityRows[0].community_id !== options.communityId) {
  await db.end();
  throw new Error(
    `namespace verification already attached to a different community: ${existingCommunityRows[0].community_id}`,
  );
}

await db.begin(async (tx) => {
  await tx`
    INSERT INTO communities (
      community_id,
      creator_user_id,
      display_name,
      status,
      provisioning_state,
      transfer_state,
      route_slug,
      namespace_verification_id,
      primary_database_binding_id,
      created_at,
      updated_at,
      registry_publication_state,
      registry_attempt_id,
      registry_published_at,
      registry_publication_job_id,
      registry_error_code
    ) VALUES (
      ${options.communityId},
      ${options.userId},
      ${options.displayName},
      'active',
      'provisioning',
      'none',
      NULL,
      ${options.namespaceVerificationId},
      NULL,
      ${createdAt},
      ${createdAt},
      'not_started',
      NULL,
      NULL,
      NULL,
      NULL
    )
    ON CONFLICT (community_id) DO UPDATE SET
      creator_user_id = EXCLUDED.creator_user_id,
      display_name = EXCLUDED.display_name,
      status = EXCLUDED.status,
      provisioning_state = EXCLUDED.provisioning_state,
      transfer_state = EXCLUDED.transfer_state,
      namespace_verification_id = EXCLUDED.namespace_verification_id,
      updated_at = EXCLUDED.updated_at,
      registry_publication_state = EXCLUDED.registry_publication_state,
      registry_attempt_id = NULL,
      registry_published_at = EXCLUDED.registry_published_at,
      registry_publication_job_id = EXCLUDED.registry_publication_job_id,
      registry_error_code = EXCLUDED.registry_error_code
  `;

  await tx`
    INSERT INTO jobs (
      job_id,
      job_type,
      job_scope,
      community_id,
      subject_type,
      subject_id,
      status,
      payload_json,
      result_ref,
      error_code,
      attempt_count,
      available_at,
      created_at,
      updated_at
    ) VALUES (
      ${jobId},
      'community_provisioning',
      'platform',
      ${options.communityId},
      'community',
      ${options.communityId},
      'running',
      ${JSON.stringify({
        namespace_verification_id: options.namespaceVerificationId,
        mode: "local_stub",
        community_db_path: communityDbPath,
      })},
      NULL,
      NULL,
      1,
      ${createdAt},
      ${createdAt},
      ${createdAt}
    )
    ON CONFLICT (job_id) DO UPDATE SET
      community_id = EXCLUDED.community_id,
      subject_id = EXCLUDED.subject_id,
      status = EXCLUDED.status,
      payload_json = EXCLUDED.payload_json,
      result_ref = EXCLUDED.result_ref,
      error_code = EXCLUDED.error_code,
      attempt_count = EXCLUDED.attempt_count,
      available_at = EXCLUDED.available_at,
      updated_at = EXCLUDED.updated_at
  `;
});

const bootstrap = Bun.spawnSync(
  [
    "bash",
    resolve("scripts/bootstrap-community-db.sh"),
    "--db",
    communityDbPath,
    "--community-id",
    options.communityId,
    "--user-id",
    options.userId,
    "--display-name",
    options.displayName,
    "--namespace-verification-id",
    options.namespaceVerificationId,
    "--namespace-label",
    namespaceLabel,
    "--membership-mode",
    options.membershipMode,
    "--default-age-gate-policy",
    options.defaultAgeGatePolicy,
    "--handle-policy-template",
    options.handlePolicyTemplate,
    ...(options.description ? ["--description", options.description] : []),
    ...(options.handlePricingModel ? ["--handle-pricing-model", options.handlePricingModel] : []),
  ],
  {
    cwd: resolve("."),
    stdout: "pipe",
    stderr: "pipe",
  },
);

const completionTime = nowIso();

if (bootstrap.exitCode !== 0) {
  const failureMessage = new TextDecoder().decode(bootstrap.stderr).trim() || "community_bootstrap_failed";

  await db.begin(async (tx) => {
    await tx`
      UPDATE jobs
      SET status = 'failed',
          error_code = 'local_stub_bootstrap_failed',
          result_ref = NULL,
          updated_at = ${completionTime}
      WHERE job_id = ${jobId}
    `;

    await tx`
      UPDATE communities
      SET provisioning_state = 'error',
          updated_at = ${completionTime}
      WHERE community_id = ${options.communityId}
    `;

    await tx`
      INSERT INTO audit_log (
        audit_event_id,
        actor_type,
        actor_id,
        action,
        target_type,
        target_id,
        community_id,
        metadata_json,
        created_at
      ) VALUES (
        ${failureAuditId},
        'system',
        NULL,
        'community.local_stub.bootstrap_failed',
        'community',
        ${options.communityId},
        ${options.communityId},
        ${JSON.stringify({
          job_id: jobId,
          binding_id: bindingId,
          stderr: failureMessage,
        })},
        ${completionTime}
      )
      ON CONFLICT (audit_event_id) DO NOTHING
    `;
  });

  await db.end();
  throw new Error(failureMessage);
}

await db.begin(async (tx) => {
  await tx`
    INSERT INTO community_database_bindings (
      community_database_binding_id,
      community_id,
      binding_role,
      organization_slug,
      group_name,
      group_id,
      database_name,
      database_id,
      database_url,
      location,
      status,
      transferred_at,
      created_at,
      updated_at
    ) VALUES (
      ${bindingId},
      ${options.communityId},
      'primary',
      'local-dev',
      ${`club-${options.communityId}`},
      NULL,
      'main',
      NULL,
      ${databaseUrlForBinding},
      'local',
      'active',
      NULL,
      ${createdAt},
      ${completionTime}
    )
    ON CONFLICT (community_database_binding_id) DO UPDATE SET
      community_id = EXCLUDED.community_id,
      database_url = EXCLUDED.database_url,
      location = EXCLUDED.location,
      status = EXCLUDED.status,
      updated_at = EXCLUDED.updated_at
  `;

  await tx`
    UPDATE communities
    SET primary_database_binding_id = ${bindingId},
        provisioning_state = 'active',
        updated_at = ${completionTime}
    WHERE community_id = ${options.communityId}
  `;

  await tx`
    UPDATE jobs
    SET status = 'succeeded',
        error_code = NULL,
        result_ref = ${databaseUrlForBinding},
        updated_at = ${completionTime}
    WHERE job_id = ${jobId}
  `;

  await tx`
    INSERT INTO audit_log (
      audit_event_id,
      actor_type,
      actor_id,
      action,
      target_type,
      target_id,
      community_id,
      metadata_json,
      created_at
    ) VALUES (
      ${successAuditId},
      'system',
      NULL,
      'community.local_stub.bootstrap_succeeded',
      'community',
      ${options.communityId},
      ${options.communityId},
      ${JSON.stringify({
        job_id: jobId,
        binding_id: bindingId,
        community_db_path: communityDbPath,
      })},
      ${completionTime}
    )
    ON CONFLICT (audit_event_id) DO NOTHING
  `;
});

await db.end();

const stdout = new TextDecoder().decode(bootstrap.stdout).trim();

console.log(`community bootstrap complete
env: ${options.databaseUrlEnv}
community_id: ${options.communityId}
job_id: ${jobId}
binding_id: ${bindingId}
registry_attempt_id: none
community_db: ${communityDbPath}
bootstrap_output:
${stdout}`);
