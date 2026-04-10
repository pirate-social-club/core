import type { CommunityDatabaseBindingRow } from "../types/db";
import type { AuthBootstrapStore } from "./db";
import { createBunTransactionalSqlExecutor } from "./bun-sql-executor";
import type { SqlExecutor, TransactionalSqlExecutor } from "./sql-auth-bootstrap-store";
import { createId } from "./ids";

type CommunityMembershipRow = {
  membership_id: string;
  community_id: string;
  user_id: string;
  status: "member" | "left" | "banned";
  joined_at: string | null;
  left_at: string | null;
  banned_at: string | null;
  created_at: string;
  updated_at: string;
};

type MembershipRequestRow = {
  membership_request_id: string;
  community_id: string;
  applicant_user_id: string;
  status: "pending" | "approved" | "rejected" | "canceled" | "expired";
  note: string | null;
  reviewed_by_user_id: string | null;
  review_reason: string | null;
  resolved_at: string | null;
  expires_at: string | null;
  created_at: string;
  updated_at: string;
};

export type CommunityMembershipBoundary = {
  getActiveMember(communityId: string, userId: string): Promise<CommunityMembershipRow | null>;
  getActiveBan(communityId: string, userId: string): Promise<CommunityMembershipRow | null>;
  getPendingRequest(communityId: string, applicantUserId: string): Promise<MembershipRequestRow | null>;
  getRequestById(membershipRequestId: string): Promise<MembershipRequestRow | null>;
  listPendingRequests(communityId: string): Promise<MembershipRequestRow[]>;
  withTransaction<T>(fn: (tx: CommunityMembershipBoundaryTx) => Promise<T>): Promise<T>;
};

export type CommunityMembershipBoundaryTx = {
  getActiveMember(communityId: string, userId: string): Promise<CommunityMembershipRow | null>;
  getActiveBan(communityId: string, userId: string): Promise<CommunityMembershipRow | null>;
  getPendingRequest(communityId: string, applicantUserId: string): Promise<MembershipRequestRow | null>;
  getRequestById(membershipRequestId: string): Promise<MembershipRequestRow | null>;
  insertPendingRequest(input: {
    communityId: string;
    applicantUserId: string;
    timestamp: string;
  }): Promise<MembershipRequestRow>;
  ensureActiveMember(input: {
    communityId: string;
    userId: string;
    timestamp: string;
  }): Promise<CommunityMembershipRow>;
  updateRequestDecision(input: {
    membershipRequestId: string;
    status: MembershipRequestRow["status"];
    reviewedByUserId: string | null;
    reviewReason: string | null;
    resolvedAt: string;
    updatedAt: string;
  }): Promise<void>;
};

function isFileDatabaseBinding(binding: CommunityDatabaseBindingRow | null): binding is CommunityDatabaseBindingRow {
  return binding != null && binding.database_url.startsWith("file://");
}

function membershipQueries(db: SqlExecutor): CommunityMembershipBoundaryTx {
  return {
    getActiveMember(communityId, userId) {
      return db.get<CommunityMembershipRow>(
        `SELECT
           membership_id,
           community_id,
           user_id,
           status,
           joined_at,
           left_at,
           banned_at,
           created_at,
           updated_at
         FROM community_memberships
         WHERE community_id = :community_id
           AND user_id = :user_id
           AND status = 'member'
         LIMIT 1`,
        {
          community_id: communityId,
          user_id: userId,
        },
      );
    },
    getActiveBan(communityId, userId) {
      return db.get<CommunityMembershipRow>(
        `SELECT
           membership_id,
           community_id,
           user_id,
           status,
           joined_at,
           left_at,
           banned_at,
           created_at,
           updated_at
         FROM community_memberships
         WHERE community_id = :community_id
           AND user_id = :user_id
           AND status = 'banned'
         ORDER BY updated_at DESC, membership_id DESC
         LIMIT 1`,
        {
          community_id: communityId,
          user_id: userId,
        },
      );
    },
    getPendingRequest(communityId, applicantUserId) {
      return db.get<MembershipRequestRow>(
        `SELECT
           membership_request_id,
           community_id,
           applicant_user_id,
           status,
           note,
           reviewed_by_user_id,
           review_reason,
           resolved_at,
           expires_at,
           created_at,
           updated_at
         FROM membership_requests
         WHERE community_id = :community_id
           AND applicant_user_id = :applicant_user_id
           AND status = 'pending'
         ORDER BY created_at DESC, membership_request_id DESC
         LIMIT 1`,
        {
          community_id: communityId,
          applicant_user_id: applicantUserId,
        },
      );
    },
    getRequestById(membershipRequestId) {
      return db.get<MembershipRequestRow>(
        `SELECT
           membership_request_id,
           community_id,
           applicant_user_id,
           status,
           note,
           reviewed_by_user_id,
           review_reason,
           resolved_at,
           expires_at,
           created_at,
           updated_at
         FROM membership_requests
         WHERE membership_request_id = :membership_request_id`,
        {
          membership_request_id: membershipRequestId,
        },
      );
    },
    async insertPendingRequest(input) {
      const requestId = createId("cmr");
      await db.run(
        `INSERT INTO membership_requests (
           membership_request_id,
           community_id,
           applicant_user_id,
           status,
           note,
           reviewed_by_user_id,
           review_reason,
           resolved_at,
           expires_at,
           created_at,
           updated_at
         ) VALUES (
           :membership_request_id,
           :community_id,
           :applicant_user_id,
           'pending',
           NULL,
           NULL,
           NULL,
           NULL,
           NULL,
           :created_at,
           :updated_at
         )`,
        {
          membership_request_id: requestId,
          community_id: input.communityId,
          applicant_user_id: input.applicantUserId,
          created_at: input.timestamp,
          updated_at: input.timestamp,
        },
      );

      const inserted = await this.getRequestById(requestId);
      if (!inserted) {
        throw new Error("Inserted membership request could not be loaded");
      }

      return inserted;
    },
    async ensureActiveMember(input) {
      const existing = await this.getActiveMember(input.communityId, input.userId);
      if (existing) {
        return existing;
      }

      const membershipId = createId("mbr");
      await db.run(
        `INSERT INTO community_memberships (
           membership_id,
           community_id,
           user_id,
           status,
           joined_at,
           left_at,
           banned_at,
           created_at,
           updated_at
         ) VALUES (
           :membership_id,
           :community_id,
           :user_id,
           'member',
           :joined_at,
           NULL,
           NULL,
           :created_at,
           :updated_at
         )`,
        {
          membership_id: membershipId,
          community_id: input.communityId,
          user_id: input.userId,
          joined_at: input.timestamp,
          created_at: input.timestamp,
          updated_at: input.timestamp,
        },
      );

      const inserted = await this.getActiveMember(input.communityId, input.userId);
      if (!inserted) {
        throw new Error("Inserted community membership could not be loaded");
      }

      return inserted;
    },
    updateRequestDecision(input) {
      return db.run(
        `UPDATE membership_requests
         SET status = :status,
             reviewed_by_user_id = :reviewed_by_user_id,
             review_reason = :review_reason,
             resolved_at = :resolved_at,
             updated_at = :updated_at
         WHERE membership_request_id = :membership_request_id`,
        {
          membership_request_id: input.membershipRequestId,
          status: input.status,
          reviewed_by_user_id: input.reviewedByUserId,
          review_reason: input.reviewReason,
          resolved_at: input.resolvedAt,
          updated_at: input.updatedAt,
        },
      );
    },
  };
}

class SqliteCommunityMembershipBoundary implements CommunityMembershipBoundary {
  constructor(private readonly db: TransactionalSqlExecutor) {}

  getActiveMember(communityId: string, userId: string): Promise<CommunityMembershipRow | null> {
    return membershipQueries(this.db).getActiveMember(communityId, userId);
  }

  getActiveBan(communityId: string, userId: string): Promise<CommunityMembershipRow | null> {
    return membershipQueries(this.db).getActiveBan(communityId, userId);
  }

  getPendingRequest(communityId: string, applicantUserId: string): Promise<MembershipRequestRow | null> {
    return membershipQueries(this.db).getPendingRequest(communityId, applicantUserId);
  }

  getRequestById(membershipRequestId: string): Promise<MembershipRequestRow | null> {
    return membershipQueries(this.db).getRequestById(membershipRequestId);
  }

  listPendingRequests(communityId: string): Promise<MembershipRequestRow[]> {
    return this.db.all<MembershipRequestRow>(
      `SELECT
         membership_request_id,
         community_id,
         applicant_user_id,
         status,
         note,
         reviewed_by_user_id,
         review_reason,
         resolved_at,
         expires_at,
         created_at,
         updated_at
       FROM membership_requests
       WHERE community_id = :community_id
         AND status = 'pending'
       ORDER BY created_at ASC, membership_request_id ASC`,
      {
        community_id: communityId,
      },
    );
  }

  withTransaction<T>(fn: (tx: CommunityMembershipBoundaryTx) => Promise<T>): Promise<T> {
    return this.db.transaction(async (tx) => fn(membershipQueries(tx)));
  }
}

export async function loadCommunityMembershipBoundary(
  store: AuthBootstrapStore,
  communityId: string,
): Promise<CommunityMembershipBoundary | null> {
  const maybeGetBinding = (store as {
    getActiveCommunityDatabaseBinding?: (communityId: string) => Promise<CommunityDatabaseBindingRow | null>;
  }).getActiveCommunityDatabaseBinding;
  if (typeof maybeGetBinding !== "function") {
    return null;
  }

  const binding = await maybeGetBinding.call(store, communityId);
  if (!isFileDatabaseBinding(binding)) {
    return null;
  }

  return new SqliteCommunityMembershipBoundary(createBunTransactionalSqlExecutor(binding.database_url));
}
