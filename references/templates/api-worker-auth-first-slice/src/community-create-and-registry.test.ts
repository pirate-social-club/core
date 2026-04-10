import { describe, expect, test } from "bun:test";
import { generateKeyPairSync } from "node:crypto";
import { createCommunity } from "./lib/community-create-service";
import type {
  AuthBootstrapStore,
  AuthBootstrapTx,
  InsertAuditLogInput,
  InsertCommunityInput,
  InsertCommunityRegistryAttemptInput,
  InsertJobInput,
} from "./lib/db";
import { signPirateAccessToken } from "./lib/pirate-session-jwt";
import type {
  AuthProviderLinkRow,
  CommunityRegistryAttemptRow,
  CommunityRow,
  ExternalReputationSnapshotRow,
  JobRow,
  NamespaceVerificationRow,
  UserRow,
  WalletAttachmentRow,
} from "./types/db";

function createTx(store: FakeStore): AuthBootstrapTx {
  return {
    getUser: store.getUser,
    getProfileByUserId: store.getProfileByUserId,
    getGlobalHandleById: store.getGlobalHandleById,
    listActiveWalletAttachments: store.listActiveWalletAttachments,
    getVerificationSessionById: store.getVerificationSessionById,
    getLatestVerificationSessionForUser: store.getLatestVerificationSessionForUser,
    getDeviceSessionById: store.getDeviceSessionById,
    getDeviceSessionByDeviceCode: store.getDeviceSessionByDeviceCode,
    getLatestRedditVerificationSessionForUser: store.getLatestRedditVerificationSessionForUser,
    getLatestRedditVerificationSessionForUserAndUsername:
      store.getLatestRedditVerificationSessionForUserAndUsername,
    getExternalReputationSnapshotById: store.getExternalReputationSnapshotById,
    getLatestExternalReputationSnapshotForUser: store.getLatestExternalReputationSnapshotForUser,
    getLatestExternalReputationSnapshotForUserAndHandle:
      store.getLatestExternalReputationSnapshotForUserAndHandle,
    listUserRedditSubredditAffinitiesForSnapshot: store.listUserRedditSubredditAffinitiesForSnapshot,
    listUserInterestTagsForSnapshot: store.listUserInterestTagsForSnapshot,
    listUserAudienceSegmentsForSnapshot: store.listUserAudienceSegmentsForSnapshot,
    getNamespaceVerificationSessionById: store.getNamespaceVerificationSessionById,
    getLatestNamespaceVerificationSessionForUser: store.getLatestNamespaceVerificationSessionForUser,
    getLatestNamespaceVerificationForUser: store.getLatestNamespaceVerificationForUser,
    getPrimaryWalletAttachmentForUser: store.getPrimaryWalletAttachmentForUser,
    getNamespaceVerificationById: store.getNamespaceVerificationById,
    getCommunityRegistryAttemptById: store.getCommunityRegistryAttemptById,
    getCommunityRegistryTableRefByCommunityId: store.getCommunityRegistryTableRefByCommunityId,
    getActiveCommunityDatabaseBinding: store.getActiveCommunityDatabaseBinding,
    findCommunityByNamespaceVerificationId: store.findCommunityByNamespaceVerificationId,
    getCommunityById: store.getCommunityById,
    listActiveCommunityGateRules: store.listActiveCommunityGateRules,
    getCommunityMembershipProjection: store.getCommunityMembershipProjection,
    getCommunityMoneyPolicyByCommunityId: store.getCommunityMoneyPolicyByCommunityId,
    getJobById: store.getJobById,
    findLatestJobBySubject: store.findLatestJobBySubject,
    getLatestJobByTypeAndSubject: store.getLatestJobByTypeAndSubject,
    claimNextRunnableJob: store.claimNextRunnableJob,
    resetRunningJobs: store.resetRunningJobs,
    findActiveAuthProviderLink: store.findActiveAuthProviderLink,
    insertUser: async () => {},
    updateUserVerification: async () => {},
    insertGlobalHandle: async () => {},
    insertProfile: async () => {},
    updateProfile: async () => {},
    insertDeviceSession: async () => {},
    updateDeviceSession: async () => {},
    insertAuthProviderLink: async () => {},
    insertWalletAttachment: async () => {},
    insertVerificationSession: async () => {},
    updateVerificationSession: async () => {},
    insertRedditVerificationSession: async () => {},
    updateRedditVerificationSession: async () => {},
    insertExternalReputationSnapshot: async () => {},
    deleteUserRedditSubredditAffinitiesForSnapshot: async () => {},
    deleteUserInterestTagsForSnapshot: async () => {},
    deleteUserAudienceSegmentsForSnapshot: async () => {},
    deleteUserRedditFeatureProfilesForSnapshot: async () => {},
    upsertUserRedditSubredditAffinity: async () => {},
    upsertUserInterestTag: async () => {},
    upsertUserAudienceSegment: async () => {},
    upsertUserRedditFeatureProfile: async () => {},
    insertNamespaceVerificationSession: async () => {},
    updateNamespaceVerificationSession: async () => {},
    insertNamespaceVerification: async () => {},
    updateUserPrimaryWalletAttachment: async () => {},
    upsertCommunityMoneyPolicy: async () => {},
    upsertCommunityMembershipProjection: async () => {},
    insertCommunityPostProjection: async () => {},
    updateCommunityRegistryAttempt: async () => {},
    upsertCommunityRegistryTableRef: async () => {},
    updateCommunityRegistryState: async () => {},
    insertCommunityDatabaseBinding: async () => {},
    updateJobStatus: async () => {},
    insertCommunity: async (input: InsertCommunityInput) => {
      store.community = {
        ...input,
        registry_publication_state: input.registry_publication_state ?? "not_started",
        registry_attempt_id: input.registry_attempt_id ?? null,
        registry_published_at: input.registry_published_at ?? null,
        registry_publication_job_id: input.registry_publication_job_id ?? null,
        registry_error_code: input.registry_error_code ?? null,
      };
    },
    insertCommunityRegistryAttempt: async (input: InsertCommunityRegistryAttemptInput) => {
      store.registryAttempt = input as CommunityRegistryAttemptRow;
    },
    insertJob: async (input: InsertJobInput) => {
      store.job = input as JobRow;
    },
    insertAuditLog: async (input: InsertAuditLogInput) => {
      store.audit.push(input);
    },
  } as unknown as AuthBootstrapTx;
}

class FakeStore {
  user: UserRow | null = {
    user_id: "usr_demo_01",
    primary_wallet_attachment_id: "wa_demo_01",
    verification_state: "verified",
    capability_provider: "self",
    verification_capabilities_json: JSON.stringify({
      unique_human: { state: "verified" },
      age_over_18: { state: "verified" },
    }),
    verified_at: "2026-04-10T12:00:00.000Z",
    nationality: null,
    current_verification_session_id: null,
    created_at: "2026-04-10T12:00:00.000Z",
    updated_at: "2026-04-10T12:00:00.000Z",
  };
  wallet: WalletAttachmentRow | null = {
    wallet_attachment_id: "wa_demo_01",
    user_id: "usr_demo_01",
    chain_namespace: "eip155",
    wallet_address_normalized: "0xabc",
    wallet_address_display: "0xAbC",
    source_provider: null,
    source_subject: null,
    attachment_kind: "external",
    is_primary: 1,
    status: "active",
    attached_at: "2026-04-10T12:00:00.000Z",
    detached_at: null,
    created_at: "2026-04-10T12:00:00.000Z",
    updated_at: "2026-04-10T12:00:00.000Z",
  };
  namespaceVerification: NamespaceVerificationRow | null = {
    namespace_verification_id: "nv_demo_01",
    source_namespace_verification_session_id: "nvs_demo_01",
    user_id: "usr_demo_01",
    family: "hns",
    normalized_root_label: "demo",
    status: "verified",
    root_exists: 1,
    root_control_verified: 1,
    expiry_horizon_sufficient: 1,
    routing_enabled: 1,
    pirate_dns_authority_verified: 1,
    club_attach_allowed: 1,
    pirate_web_routing_allowed: 1,
    pirate_subdomain_issuance_allowed: 1,
    control_class: "single_holder_root",
    operation_class: "owner_managed_namespace",
    observation_provider: null,
    evidence_bundle_ref: null,
    accepted_at: "2026-04-10T12:00:00.000Z",
    expires_at: "2027-04-10T12:00:00.000Z",
    created_at: "2026-04-10T12:00:00.000Z",
    updated_at: "2026-04-10T12:00:00.000Z",
  };
  community: CommunityRow | null = null;
  registryAttempt: CommunityRegistryAttemptRow | null = null;
  job: JobRow | null = null;
  audit: InsertAuditLogInput[] = [];

  async withTransaction<T>(fn: (tx: AuthBootstrapTx) => Promise<T>): Promise<T> {
    return fn(createTx(this));
  }

  getUser = async () => this.user;
  findActiveAuthProviderLink = async (): Promise<AuthProviderLinkRow | null> => null;
  getPrimaryWalletAttachmentForUser = async () => this.wallet;
  getNamespaceVerificationById = async () => this.namespaceVerification;
  findCommunityByNamespaceVerificationId = async () => this.community;
  getCommunityById = async () => this.community;
  getJobById = async () => this.job;

  getProfileByUserId = async () => null;
  getGlobalHandleById = async () => null;
  listActiveWalletAttachments = async () => (this.wallet ? [this.wallet] : []);
  getVerificationSessionById = async () => null;
  getLatestVerificationSessionForUser = async () => null;
  getDeviceSessionById = async () => null;
  getDeviceSessionByDeviceCode = async () => null;
  getLatestRedditVerificationSessionForUser = async () => null;
  getLatestRedditVerificationSessionForUserAndUsername = async () => null;
  getExternalReputationSnapshotById = async (): Promise<ExternalReputationSnapshotRow | null> => null;
  getLatestExternalReputationSnapshotForUser = async () => null;
  getLatestExternalReputationSnapshotForUserAndHandle = async (): Promise<ExternalReputationSnapshotRow | null> => null;
  listUserRedditSubredditAffinitiesForSnapshot = async () => [];
  listUserInterestTagsForSnapshot = async () => [];
  listUserAudienceSegmentsForSnapshot = async () => [];
  getNamespaceVerificationSessionById = async () => null;
  getLatestNamespaceVerificationSessionForUser = async () => null;
  getLatestNamespaceVerificationForUser = async () => this.namespaceVerification;
  getCommunityRegistryAttemptById = async () => this.registryAttempt;
  getCommunityRegistryTableRefByCommunityId = async () => null;
  getActiveCommunityDatabaseBinding = async () => null;
  getCommunityMoneyPolicyByCommunityId = async () => null;
  listCommunitiesRequiringRegistryAttention = async () => [];
  listActiveCommunityGateRules = async () => [];
  getCommunityMembershipProjection = async () => null;
  findLatestJobBySubject = async () => this.job;
  getLatestJobByTypeAndSubject = async () => this.job;
  claimNextRunnableJob = async () => null;
  resetRunningJobs = async () => 0;
}

describe("community create registry orchestration", () => {
  test("writes a public registry attempt before queueing provisioning", async () => {
    const store = new FakeStore();
    const originalFetch = globalThis.fetch;
    try {
      globalThis.fetch = ((async () =>
        new Response(
          JSON.stringify({
            ok: true,
            registry_attempt_id: "rga_demo_01",
            attempts_table: "community_create_attempts_current_84532_1",
            result_ref: "tableland://community_create_attempts_current_84532_1/rga_demo_01",
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        )) as unknown) as typeof fetch;
      const { privateKey, publicKey } = generateKeyPairSync("rsa", {
        modulusLength: 2048,
        privateKeyEncoding: { type: "pkcs8", format: "pem" },
        publicKeyEncoding: { type: "spki", format: "pem" },
      });
      const env = {
        CONTROL_PLANE_DATABASE_URL: "unused",
        AUTH_UPSTREAM_JWT_ISSUER: "unused",
        AUTH_UPSTREAM_JWT_AUDIENCE: "unused",
        AUTH_UPSTREAM_JWT_SHARED_SECRET: "unused",
        PIRATE_APP_JWT_ISSUER: "pirate-app",
        PIRATE_APP_JWT_AUDIENCE: "pirate-app",
        PIRATE_APP_JWT_PUBLIC_KEY: publicKey,
        PIRATE_APP_JWT_PRIVATE_KEY: privateKey,
        REGISTRY_PUBLISHER_BASE_URL: "http://publisher.local",
      } as const;
      const issuedNow = new Date();
      const token = await signPirateAccessToken({
        userId: "usr_demo_01",
        env,
        now: issuedNow,
      });

      const response = await createCommunity({
        requestBody: {
          display_name: "Demo Community",
          membership_mode: "open",
          governance_mode: "centralized",
          handle_policy: { policy_template: "standard" },
          namespace: { namespace_verification_id: "nv_demo_01" },
        },
        bearerToken: token,
        env,
        store: store as unknown as AuthBootstrapStore,
        now: issuedNow,
      });

      expect(response.community.registry_publication_state).toBe("pending_create");
      expect(response.community.registry_attempt_id).toBe("rga_demo_01");
      expect(response.job.job_type).toBe("community_provisioning");
      expect(response.job.status).toBe("queued");
      expect(store.registryAttempt?.registry_attempt_id).toBe("rga_demo_01");
      expect(store.audit[0]?.action).toBe("community.create_requested");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("rejects expired namespace verifications before writing community state", async () => {
    const store = new FakeStore();
    store.namespaceVerification = {
      ...(store.namespaceVerification as NamespaceVerificationRow),
      expires_at: "2026-04-09T12:00:00.000Z",
    };

    const keys = generateKeyPairSync("rsa", {
      modulusLength: 2048,
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
      publicKeyEncoding: { type: "spki", format: "pem" },
    });

    const env = {
      CONTROL_PLANE_DATABASE_URL: "unused",
      AUTH_UPSTREAM_JWT_ISSUER: "unused",
      AUTH_UPSTREAM_JWT_AUDIENCE: "unused",
      AUTH_UPSTREAM_JWT_SHARED_SECRET: "unused",
      PIRATE_APP_JWT_ISSUER: "pirate-app",
      PIRATE_APP_JWT_AUDIENCE: "pirate-app",
      PIRATE_APP_JWT_PUBLIC_KEY: keys.publicKey,
      PIRATE_APP_JWT_PRIVATE_KEY: keys.privateKey,
      REGISTRY_PUBLISHER_BASE_URL: "http://publisher.local",
    } as const;
    const issuedNow = new Date();

    const token = await signPirateAccessToken({
      userId: "usr_demo_01",
      env,
      now: issuedNow,
    });

    await expect(createCommunity({
      requestBody: {
        display_name: "Demo Community",
        governance_mode: "centralized",
        membership_mode: "open",
        handle_policy: { policy_template: "standard" },
        namespace: { namespace_verification_id: "nv_demo_01" },
      },
      bearerToken: token,
      env,
      store: store as unknown as AuthBootstrapStore,
      now: issuedNow,
    })).rejects.toMatchObject({
      status: 403,
      body: {
        code: "eligibility_failed",
      },
    });

    expect(store.community).toBeNull();
    expect(store.registryAttempt).toBeNull();
    expect(store.job).toBeNull();
  });
});
