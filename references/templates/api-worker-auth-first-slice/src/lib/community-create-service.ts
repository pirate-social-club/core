import type { CommunityCreateAcceptedResponse } from "../types/api";
import type { Env } from "../types/env";
import { PROVIDER_MATRIX } from "../../../../../specs/api/scripts/provider-matrix";
import type { AuthBootstrapStore } from "./db";
import { createId } from "./ids";
import { internalError, notFoundError } from "./errors";
import { RegistryPublisherClient, RegistryPublisherError } from "./registry-publisher-client";
import { serializeCommunity } from "./community-serializer";
import { eligibilityFailed } from "./errors";
import { serializeJob } from "./job-serializer";
import { verifyPirateAccessToken } from "./pirate-session-jwt";
import { nowIso } from "./time";
import { serializeVerificationCapabilities } from "./verification-serializer";

export type CreateCommunityRequestBody = {
  display_name?: string;
  description?: string | null;
  membership_mode?: "open" | "request" | "gated";
  allow_anonymous_identity?: boolean;
  anonymous_identity_scope?: "community_stable" | "thread_stable" | "post_ephemeral" | null;
  governance_mode?: "centralized" | "multisig" | "majeur";
  default_age_gate_policy?: "none" | "18_plus";
  namespace?: {
    namespace_verification_id?: string;
  };
  handle_policy?: {
    policy_template?: "standard" | "premium" | "membership_gated" | "custom";
  };
  donation_policy?: unknown;
  money_policy?: unknown;
  community_bootstrap?: unknown;
  gate_rules?: Array<{
    scope?: "membership" | "viewer" | "posting";
    gate_family?: "token_holding" | "identity_proof";
    gate_type?: keyof typeof PROVIDER_MATRIX;
    proof_requirements?: Array<{
      proof_type?: keyof typeof PROVIDER_MATRIX;
      accepted_providers?: string[] | null;
    }> | null;
  }> | null;
};

function assertProofRequirementMatrix(body: CreateCommunityRequestBody) {
  for (const rule of body.gate_rules ?? []) {
    for (const requirement of rule.proof_requirements ?? []) {
      const proofType = requirement.proof_type;
      if (!proofType || !(proofType in PROVIDER_MATRIX)) {
        throw eligibilityFailed("Unsupported proof_type in gate proof requirements");
      }

      const acceptedProviders = requirement.accepted_providers ?? [];
      const allowedProviders = PROVIDER_MATRIX[proofType];
      if (acceptedProviders.some((provider) => !allowedProviders.includes(provider as never))) {
        throw eligibilityFailed(`Invalid accepted_providers for proof_type ${proofType}`);
      }
    }
  }
}

function assertCreateRequest(body: CreateCommunityRequestBody, uniqueHumanVerified: boolean, ageOver18Verified: boolean) {
  if (!body.display_name || !body.namespace?.namespace_verification_id) {
    throw eligibilityFailed("Missing required community create fields");
  }

  if (!uniqueHumanVerified) {
    throw eligibilityFailed("unique_human verification is required");
  }

  if (body.governance_mode !== "centralized") {
    throw eligibilityFailed("Only centralized community creation is allowed in public v0");
  }

  if (body.membership_mode !== "open" && body.membership_mode !== "gated") {
    throw eligibilityFailed("Public v0 community creation only allows open or gated membership");
  }

  if (body.handle_policy?.policy_template !== "standard") {
    throw eligibilityFailed("Public v0 community creation requires the standard handle policy");
  }

  if (body.anonymous_identity_scope === "post_ephemeral") {
    throw eligibilityFailed("post_ephemeral anonymous scope is not allowed in public v0 community creation");
  }

  if (body.default_age_gate_policy === "18_plus" && !ageOver18Verified) {
    throw eligibilityFailed("age_over_18 verification is required for 18_plus communities");
  }

  if (body.donation_policy != null || body.money_policy != null || body.community_bootstrap != null) {
    throw eligibilityFailed("Public v0 community creation does not accept donation, money-policy, or bootstrap payloads");
  }

  if (body.gate_rules?.some((rule) => rule.gate_family === "token_holding" || rule.scope === "viewer" || rule.scope === "posting")) {
    throw eligibilityFailed("Public v0 community creation only allows membership-scope identity-proof gates");
  }

  assertProofRequirementMatrix(body);
}

export async function createCommunity(input: {
  requestBody: CreateCommunityRequestBody;
  bearerToken: string;
  env: Env;
  store: AuthBootstrapStore;
  now?: Date;
}): Promise<CommunityCreateAcceptedResponse> {
  const now = input.now ?? new Date();
  const session = await verifyPirateAccessToken(input.bearerToken, input.env);
  const userRow = await input.store.getUser(session.userId);
  if (!userRow) {
    throw notFoundError("Authenticated user not found");
  }

  const capabilities = serializeVerificationCapabilities(userRow.verification_capabilities_json);
  const uniqueHumanVerified = capabilities.unique_human.state === "verified";
  const ageOver18Verified = capabilities.age_over_18.state === "verified";

  assertCreateRequest(input.requestBody, uniqueHumanVerified, ageOver18Verified);

  const namespaceVerificationId = input.requestBody.namespace?.namespace_verification_id as string;
  const namespaceVerification = await input.store.getNamespaceVerificationById(namespaceVerificationId);
  if (!namespaceVerification) {
    throw notFoundError("Namespace verification not found");
  }

  if (namespaceVerification.user_id !== userRow.user_id) {
    throw eligibilityFailed("Namespace verification does not belong to the requesting user");
  }

  if (Date.parse(namespaceVerification.expires_at) <= now.getTime()) {
    throw eligibilityFailed("Namespace verification has expired");
  }

  if (namespaceVerification.status !== "verified" || namespaceVerification.club_attach_allowed !== 1) {
    throw eligibilityFailed("Namespace verification is not currently attachable");
  }

  const existingCommunity = await input.store.findCommunityByNamespaceVerificationId(namespaceVerificationId);
  if (existingCommunity) {
    const existingJob = await input.store.findLatestJobBySubject("community", existingCommunity.community_id);
    if (!existingJob) {
      throw notFoundError("Existing community provisioning job not found");
    }

    return {
      community: serializeCommunity(existingCommunity),
      job: serializeJob(existingJob),
    };
  }

  const createdAt = nowIso(now);
  const communityId = createId("cmt");
  const jobId = createId("job");
  const publisher = new RegistryPublisherClient(input.env);
  const primaryWallet = await input.store.getPrimaryWalletAttachmentForUser(userRow.user_id);

  let attempt;
  try {
    attempt = await publisher.createCommunityAttempt({
      actor_user_id: userRow.user_id,
      actor_primary_wallet_snapshot: primaryWallet?.wallet_address_display ?? null,
      actor_governance_address_snapshot: null,
      namespace_verification_id: namespaceVerificationId,
      normalized_root_label: namespaceVerification.normalized_root_label,
      created_at: createdAt,
    });
  } catch (error) {
    if (error instanceof RegistryPublisherError) {
      throw internalError(`Registry publisher error: ${error.errorCode}`);
    }
    throw error;
  }

  const created = await input.store.withTransaction(async (tx) => {
    await tx.insertCommunity({
      community_id: communityId,
      creator_user_id: userRow.user_id,
      display_name: input.requestBody.display_name as string,
      membership_mode: input.requestBody.membership_mode as "open" | "gated",
      status: "active",
      provisioning_state: "requested",
      transfer_state: "none",
      registry_publication_state: "pending_create",
      registry_attempt_id: attempt.registry_attempt_id,
      route_slug: null,
      namespace_verification_id: namespaceVerificationId,
      primary_database_binding_id: null,
      created_at: createdAt,
      updated_at: createdAt,
    });

    await tx.insertCommunityRegistryAttempt({
      registry_attempt_id: attempt.registry_attempt_id,
      actor_user_id: userRow.user_id,
      actor_primary_wallet_snapshot: primaryWallet?.wallet_address_display ?? null,
      actor_governance_address_snapshot: null,
      namespace_verification_id: namespaceVerificationId,
      normalized_root_label: namespaceVerification.normalized_root_label,
      community_id: communityId,
      attempt_status: "in_progress",
      failure_code: null,
      created_at: createdAt,
      updated_at: createdAt,
    });

    await tx.upsertCommunityRegistryTableRef({
      community_id: communityId,
      tableland_chain_id: 84532,
      attempts_table_name: attempt.attempts_table,
      club_registry_table_name: null,
      club_namespace_table_name: null,
      publisher_kind: "direct_key",
      last_published_snapshot_hash: null,
      last_publish_attempted_at: createdAt,
      last_publish_succeeded_at: null,
      created_at: createdAt,
      updated_at: createdAt,
    });

    await tx.insertJob({
      job_id: jobId,
      job_type: "community_provisioning",
      job_scope: "platform",
      community_id: communityId,
      subject_type: "community",
      subject_id: communityId,
      status: "queued",
      payload_json: JSON.stringify({
        namespace_verification_id: namespaceVerificationId,
        mode: "phase1_runner",
        registry_attempt_id: attempt.registry_attempt_id,
        description: input.requestBody.description ?? null,
        membership_mode: input.requestBody.membership_mode,
        default_age_gate_policy: input.requestBody.default_age_gate_policy ?? "none",
        handle_policy_template: input.requestBody.handle_policy?.policy_template ?? "standard",
      }),
      result_ref: attempt.result_ref,
      error_code: null,
      attempt_count: 0,
      available_at: createdAt,
      created_at: createdAt,
      updated_at: createdAt,
    });

    await tx.insertAuditLog({
      audit_event_id: createId("audit"),
      actor_type: "user",
      actor_id: userRow.user_id,
      action: "community.create_requested",
      target_type: "community",
      target_id: communityId,
      community_id: communityId,
      metadata_json: JSON.stringify({
        namespace_verification_id: namespaceVerificationId,
        registry_attempt_id: attempt.registry_attempt_id,
      }),
      created_at: createdAt,
    });

    const communityRow = await tx.getCommunityById(communityId);
    const jobRow = await tx.getJobById(jobId);
    if (!communityRow || !jobRow) {
      throw notFoundError("Failed to load newly created community resources");
    }

    return {
      communityRow,
      jobRow,
    };
  });

  return {
    community: serializeCommunity(created.communityRow),
    job: serializeJob(created.jobRow),
  };
}
