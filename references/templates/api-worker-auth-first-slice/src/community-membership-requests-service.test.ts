import { describe, expect, test } from "bun:test";
import {
  listPendingCommunityMembershipRequests,
  reviewCommunityMembershipRequest,
} from "./lib/community-membership-requests-service";
import type { AuthBootstrapStore, AuthBootstrapTx, InsertAuditLogInput } from "./lib/db";
import type {
  CommunityMembershipProjectionRow,
  CommunityMembershipRequestRow,
  CommunityRow,
} from "./types/db";

function buildCommunity(): CommunityRow {
  return {
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
  };
}

function buildRequest(overrides?: Partial<CommunityMembershipRequestRow>): CommunityMembershipRequestRow {
  return {
    membership_request_id: "cmr_01",
    community_id: "cmt_01",
    applicant_user_id: "usr_applicant",
    status: "pending",
    note: null,
    reviewed_by_user_id: null,
    review_reason: null,
    resolved_at: null,
    expires_at: null,
    created_at: "2026-04-10T00:00:00Z",
    updated_at: "2026-04-10T00:00:00Z",
    ...overrides,
  };
}

function buildStore(input?: {
  request?: CommunityMembershipRequestRow;
  projection?: CommunityMembershipProjectionRow | null;
}) {
  const community = buildCommunity();
  let request = input?.request ?? buildRequest();
  let projection = input?.projection ?? null;
  const audit: InsertAuditLogInput[] = [];

  const tx: Pick<
    AuthBootstrapTx,
    | "getCommunityMembershipProjection"
    | "upsertCommunityMembershipProjection"
    | "updateCommunityMembershipRequest"
    | "getCommunityMembershipRequestById"
    | "insertAuditLog"
  > = {
    async getCommunityMembershipProjection(): Promise<CommunityMembershipProjectionRow | null> {
      return projection;
    },
    async upsertCommunityMembershipProjection(input) {
      projection = {
        projection_id: input.projection_id,
        community_id: input.community_id,
        user_id: input.user_id,
        membership_state: input.membership_state,
        role_summary_json: input.role_summary_json,
        source_updated_at: input.source_updated_at,
        created_at: input.created_at,
        updated_at: input.updated_at,
      };
    },
    async updateCommunityMembershipRequest(input) {
      request = {
        ...request,
        status: input.status,
        reviewed_by_user_id: input.reviewed_by_user_id,
        review_reason: input.review_reason,
        resolved_at: input.resolved_at,
        updated_at: input.updated_at,
      };
    },
    async getCommunityMembershipRequestById(): Promise<CommunityMembershipRequestRow | null> {
      return request;
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
      return communityId === community.community_id ? community : null;
    },
    async listPendingCommunityMembershipRequests(): Promise<CommunityMembershipRequestRow[]> {
      return request.status === "pending" ? [request] : [];
    },
    async getCommunityMembershipRequestById(membershipRequestId: string): Promise<CommunityMembershipRequestRow | null> {
      return membershipRequestId === request.membership_request_id ? request : null;
    },
  } as unknown as AuthBootstrapStore;

  return {
    store,
    readRequest: () => request,
    readProjection: () => projection,
    audit,
  };
}

describe("community membership requests service", () => {
  test("lists pending requests for the community owner", async () => {
    const { store } = buildStore();

    const listed = await listPendingCommunityMembershipRequests({
      communityId: "cmt_01",
      actorUserId: "usr_owner",
      store,
    });

    expect(listed).toEqual([
      expect.objectContaining({
        membership_request_id: "cmr_01",
        applicant_user_id: "usr_applicant",
        status: "pending",
      }),
    ]);
  });

  test("approves a pending request and creates membership", async () => {
    const { store, readRequest, readProjection, audit } = buildStore();

    const reviewed = await reviewCommunityMembershipRequest({
      communityId: "cmt_01",
      membershipRequestId: "cmr_01",
      actorUserId: "usr_owner",
      decision: "approve",
      reviewReason: "looks good",
      store,
      now: new Date("2026-04-11T00:00:00Z"),
    });

    expect(reviewed.status).toBe("approved");
    expect(reviewed.review_reason).toBe("looks good");
    expect(readRequest().status).toBe("approved");
    expect(readProjection()).toMatchObject({
      community_id: "cmt_01",
      user_id: "usr_applicant",
      membership_state: "member",
    });
    expect(audit.some((entry) => entry.action === "community.membership_request_approved")).toBe(true);
  });

  test("rejects a pending request without creating membership", async () => {
    const { store, readRequest, readProjection, audit } = buildStore();

    const reviewed = await reviewCommunityMembershipRequest({
      communityId: "cmt_01",
      membershipRequestId: "cmr_01",
      actorUserId: "usr_owner",
      decision: "reject",
      reviewReason: "not a fit",
      store,
      now: new Date("2026-04-11T00:00:00Z"),
    });

    expect(reviewed.status).toBe("rejected");
    expect(readRequest().status).toBe("rejected");
    expect(readProjection()).toBeNull();
    expect(audit.some((entry) => entry.action === "community.membership_request_rejected")).toBe(true);
  });
});
