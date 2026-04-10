import type { AuthBootstrapStore } from "./db";
import type { CommunityMembershipRequestRow } from "../types/db";
import { loadCommunityMembershipBoundary } from "./community-membership-boundary";
import { conflictError, eligibilityFailed, notFoundError } from "./errors";
import { createId } from "./ids";
import { nowIso } from "./time";

type CommunityMembershipRequestResponse = {
  membership_request_id: string;
  community_id: string;
  applicant_user_id: string;
  status: CommunityMembershipRequestRow["status"];
  note: string | null;
  reviewed_by_user_id: string | null;
  review_reason: string | null;
  resolved_at: string | null;
  expires_at: string | null;
  created_at: string;
  updated_at: string;
};

type ReviewDecision = "approve" | "reject";

function serializeMembershipRequest(row: CommunityMembershipRequestRow): CommunityMembershipRequestResponse {
  return {
    membership_request_id: row.membership_request_id,
    community_id: row.community_id,
    applicant_user_id: row.applicant_user_id,
    status: row.status,
    note: row.note,
    reviewed_by_user_id: row.reviewed_by_user_id,
    review_reason: row.review_reason,
    resolved_at: row.resolved_at,
    expires_at: row.expires_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function assertStubCommunityOwner(creatorUserId: string, actorUserId: string): void {
  if (creatorUserId !== actorUserId) {
    throw eligibilityFailed("Only the community creator can moderate membership requests in this stub");
  }
}

export async function listPendingCommunityMembershipRequests(input: {
  communityId: string;
  actorUserId: string;
  store: AuthBootstrapStore;
}): Promise<CommunityMembershipRequestResponse[]> {
  const community = await input.store.getCommunityById(input.communityId);
  if (!community) {
    throw notFoundError("Community not found");
  }

  assertStubCommunityOwner(community.creator_user_id, input.actorUserId);
  const membershipBoundary = await loadCommunityMembershipBoundary(input.store, input.communityId);
  const rows = membershipBoundary
    ? await membershipBoundary.listPendingRequests(input.communityId)
    : await input.store.listPendingCommunityMembershipRequests(input.communityId);
  return rows.map(serializeMembershipRequest);
}

export async function reviewCommunityMembershipRequest(input: {
  communityId: string;
  membershipRequestId: string;
  actorUserId: string;
  decision: ReviewDecision;
  reviewReason?: string | null;
  store: AuthBootstrapStore;
  now?: Date;
}): Promise<CommunityMembershipRequestResponse> {
  const community = await input.store.getCommunityById(input.communityId);
  if (!community) {
    throw notFoundError("Community not found");
  }

  assertStubCommunityOwner(community.creator_user_id, input.actorUserId);
  const membershipBoundary = await loadCommunityMembershipBoundary(input.store, input.communityId);
  const request = membershipBoundary
    ? await membershipBoundary.getRequestById(input.membershipRequestId)
    : await input.store.getCommunityMembershipRequestById(input.membershipRequestId);
  if (!request || request.community_id !== input.communityId) {
    throw notFoundError("Membership request not found");
  }

  if (request.status !== "pending") {
    throw conflictError("Membership request is no longer pending");
  }

  const timestamp = nowIso(input.now ?? new Date());
  const nextStatus: CommunityMembershipRequestRow["status"] =
    input.decision === "approve" ? "approved" : "rejected";

  if (membershipBoundary) {
    await membershipBoundary.withTransaction(async (communityTx) => {
      const canonicalRequest = await communityTx.getRequestById(request.membership_request_id);
      if (!canonicalRequest || canonicalRequest.status !== "pending") {
        throw conflictError("Membership request is no longer pending");
      }

      if (input.decision === "approve") {
        const bannedMembership = await communityTx.getActiveBan(
          canonicalRequest.community_id,
          canonicalRequest.applicant_user_id,
        );
        if (bannedMembership) {
          throw conflictError("Membership is blocked for this community");
        }

        await communityTx.ensureActiveMember({
          communityId: canonicalRequest.community_id,
          userId: canonicalRequest.applicant_user_id,
          timestamp,
        });
      }

      await communityTx.updateRequestDecision({
        membershipRequestId: canonicalRequest.membership_request_id,
        status: nextStatus,
        reviewedByUserId: input.actorUserId,
        reviewReason: input.reviewReason ?? null,
        resolvedAt: timestamp,
        updatedAt: timestamp,
      });
    });
  }

  const updated = await input.store.withTransaction(async (tx) => {
    if (input.decision === "approve") {
      const existingProjection = await tx.getCommunityMembershipProjection(
        request.community_id,
        request.applicant_user_id,
      );
      if (existingProjection?.membership_state === "banned") {
        throw conflictError("Membership is blocked for this community");
      }

      await tx.upsertCommunityMembershipProjection({
        projection_id: existingProjection?.projection_id ?? createId("cmp"),
        community_id: request.community_id,
        user_id: request.applicant_user_id,
        membership_state: "member",
        role_summary_json: existingProjection?.role_summary_json ?? null,
        source_updated_at: timestamp,
        created_at: existingProjection?.created_at ?? timestamp,
        updated_at: timestamp,
      });
    } else {
      const existingProjection = await tx.getCommunityMembershipProjection(
        request.community_id,
        request.applicant_user_id,
      );
      if (existingProjection?.membership_state === "pending_request") {
        await tx.upsertCommunityMembershipProjection({
          projection_id: existingProjection.projection_id,
          community_id: request.community_id,
          user_id: request.applicant_user_id,
          membership_state: "not_member",
          role_summary_json: existingProjection.role_summary_json,
          source_updated_at: timestamp,
          created_at: existingProjection.created_at,
          updated_at: timestamp,
        });
      }
    }

    if (!membershipBoundary) {
      await tx.updateCommunityMembershipRequest({
        membership_request_id: request.membership_request_id,
        status: nextStatus,
        reviewed_by_user_id: input.actorUserId,
        review_reason: input.reviewReason ?? null,
        resolved_at: timestamp,
        updated_at: timestamp,
      });
    }

    await tx.insertAuditLog({
      audit_event_id: createId("audit"),
      actor_type: "user",
      actor_id: input.actorUserId,
      action:
        input.decision === "approve"
          ? "community.membership_request_approved"
          : "community.membership_request_rejected",
      target_type: "community_membership_request",
      target_id: request.membership_request_id,
      community_id: request.community_id,
      metadata_json: JSON.stringify({
        applicant_user_id: request.applicant_user_id,
      }),
      created_at: timestamp,
    });

    return membershipBoundary
      ? membershipBoundary.getRequestById(request.membership_request_id)
      : tx.getCommunityMembershipRequestById(request.membership_request_id);
  });

  if (!updated) {
    throw new Error("Updated membership request could not be loaded");
  }

  return serializeMembershipRequest(updated);
}
