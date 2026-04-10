import { describe, expect, test } from "bun:test";
import { generateKeyPairSync } from "node:crypto";
import { createFetchHandler } from "./runtime";
import { signPirateAccessToken } from "./lib/pirate-session-jwt";
import type { AuthBootstrapStore, AuthBootstrapTx, InsertAuditLogInput } from "./lib/db";
import type {
  CommunityGateRuleRow,
  CommunityMembershipProjectionRow,
  CommunityMembershipRequestRow,
  CommunityRow,
  UserRow,
  WalletAttachmentRow,
} from "./types/db";

describe("community membership requests runtime", () => {
  test("owner can list and approve a pending membership request", async () => {
    const { privateKey, publicKey } = generateKeyPairSync("rsa", {
      modulusLength: 2048,
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
      publicKeyEncoding: { type: "spki", format: "pem" },
    });

    const communities = new Map<string, CommunityRow>([
      [
        "cmt_01",
        {
          community_id: "cmt_01",
          creator_user_id: "usr_owner",
          display_name: "Collectors",
          membership_mode: "request",
          status: "active",
          provisioning_state: "active",
          transfer_state: "none",
          registry_publication_state: "published",
          registry_attempt_id: null,
          registry_published_at: null,
          registry_publication_job_id: null,
          registry_error_code: null,
          route_slug: null,
          namespace_verification_id: null,
          primary_database_binding_id: null,
          created_at: "2026-04-10T00:00:00Z",
          updated_at: "2026-04-10T00:00:00Z",
        },
      ],
    ]);
    const users = new Map<string, UserRow>([
      [
        "usr_owner",
        {
          user_id: "usr_owner",
          primary_wallet_attachment_id: null,
          verification_state: "verified",
          capability_provider: null,
          verification_capabilities_json: JSON.stringify({
            unique_human: { state: "verified" },
            age_over_18: { state: "unverified" },
            nationality: { state: "unverified", value: null },
            gender: { state: "unverified", value: null },
            sanctions_clear: { state: "unverified" },
            wallet_score: { state: "unverified", passing_score: false, score: null },
          }),
          verified_at: null,
          nationality: null,
          current_verification_session_id: null,
          created_at: "2026-04-10T00:00:00Z",
          updated_at: "2026-04-10T00:00:00Z",
        },
      ],
      [
        "usr_applicant",
        {
          user_id: "usr_applicant",
          primary_wallet_attachment_id: "wal_01",
          verification_state: "verified",
          capability_provider: null,
          verification_capabilities_json: JSON.stringify({
            unique_human: { state: "verified" },
            age_over_18: { state: "unverified" },
            nationality: { state: "unverified", value: null },
            gender: { state: "unverified", value: null },
            sanctions_clear: { state: "unverified" },
            wallet_score: { state: "unverified", passing_score: false, score: null },
          }),
          verified_at: null,
          nationality: null,
          current_verification_session_id: null,
          created_at: "2026-04-10T00:00:00Z",
          updated_at: "2026-04-10T00:00:00Z",
        },
      ],
    ]);
    const wallets = new Map<string, WalletAttachmentRow[]>([
      ["usr_owner", []],
      [
        "usr_applicant",
        [
          {
            wallet_attachment_id: "wal_01",
            user_id: "usr_applicant",
            chain_namespace: "eip155:1",
            wallet_address_normalized: "0x1111111111111111111111111111111111111111",
            wallet_address_display: "0x1111111111111111111111111111111111111111",
            source_provider: "privy",
            source_subject: null,
            attachment_kind: "external",
            is_primary: 1,
            status: "active",
            attached_at: "2026-04-10T00:00:00Z",
            detached_at: null,
            created_at: "2026-04-10T00:00:00Z",
            updated_at: "2026-04-10T00:00:00Z",
          },
        ],
      ],
    ]);
    const gateRules = new Map<string, CommunityGateRuleRow>();
    const projections = new Map<string, CommunityMembershipProjectionRow>();
    const requests = new Map<string, CommunityMembershipRequestRow>();
    const audit: InsertAuditLogInput[] = [];

    const tx: Pick<
      AuthBootstrapTx,
      | "getPendingCommunityMembershipRequest"
      | "insertCommunityMembershipRequest"
      | "getCommunityMembershipRequestById"
      | "updateCommunityMembershipRequest"
      | "listPendingCommunityMembershipRequests"
      | "getCommunityMembershipProjection"
      | "upsertCommunityMembershipProjection"
      | "insertAuditLog"
    > = {
      async getPendingCommunityMembershipRequest(communityId, applicantUserId) {
        return (
          [...requests.values()].find(
            (row) =>
              row.community_id === communityId &&
              row.applicant_user_id === applicantUserId &&
              row.status === "pending",
          ) ?? null
        );
      },
      async insertCommunityMembershipRequest(input) {
        requests.set(input.membership_request_id, {
          membership_request_id: input.membership_request_id,
          community_id: input.community_id,
          applicant_user_id: input.applicant_user_id,
          status: input.status,
          note: input.note,
          reviewed_by_user_id: input.reviewed_by_user_id,
          review_reason: input.review_reason,
          resolved_at: input.resolved_at,
          expires_at: input.expires_at,
          created_at: input.created_at,
          updated_at: input.updated_at,
        });
      },
      async getCommunityMembershipRequestById(membershipRequestId) {
        return requests.get(membershipRequestId) ?? null;
      },
      async updateCommunityMembershipRequest(input) {
        const existing = requests.get(input.membership_request_id);
        if (!existing) {
          return;
        }

        requests.set(input.membership_request_id, {
          ...existing,
          status: input.status,
          reviewed_by_user_id: input.reviewed_by_user_id,
          review_reason: input.review_reason,
          resolved_at: input.resolved_at,
          updated_at: input.updated_at,
        });
      },
      async listPendingCommunityMembershipRequests(communityId) {
        return [...requests.values()].filter((row) => row.community_id === communityId && row.status === "pending");
      },
      async getCommunityMembershipProjection(communityId, userId) {
        return projections.get(`${communityId}:${userId}`) ?? null;
      },
      async upsertCommunityMembershipProjection(input) {
        projections.set(`${input.community_id}:${input.user_id}`, {
          projection_id: input.projection_id,
          community_id: input.community_id,
          user_id: input.user_id,
          membership_state: input.membership_state,
          role_summary_json: input.role_summary_json,
          source_updated_at: input.source_updated_at,
          created_at: input.created_at,
          updated_at: input.updated_at,
        });
      },
      async insertAuditLog(input) {
        audit.push(input);
      },
    };

    const store = {
      async withTransaction<T>(fn: (inner: AuthBootstrapTx) => Promise<T>): Promise<T> {
        return fn(tx as AuthBootstrapTx);
      },
      async getCommunityById(communityId: string): Promise<CommunityRow | null> {
        return communities.get(communityId) ?? null;
      },
      async getUser(userId: string): Promise<UserRow | null> {
        return users.get(userId) ?? null;
      },
      async listActiveWalletAttachments(userId: string): Promise<WalletAttachmentRow[]> {
        return wallets.get(userId) ?? [];
      },
      async listActiveCommunityGateRules(): Promise<CommunityGateRuleRow[]> {
        return [...gateRules.values()];
      },
      async getCommunityMembershipProjection(
        communityId: string,
        userId: string,
      ): Promise<CommunityMembershipProjectionRow | null> {
        return projections.get(`${communityId}:${userId}`) ?? null;
      },
      async getPendingCommunityMembershipRequest(
        communityId: string,
        applicantUserId: string,
      ): Promise<CommunityMembershipRequestRow | null> {
        return (
          [...requests.values()].find(
            (row) =>
              row.community_id === communityId &&
              row.applicant_user_id === applicantUserId &&
              row.status === "pending",
          ) ?? null
        );
      },
      async listPendingCommunityMembershipRequests(communityId: string): Promise<CommunityMembershipRequestRow[]> {
        return [...requests.values()].filter((row) => row.community_id === communityId && row.status === "pending");
      },
      async getCommunityMembershipRequestById(
        membershipRequestId: string,
      ): Promise<CommunityMembershipRequestRow | null> {
        return requests.get(membershipRequestId) ?? null;
      },
    } as unknown as AuthBootstrapStore;

    const env = {
      CONTROL_PLANE_DATABASE_URL: "unused",
      AUTH_UPSTREAM_JWT_ISSUER: "unused",
      AUTH_UPSTREAM_JWT_AUDIENCE: "unused",
      AUTH_UPSTREAM_JWT_SHARED_SECRET: "unused",
      PIRATE_APP_JWT_ISSUER: "pirate-app",
      PIRATE_APP_JWT_AUDIENCE: "pirate-app",
      PIRATE_APP_JWT_PUBLIC_KEY: publicKey,
      PIRATE_APP_JWT_PRIVATE_KEY: privateKey,
    } as const;

    const handler = createFetchHandler({
      env,
      store,
    });

    const applicantToken = await signPirateAccessToken({
      userId: "usr_applicant",
      env,
      now: new Date(),
    });
    const joinResponse = await handler(
      new Request("https://pirate.example/communities/cmt_01/join", {
        method: "POST",
        headers: {
          authorization: `Bearer ${applicantToken}`,
        },
      }),
    );

    expect(joinResponse.status).toBe(200);
    expect(await joinResponse.json()).toEqual({
      community_id: "cmt_01",
      status: "requested",
    });

    const ownerToken = await signPirateAccessToken({
      userId: "usr_owner",
      env,
      now: new Date(),
    });
    const listResponse = await handler(
      new Request("https://pirate.example/communities/cmt_01/membership-requests", {
        method: "GET",
        headers: {
          authorization: `Bearer ${ownerToken}`,
        },
      }),
    );

    expect(listResponse.status).toBe(200);
    const listed = (await listResponse.json()) as Array<{ membership_request_id: string; status: string }>;
    expect(listed).toHaveLength(1);
    expect(listed[0]?.status).toBe("pending");

    const reviewResponse = await handler(
      new Request(
        `https://pirate.example/communities/cmt_01/membership-requests/${listed[0]?.membership_request_id}/review`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${ownerToken}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            decision: "approve",
            review_reason: "approved by owner",
          }),
        },
      ),
    );

    expect(reviewResponse.status).toBe(200);
    expect(await reviewResponse.json()).toEqual(
      expect.objectContaining({
        membership_request_id: listed[0]?.membership_request_id,
        status: "approved",
        review_reason: "approved by owner",
      }),
    );
    expect(projections.get("cmt_01:usr_applicant")?.membership_state).toBe("member");
    expect(audit.some((entry) => entry.action === "community.membership_request_approved")).toBe(true);

    const listAfterApprove = await handler(
      new Request("https://pirate.example/communities/cmt_01/membership-requests", {
        method: "GET",
        headers: {
          authorization: `Bearer ${ownerToken}`,
        },
      }),
    );
    expect(listAfterApprove.status).toBe(200);
    expect(await listAfterApprove.json()).toEqual([]);
  });
});
