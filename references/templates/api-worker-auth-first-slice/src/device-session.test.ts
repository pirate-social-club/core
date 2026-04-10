import { beforeEach, describe, expect, test } from "bun:test";
import { generateKeyPairSync } from "node:crypto";
import { createFetchHandler } from "./runtime";
import { signPirateAccessToken } from "./lib/pirate-session-jwt";
import { buildDefaultVerificationCapabilitiesJson } from "./lib/verification-serializer";
import type {
  AuthBootstrapStore,
  AuthBootstrapTx,
  InsertAuditLogInput,
  InsertAuthProviderLinkInput,
  InsertCommunityInput,
  InsertCommunityDatabaseBindingInput,
  InsertCommunityPostProjectionInput,
  InsertCommunityRegistryAttemptInput,
  InsertDeviceSessionInput,
  InsertExternalReputationSnapshotInput,
  InsertGlobalHandleInput,
  InsertJobInput,
  InsertNamespaceVerificationInput,
  InsertNamespaceVerificationSessionInput,
  InsertProfileInput,
  InsertRedditVerificationSessionInput,
  InsertUserInput,
  InsertVerificationSessionInput,
  UpsertUserAudienceSegmentInput,
  UpsertUserInterestTagInput,
  UpsertUserRedditFeatureProfileInput,
  UpsertUserRedditSubredditAffinityInput,
  InsertWalletAttachmentInput,
  UpdateCommunityRegistryAttemptInput,
  UpdateCommunityRegistryStateInput,
  UpdateProfileInput,
  UpdateJobStatusInput,
  UpdateUserPrimaryWalletAttachmentInput,
  UpdateUserVerificationInput,
  UpsertCommunityRegistryTableRefInput,
  UpsertCommunityMoneyPolicyInput,
} from "./lib/db";
import type { Env } from "./types/env";
import type {
  AuthProviderLinkRow,
  CommunityDatabaseBindingRow,
  CommunityMoneyPolicyRow,
  CommunityRegistryAttemptRow,
  CommunityRegistryTableRefRow,
  CommunityRow,
  DeviceSessionRow,
  ExternalReputationSnapshotRow,
  GlobalHandleRow,
  JobRow,
  NamespaceVerificationRow,
  NamespaceVerificationSessionRow,
  ProfileRow,
  RedditVerificationSessionRow,
  UserAudienceSegmentRow,
  UserInterestTagRow,
  UserRedditSubredditAffinityRow,
  UserRow,
  VerificationSessionRow,
  WalletAttachmentRow,
} from "./types/db";

class InMemoryStore {
  users = new Map<string, UserRow>();
  profiles = new Map<string, ProfileRow>();
  globalHandles = new Map<string, GlobalHandleRow>();
  walletAttachments = new Map<string, WalletAttachmentRow>();
  deviceSessionsById = new Map<string, DeviceSessionRow>();
  deviceSessionIdByCode = new Map<string, string>();

  withTransaction<T>(fn: (tx: AuthBootstrapTx) => Promise<T>): Promise<T> {
    return fn(this as unknown as AuthBootstrapTx);
  }

  findActiveAuthProviderLink(_provider: string, _providerSubject: string): Promise<AuthProviderLinkRow | null> {
    return Promise.resolve(null);
  }

  getUser(userId: string): Promise<UserRow | null> {
    return Promise.resolve(this.users.get(userId) ?? null);
  }

  getProfileByUserId(userId: string): Promise<ProfileRow | null> {
    return Promise.resolve(this.profiles.get(userId) ?? null);
  }

  getGlobalHandleById(globalHandleId: string): Promise<GlobalHandleRow | null> {
    return Promise.resolve(this.globalHandles.get(globalHandleId) ?? null);
  }

  listActiveWalletAttachments(_userId: string): Promise<WalletAttachmentRow[]> {
    return Promise.resolve(
      Array.from(this.walletAttachments.values())
        .filter((row) => row.user_id === _userId && row.status === "active")
        .sort((left, right) => right.is_primary - left.is_primary),
    );
  }

  getVerificationSessionById(_verificationSessionId: string): Promise<VerificationSessionRow | null> {
    return Promise.resolve(null);
  }

  getLatestVerificationSessionForUser(_userId: string): Promise<VerificationSessionRow | null> {
    return Promise.resolve(null);
  }

  getDeviceSessionById(deviceSessionId: string): Promise<DeviceSessionRow | null> {
    return Promise.resolve(this.deviceSessionsById.get(deviceSessionId) ?? null);
  }

  getDeviceSessionByDeviceCode(deviceCode: string): Promise<DeviceSessionRow | null> {
    const sessionId = this.deviceSessionIdByCode.get(deviceCode);
    return Promise.resolve(sessionId ? this.deviceSessionsById.get(sessionId) ?? null : null);
  }

  getLatestRedditVerificationSessionForUser(_userId: string): Promise<RedditVerificationSessionRow | null> {
    return Promise.resolve(null);
  }

  getLatestRedditVerificationSessionForUserAndUsername(
    _userId: string,
    _redditUsername: string,
  ): Promise<RedditVerificationSessionRow | null> {
    return Promise.resolve(null);
  }

  getLatestExternalReputationSnapshotForUser(_userId: string): Promise<ExternalReputationSnapshotRow | null> {
    return Promise.resolve(null);
  }

  getExternalReputationSnapshotById(_snapshotId: string): Promise<ExternalReputationSnapshotRow | null> {
    return Promise.resolve(null);
  }

  getLatestExternalReputationSnapshotForUserAndHandle(
    _userId: string,
    _sourceAccountHandle: string,
  ): Promise<ExternalReputationSnapshotRow | null> {
    return Promise.resolve(null);
  }

  listUserRedditSubredditAffinitiesForSnapshot(_snapshotId: string): Promise<UserRedditSubredditAffinityRow[]> {
    return Promise.resolve([]);
  }

  listUserInterestTagsForSnapshot(_snapshotId: string): Promise<UserInterestTagRow[]> {
    return Promise.resolve([]);
  }

  listUserAudienceSegmentsForSnapshot(_snapshotId: string): Promise<UserAudienceSegmentRow[]> {
    return Promise.resolve([]);
  }

  getNamespaceVerificationSessionById(
    _namespaceVerificationSessionId: string,
  ): Promise<NamespaceVerificationSessionRow | null> {
    return Promise.resolve(null);
  }

  getLatestNamespaceVerificationSessionForUser(_userId: string): Promise<NamespaceVerificationSessionRow | null> {
    return Promise.resolve(null);
  }

  getLatestNamespaceVerificationForUser(_userId: string): Promise<NamespaceVerificationRow | null> {
    return Promise.resolve(null);
  }

  getPrimaryWalletAttachmentForUser(_userId: string): Promise<WalletAttachmentRow | null> {
    return Promise.resolve(null);
  }

  getNamespaceVerificationById(_namespaceVerificationId: string): Promise<NamespaceVerificationRow | null> {
    return Promise.resolve(null);
  }

  getCommunityRegistryAttemptById(_registryAttemptId: string): Promise<CommunityRegistryAttemptRow | null> {
    return Promise.resolve(null);
  }

  getCommunityRegistryTableRefByCommunityId(_communityId: string): Promise<CommunityRegistryTableRefRow | null> {
    return Promise.resolve(null);
  }

  getActiveCommunityDatabaseBinding(_communityId: string): Promise<CommunityDatabaseBindingRow | null> {
    return Promise.resolve(null);
  }

  findCommunityByNamespaceVerificationId(_namespaceVerificationId: string): Promise<CommunityRow | null> {
    return Promise.resolve(null);
  }

  getCommunityById(_communityId: string): Promise<CommunityRow | null> {
    return Promise.resolve(null);
  }

  listActiveCommunityGateRules(_communityId: string, _scope: "membership" | "viewer" | "posting"): Promise<[]> {
    return Promise.resolve([]);
  }

  getCommunityMembershipProjection(_communityId: string, _userId: string): Promise<null> {
    return Promise.resolve(null);
  }

  getCommunityMoneyPolicyByCommunityId(_communityId: string): Promise<CommunityMoneyPolicyRow | null> {
    return Promise.resolve(null);
  }

  getJobById(_jobId: string): Promise<JobRow | null> {
    return Promise.resolve(null);
  }

  findLatestJobBySubject(_subjectType: string, _subjectId: string): Promise<JobRow | null> {
    return Promise.resolve(null);
  }

  getLatestJobByTypeAndSubject(_jobType: JobRow["job_type"], _subjectType: string, _subjectId: string): Promise<JobRow | null> {
    return Promise.resolve(null);
  }

  claimNextRunnableJob(_jobType: JobRow["job_type"], _nowIso: string): Promise<JobRow | null> {
    return Promise.resolve(null);
  }

  resetRunningJobs(_jobType: JobRow["job_type"], _updatedBeforeIso: string, _resetAtIso: string): Promise<number> {
    return Promise.resolve(0);
  }

  listCommunitiesRequiringRegistryAttention(): Promise<CommunityRow[]> {
    return Promise.resolve([]);
  }

  insertUser(input: InsertUserInput): Promise<void> {
    this.users.set(input.user_id, {
      user_id: input.user_id,
      primary_wallet_attachment_id: null,
      verification_state: "unverified",
      capability_provider: null,
      verification_capabilities_json: input.verification_capabilities_json,
      verified_at: null,
      nationality: null,
      current_verification_session_id: null,
      created_at: input.created_at,
      updated_at: input.updated_at,
    });
    return Promise.resolve();
  }

  updateUserVerification(input: UpdateUserVerificationInput): Promise<void> {
    const existing = this.users.get(input.user_id);
    if (!existing) {
      throw new Error("missing user");
    }
    this.users.set(input.user_id, {
      ...existing,
      verification_state: input.verification_state,
      capability_provider: input.capability_provider,
      verification_capabilities_json: input.verification_capabilities_json,
      verified_at: input.verified_at,
      nationality: input.nationality,
      current_verification_session_id: input.current_verification_session_id,
      updated_at: input.updated_at,
    });
    return Promise.resolve();
  }

  insertGlobalHandle(input: InsertGlobalHandleInput): Promise<void> {
    this.globalHandles.set(input.global_handle_id, {
      global_handle_id: input.global_handle_id,
      user_id: input.user_id,
      label_normalized: input.label_normalized,
      label_display: input.label_display,
      status: "active",
      tier: "generated",
      issuance_source: "generated_signup",
      redirect_target_global_handle_id: null,
      price_paid_usd: null,
      free_rename_consumed: 0,
      issued_at: input.issued_at,
      replaced_at: null,
      created_at: input.created_at,
      updated_at: input.updated_at,
    });
    return Promise.resolve();
  }

  insertProfile(input: InsertProfileInput): Promise<void> {
    this.profiles.set(input.user_id, {
      user_id: input.user_id,
      display_name: null,
      bio: null,
      avatar_ref: null,
      cover_ref: null,
      global_handle_id: input.global_handle_id,
      created_at: input.created_at,
      updated_at: input.updated_at,
    });
    return Promise.resolve();
  }

  updateProfile(input: UpdateProfileInput): Promise<void> {
    const existing = this.profiles.get(input.user_id);
    if (!existing) {
      throw new Error("missing profile");
    }
    this.profiles.set(input.user_id, {
      ...existing,
      display_name: input.display_name,
      bio: input.bio,
      avatar_ref: input.avatar_ref,
      updated_at: input.updated_at,
    });
    return Promise.resolve();
  }

  insertDeviceSession(input: InsertDeviceSessionInput): Promise<void> {
    const row: DeviceSessionRow = { ...input };
    this.deviceSessionsById.set(row.device_session_id, row);
    this.deviceSessionIdByCode.set(row.device_code, row.device_session_id);
    return Promise.resolve();
  }

  updateDeviceSession(input: InsertDeviceSessionInput): Promise<void> {
    const row: DeviceSessionRow = { ...input };
    this.deviceSessionsById.set(row.device_session_id, row);
    this.deviceSessionIdByCode.set(row.device_code, row.device_session_id);
    return Promise.resolve();
  }

  insertAuthProviderLink(_input: InsertAuthProviderLinkInput): Promise<void> { return Promise.resolve(); }
  insertWalletAttachment(input: InsertWalletAttachmentInput): Promise<void> {
    this.walletAttachments.set(input.wallet_attachment_id, { ...input });
    return Promise.resolve();
  }
  insertVerificationSession(_input: InsertVerificationSessionInput): Promise<void> { return Promise.resolve(); }
  updateVerificationSession(_input: InsertVerificationSessionInput): Promise<void> { return Promise.resolve(); }
  insertRedditVerificationSession(_input: InsertRedditVerificationSessionInput): Promise<void> { return Promise.resolve(); }
  updateRedditVerificationSession(_input: InsertRedditVerificationSessionInput): Promise<void> { return Promise.resolve(); }
  insertExternalReputationSnapshot(_input: InsertExternalReputationSnapshotInput): Promise<void> { return Promise.resolve(); }
  deleteUserRedditSubredditAffinitiesForSnapshot(_snapshotId: string): Promise<void> { return Promise.resolve(); }
  deleteUserInterestTagsForSnapshot(_snapshotId: string): Promise<void> { return Promise.resolve(); }
  deleteUserAudienceSegmentsForSnapshot(_snapshotId: string): Promise<void> { return Promise.resolve(); }
  deleteUserRedditFeatureProfilesForSnapshot(_snapshotId: string): Promise<void> { return Promise.resolve(); }
  upsertUserRedditSubredditAffinity(_input: UpsertUserRedditSubredditAffinityInput): Promise<void> { return Promise.resolve(); }
  upsertUserInterestTag(_input: UpsertUserInterestTagInput): Promise<void> { return Promise.resolve(); }
  upsertUserAudienceSegment(_input: UpsertUserAudienceSegmentInput): Promise<void> { return Promise.resolve(); }
  upsertUserRedditFeatureProfile(_input: UpsertUserRedditFeatureProfileInput): Promise<void> { return Promise.resolve(); }
  insertNamespaceVerificationSession(_input: InsertNamespaceVerificationSessionInput): Promise<void> { return Promise.resolve(); }
  updateNamespaceVerificationSession(_input: InsertNamespaceVerificationSessionInput): Promise<void> { return Promise.resolve(); }
  insertNamespaceVerification(_input: InsertNamespaceVerificationInput): Promise<void> { return Promise.resolve(); }
  updateUserPrimaryWalletAttachment(input: UpdateUserPrimaryWalletAttachmentInput): Promise<void> {
    const existing = this.users.get(input.user_id);
    if (!existing) {
      throw new Error("missing user");
    }
    this.users.set(input.user_id, {
      ...existing,
      primary_wallet_attachment_id: input.primary_wallet_attachment_id,
      updated_at: input.updated_at,
    });
    return Promise.resolve();
  }
  insertCommunity(_input: InsertCommunityInput): Promise<void> { return Promise.resolve(); }
  insertCommunityRegistryAttempt(_input: InsertCommunityRegistryAttemptInput): Promise<void> { return Promise.resolve(); }
  updateCommunityRegistryAttempt(_input: UpdateCommunityRegistryAttemptInput): Promise<void> { return Promise.resolve(); }
  upsertCommunityRegistryTableRef(_input: UpsertCommunityRegistryTableRefInput): Promise<void> { return Promise.resolve(); }
  updateCommunityRegistryState(_input: UpdateCommunityRegistryStateInput): Promise<void> { return Promise.resolve(); }
  insertCommunityDatabaseBinding(_input: InsertCommunityDatabaseBindingInput): Promise<void> { return Promise.resolve(); }
  upsertCommunityMembershipProjection(_input: {
    projection_id: string;
    community_id: string;
    user_id: string;
    membership_state: "not_member" | "pending_request" | "member" | "banned";
    role_summary_json: string | null;
    source_updated_at: string;
    created_at: string;
    updated_at: string;
  }): Promise<void> { return Promise.resolve(); }
  upsertCommunityMoneyPolicy(_input: UpsertCommunityMoneyPolicyInput): Promise<void> { return Promise.resolve(); }
  insertJob(_input: InsertJobInput): Promise<void> { return Promise.resolve(); }
  updateJobStatus(_input: UpdateJobStatusInput): Promise<void> { return Promise.resolve(); }
  insertCommunityPostProjection(_input: InsertCommunityPostProjectionInput): Promise<void> { return Promise.resolve(); }
  insertAuditLog(_input: InsertAuditLogInput): Promise<void> { return Promise.resolve(); }
}

function createEnv(): Env {
  const keys = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" },
  });

  return {
    CONTROL_PLANE_DATABASE_URL: "postgres://unused",
    AUTH_UPSTREAM_JWT_ISSUER: "pirate-dev-upstream",
    AUTH_UPSTREAM_JWT_AUDIENCE: "pirate-api",
    AUTH_UPSTREAM_JWT_SHARED_SECRET: "dev-upstream-secret",
    PIRATE_APP_JWT_ISSUER: "pirate-dev-local",
    PIRATE_APP_JWT_AUDIENCE: "pirate-app",
    PIRATE_APP_JWT_PRIVATE_KEY: keys.privateKey,
    PIRATE_APP_JWT_PUBLIC_KEY: keys.publicKey,
  };
}

describe("Device session flow", () => {
  let store: InMemoryStore;
  let env: Env;

  beforeEach(() => {
    store = new InMemoryStore();
    env = createEnv();

    const now = new Date().toISOString();
    const userId = "usr_device_demo";
    const globalHandleId = "gh_device_demo";

    store.users.set(userId, {
      user_id: userId,
      primary_wallet_attachment_id: null,
      verification_state: "unverified",
      capability_provider: null,
      verification_capabilities_json: buildDefaultVerificationCapabilitiesJson(),
      verified_at: null,
      nationality: null,
      current_verification_session_id: null,
      created_at: now,
      updated_at: now,
    });
    store.globalHandles.set(globalHandleId, {
      global_handle_id: globalHandleId,
      user_id: userId,
      label_normalized: "device-demo",
      label_display: "device-demo.pirate",
      status: "active",
      tier: "generated",
      issuance_source: "generated_signup",
      redirect_target_global_handle_id: null,
      price_paid_usd: null,
      free_rename_consumed: 0,
      issued_at: now,
      replaced_at: null,
      created_at: now,
      updated_at: now,
    });
    store.profiles.set(userId, {
      user_id: userId,
      display_name: null,
      bio: null,
      avatar_ref: null,
      cover_ref: null,
      global_handle_id: globalHandleId,
      created_at: now,
      updated_at: now,
    });
  });

  async function createDeviceSession(handler: (request: Request) => Promise<Response>, input?: {
    verificationOrigin?: string;
  }) {
    const apiBaseUrl = "http://127.0.0.1:8787";
    const response = await handler(new Request(`${apiBaseUrl}/auth/device-sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        client_name: "pirate-cli",
        verification_origin: input?.verificationOrigin ?? "https://pirate.example",
      }),
    }));
    expect(response.status).toBe(201);
    return await response.json() as {
      device_session_id: string;
      device_code: string;
      user_code: string;
      verification_uri: string;
      status: string;
      expires_at: string;
    };
  }

  test("create -> poll -> authorize -> claim round-trips through the fetch handler", async () => {
    const handler = createFetchHandler({ env, store: store as unknown as AuthBootstrapStore });
    const apiBaseUrl = "http://127.0.0.1:8787";
    const createdJson = await createDeviceSession(handler);

    expect(createdJson.status).toBe("pending");
    expect(createdJson.device_code).toMatch(/^dev_code_[0-9a-f]{64}$/);
    expect(createdJson.verification_uri).toContain("https://pirate.example/auth/device?");
    expect(createdJson.verification_uri).toContain(`device_session_id=${encodeURIComponent(createdJson.device_session_id)}`);
    expect(createdJson.verification_uri).toContain(`user_code=${encodeURIComponent(createdJson.user_code)}`);

    const pending = await handler(new Request(`${apiBaseUrl}/auth/device-sessions/by-device-code/${createdJson.device_code}`));
    expect(pending.status).toBe(200);
    const pendingJson = await pending.json() as { status: string };
    expect(pendingJson.status).toBe("pending");

    const browserToken = await signPirateAccessToken({
      userId: "usr_device_demo",
      env,
      now: new Date(),
    });

    const authorized = await handler(new Request(
      `${apiBaseUrl}/auth/device-sessions/${createdJson.device_session_id}/authorize`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${browserToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ user_code: createdJson.user_code }),
      },
    ));
    expect(authorized.status).toBe(200);

    const afterAuthorize = await handler(new Request(`${apiBaseUrl}/auth/device-sessions/by-device-code/${createdJson.device_code}`));
    expect(afterAuthorize.status).toBe(200);
    const afterAuthorizeJson = await afterAuthorize.json() as { status: string };
    expect(afterAuthorizeJson.status).toBe("authorized");

    const claimed = await handler(new Request(
      `${apiBaseUrl}/auth/device-sessions/by-device-code/${createdJson.device_code}/claim`,
      { method: "POST" },
    ));
    expect(claimed.status).toBe(200);
    const claimedJson = await claimed.json() as {
      status: string;
      session: {
        access_token: string;
        user: { user_id: string };
      };
    };
    expect(claimedJson.status).toBe("completed");
    expect(claimedJson.session.user.user_id).toBe("usr_device_demo");
    expect(claimedJson.session.access_token.length).toBeGreaterThan(0);

    const completed = await handler(new Request(`${apiBaseUrl}/auth/device-sessions/by-device-code/${createdJson.device_code}`));
    expect(completed.status).toBe(200);
    const completedJson = await completed.json() as { status: string };
    expect(completedJson.status).toBe("completed");
  });

  test("double-authorize fails once the session is no longer pending", async () => {
    const handler = createFetchHandler({ env, store: store as unknown as AuthBootstrapStore });
    const apiBaseUrl = "http://127.0.0.1:8787";
    const createdJson = await createDeviceSession(handler);
    const browserToken = await signPirateAccessToken({
      userId: "usr_device_demo",
      env,
      now: new Date(),
    });

    const firstAuthorize = await handler(new Request(
      `${apiBaseUrl}/auth/device-sessions/${createdJson.device_session_id}/authorize`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${browserToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ user_code: createdJson.user_code }),
      },
    ));
    expect(firstAuthorize.status).toBe(200);

    const secondAuthorize = await handler(new Request(
      `${apiBaseUrl}/auth/device-sessions/${createdJson.device_session_id}/authorize`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${browserToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ user_code: createdJson.user_code }),
      },
    ));
    expect(secondAuthorize.status).toBe(409);
  });

  test("authorize rejects the wrong user_code", async () => {
    const handler = createFetchHandler({ env, store: store as unknown as AuthBootstrapStore });
    const apiBaseUrl = "http://127.0.0.1:8787";
    const createdJson = await createDeviceSession(handler);
    const browserToken = await signPirateAccessToken({
      userId: "usr_device_demo",
      env,
      now: new Date(),
    });

    const response = await handler(new Request(
      `${apiBaseUrl}/auth/device-sessions/${createdJson.device_session_id}/authorize`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${browserToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ user_code: "WRONG-CODE" }),
      },
    ));

    expect(response.status).toBe(409);
  });

  test("expired session fails on authorize and claim", async () => {
    const handler = createFetchHandler({ env, store: store as unknown as AuthBootstrapStore });
    const apiBaseUrl = "http://127.0.0.1:8787";
    const createdJson = await createDeviceSession(handler);
    const expired = store.deviceSessionsById.get(createdJson.device_session_id);
    if (!expired) {
      throw new Error("missing device session");
    }
    store.deviceSessionsById.set(createdJson.device_session_id, {
      ...expired,
      expires_at: new Date(Date.now() - 60_000).toISOString(),
    });

    const browserToken = await signPirateAccessToken({
      userId: "usr_device_demo",
      env,
      now: new Date(),
    });

    const authorizeResponse = await handler(new Request(
      `${apiBaseUrl}/auth/device-sessions/${createdJson.device_session_id}/authorize`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${browserToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ user_code: createdJson.user_code }),
      },
    ));
    expect(authorizeResponse.status).toBe(409);

    const claimResponse = await handler(new Request(
      `${apiBaseUrl}/auth/device-sessions/by-device-code/${createdJson.device_code}/claim`,
      { method: "POST" },
    ));
    expect(claimResponse.status).toBe(409);
  });

  test("claim before authorize fails and repeated claim after completion succeeds", async () => {
    const handler = createFetchHandler({ env, store: store as unknown as AuthBootstrapStore });
    const apiBaseUrl = "http://127.0.0.1:8787";
    const createdJson = await createDeviceSession(handler);

    const preAuthorizeClaim = await handler(new Request(
      `${apiBaseUrl}/auth/device-sessions/by-device-code/${createdJson.device_code}/claim`,
      { method: "POST" },
    ));
    expect(preAuthorizeClaim.status).toBe(409);

    const browserToken = await signPirateAccessToken({
      userId: "usr_device_demo",
      env,
      now: new Date(),
    });
    const authorizeResponse = await handler(new Request(
      `${apiBaseUrl}/auth/device-sessions/${createdJson.device_session_id}/authorize`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${browserToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ user_code: createdJson.user_code }),
      },
    ));
    expect(authorizeResponse.status).toBe(200);

    const firstClaim = await handler(new Request(
      `${apiBaseUrl}/auth/device-sessions/by-device-code/${createdJson.device_code}/claim`,
      { method: "POST" },
    ));
    expect(firstClaim.status).toBe(200);
    const firstClaimJson = await firstClaim.json() as {
      status: string;
      session: {
        access_token: string;
        user: { user_id: string };
      };
    };
    expect(firstClaimJson.status).toBe("completed");

    const secondClaim = await handler(new Request(
      `${apiBaseUrl}/auth/device-sessions/by-device-code/${createdJson.device_code}/claim`,
      { method: "POST" },
    ));
    expect(secondClaim.status).toBe(200);
    const secondClaimJson = await secondClaim.json() as {
      status: string;
      session: {
        access_token: string;
        user: { user_id: string };
      };
    };
    expect(secondClaimJson.status).toBe("completed");
    expect(secondClaimJson.session.user.user_id).toBe("usr_device_demo");
    expect(secondClaimJson.session.access_token.length).toBeGreaterThan(0);
  });
});
