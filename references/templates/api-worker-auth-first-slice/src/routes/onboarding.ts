import type { Env } from "../types/env";
import type { AuthBootstrapStore } from "../lib/db";
import { createId } from "../lib/ids";
import { deriveOnboardingStatus } from "../lib/onboarding-deriver";
import { badRequestError, notFoundError, rateLimitedError, verificationRequired } from "../lib/errors";
import { verifyPirateAccessToken } from "../lib/pirate-session-jwt";
import type {
  ErrorShape,
  JobAcceptedResponse,
  OnboardingStatus,
  RedditImportSummary,
  RedditVerification,
} from "../types/api";
import {
  checkRedditProfileForVerificationCode,
  createRedditVerificationCode,
  normalizeRedditUsername,
  serializeRedditImportSummary,
  serializeRedditVerification,
} from "../lib/reddit-onboarding";
import type { JsonResponse, RequestLike } from "./http";
import { ok, requireBearerToken, toErrorResponse } from "./http";

type RedditUsernameRequestBody = {
  reddit_username?: string;
};

async function requireAuthenticatedUser(input: {
  request: RequestLike;
  env: Env;
  store: AuthBootstrapStore;
}) {
  const token = requireBearerToken(input.request);
  const session = await verifyPirateAccessToken(token, input.env);
  const profileRow = await input.store.getProfileByUserId(session.userId);
  if (!profileRow) {
    throw verificationRequired("Profile is missing");
  }
  const userRow = await input.store.getUser(session.userId);
  if (!userRow) {
    throw verificationRequired("User is missing");
  }
  const globalHandleRow = await input.store.getGlobalHandleById(profileRow.global_handle_id);
  if (!globalHandleRow) {
    throw verificationRequired("Global handle is missing");
  }

  return {
    session,
    userRow,
    globalHandleRow,
  };
}

function readRequestedRedditUsername(body: unknown): string {
  const redditUsername = (body as RedditUsernameRequestBody | null)?.reddit_username;
  if (typeof redditUsername !== "string") {
    throw badRequestError("reddit_username is required");
  }

  const normalized = normalizeRedditUsername(redditUsername);
  if (!normalized) {
    throw badRequestError("reddit_username is required");
  }

  return normalized;
}

function parseJobPayloadJson(raw: string | null): { reddit_username?: string } {
  if (!raw) {
    return {};
  }

  try {
    return JSON.parse(raw) as { reddit_username?: string };
  } catch {
    return {};
  }
}

export async function getOnboardingStatus(input: {
  request: RequestLike;
  env: Env;
  store: AuthBootstrapStore;
}): Promise<JsonResponse<OnboardingStatus | ErrorShape>> {
  try {
    const resolved = await requireAuthenticatedUser(input);
    const [
      latestNamespaceVerificationRow,
      latestNamespaceVerificationSessionRow,
      latestRedditVerificationRow,
      latestRedditImportJobRow,
      latestRedditSnapshotRow,
    ] = await Promise.all([
      input.store.getLatestNamespaceVerificationForUser(resolved.session.userId),
      input.store.getLatestNamespaceVerificationSessionForUser(resolved.session.userId),
      input.store.getLatestRedditVerificationSessionForUser(resolved.session.userId),
      input.store.getLatestJobByTypeAndSubject("reddit_snapshot_import", "user", resolved.session.userId),
      input.store.getLatestExternalReputationSnapshotForUser(resolved.session.userId),
    ]);

    return ok(
      deriveOnboardingStatus({
        activeGlobalHandleRow: resolved.globalHandleRow,
        userRow: resolved.userRow,
        latestNamespaceVerificationRow,
        latestNamespaceVerificationSessionRow,
        latestRedditVerificationRow,
        latestRedditImportJobRow,
        latestRedditSnapshotRow,
      }),
    );
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function postRedditVerification(input: {
  request: RequestLike;
  env: Env;
  store: AuthBootstrapStore;
}): Promise<JsonResponse<RedditVerification | ErrorShape>> {
  try {
    const token = requireBearerToken(input.request);
    const session = await verifyPirateAccessToken(token, input.env);
    const body = await input.request.json();
    const redditUsername = readRequestedRedditUsername(body);
    const now = new Date();
    const nowIso = now.toISOString();

    const verification = await input.store.withTransaction(async (tx) => {
      const existing = await tx.getLatestRedditVerificationSessionForUserAndUsername(session.userId, redditUsername);

      if (existing?.status === "verified") {
        return existing;
      }

      if (existing?.status === "pending" && new Date(existing.expires_at).getTime() > now.getTime()) {
        const checkedCount = existing.checked_count + 1;
        const checkResult = await checkRedditProfileForVerificationCode({
          username: redditUsername,
          verificationCode: existing.verification_code,
          profileBaseUrl: input.env.REDDIT_PROFILE_BASE_URL,
          userAgent: input.env.REDDIT_PROFILE_USER_AGENT,
        });
        const failed = checkResult.outcome === "failed" || (checkResult.outcome !== "verified" && checkedCount >= 5);
        const status =
          checkResult.outcome === "verified" ? "verified" : failed ? "failed" : existing.status;
        const failureCode =
          checkResult.outcome === "verified"
            ? null
            : failed && checkResult.outcome !== "failed"
              ? "rate_limited"
              : checkResult.failure_code;
        const verificationHint =
          checkResult.outcome === "verified"
            ? null
            : `Add ${existing.verification_code} to your Reddit profile, then send this request again.`;

        await tx.updateRedditVerificationSession({
          reddit_verification_session_id: existing.reddit_verification_session_id,
          user_id: existing.user_id,
          reddit_username: existing.reddit_username,
          verification_code: existing.verification_code,
          code_placement_surface: existing.code_placement_surface,
          status,
          verification_hint: verificationHint,
          failure_code: failureCode,
          checked_count: checkedCount,
          last_checked_at: nowIso,
          verified_at: checkResult.outcome === "verified" ? nowIso : existing.verified_at,
          expires_at: existing.expires_at,
          created_at: existing.created_at,
          updated_at: nowIso,
        });

        const updated = await tx.getLatestRedditVerificationSessionForUserAndUsername(session.userId, redditUsername);
        if (!updated) {
          throw notFoundError("Failed to reload Reddit verification session");
        }

        return updated;
      }

      const verificationCode = createRedditVerificationCode();
      const expiresAtIso = new Date(now.getTime() + 15 * 60 * 1000).toISOString();
      const verificationSessionId = createId("rvs");

      await tx.insertRedditVerificationSession({
        reddit_verification_session_id: verificationSessionId,
        user_id: session.userId,
        reddit_username: redditUsername,
        verification_code: verificationCode,
        code_placement_surface: "profile",
        status: "pending",
        verification_hint: `Add ${verificationCode} to your Reddit profile, then send this request again.`,
        failure_code: null,
        checked_count: 0,
        last_checked_at: null,
        verified_at: null,
        expires_at: expiresAtIso,
        created_at: nowIso,
        updated_at: nowIso,
      });

      const created = await tx.getLatestRedditVerificationSessionForUserAndUsername(session.userId, redditUsername);
      if (!created) {
        throw notFoundError("Failed to load new Reddit verification session");
      }

      return created;
    });

    if (verification.status === "failed" && verification.failure_code === "rate_limited") {
      throw rateLimitedError("Reddit verification check budget exhausted");
    }

    return ok(serializeRedditVerification(verification));
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function postRedditImport(input: {
  request: RequestLike;
  env: Env;
  store: AuthBootstrapStore;
}): Promise<JsonResponse<JobAcceptedResponse | ErrorShape>> {
  try {
    const token = requireBearerToken(input.request);
    const session = await verifyPirateAccessToken(token, input.env);
    const body = await input.request.json();
    const redditUsername = readRequestedRedditUsername(body);
    const nowIso = new Date().toISOString();

    const job = await input.store.withTransaction(async (tx) => {
      const verification = await tx.getLatestRedditVerificationSessionForUserAndUsername(session.userId, redditUsername);
      if (!verification || verification.status !== "verified") {
        throw verificationRequired("Verify the Reddit username before importing");
      }

      const existingJob = await tx.getLatestJobByTypeAndSubject("reddit_snapshot_import", "user", session.userId);
      if (existingJob) {
        const payload = parseJobPayloadJson(existingJob.payload_json);
        if (payload.reddit_username === redditUsername && existingJob.status !== "failed") {
          return existingJob;
        }
      }

      let snapshot = await tx.getLatestExternalReputationSnapshotForUserAndHandle(session.userId, redditUsername);
      if (snapshot) {
        const existingCompletedJob = await tx.getLatestJobByTypeAndSubject("reddit_snapshot_import", "user", session.userId);
        if (existingCompletedJob) {
          const payload = parseJobPayloadJson(existingCompletedJob.payload_json);
          if (payload.reddit_username === redditUsername && existingCompletedJob.status === "succeeded") {
            return existingCompletedJob;
          }
        }
      }

      const jobId = createId("job");
      await tx.insertJob({
        job_id: jobId,
        job_type: "reddit_snapshot_import",
        job_scope: "platform",
        community_id: null,
        subject_type: "user",
        subject_id: session.userId,
        status: "queued",
        payload_json: JSON.stringify({
          reddit_username: redditUsername,
        }),
        result_ref: snapshot?.external_reputation_snapshot_id ?? null,
        error_code: null,
        attempt_count: 0,
        available_at: nowIso,
        created_at: nowIso,
        updated_at: nowIso,
      });

      const createdJob = await tx.getJobById(jobId);
      if (!createdJob) {
        throw notFoundError("Failed to load Reddit import job");
      }

      return createdJob;
    });

    return {
      status: 202,
      body: {
        job: {
          job_id: job.job_id,
          job_type: job.job_type,
          status: job.status,
          subject_type: job.subject_type,
          subject_id: job.subject_id,
          result_ref: job.result_ref,
          error_code: job.error_code,
          created_at: job.created_at,
          updated_at: job.updated_at,
        },
      },
    };
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function getLatestRedditImport(input: {
  request: RequestLike;
  env: Env;
  store: AuthBootstrapStore;
}): Promise<JsonResponse<RedditImportSummary | ErrorShape>> {
  try {
    const token = requireBearerToken(input.request);
    const session = await verifyPirateAccessToken(token, input.env);
    const snapshot = await input.store.getLatestExternalReputationSnapshotForUser(session.userId);
    if (!snapshot) {
      throw notFoundError("Reddit onboarding snapshot not found");
    }

    return ok(serializeRedditImportSummary(snapshot));
  } catch (error) {
    return toErrorResponse(error);
  }
}
