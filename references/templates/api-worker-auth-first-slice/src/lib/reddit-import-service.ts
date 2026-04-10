import type { AuthBootstrapStore, AuthBootstrapTx } from "./db";
import { createId } from "./ids";
import {
  buildPullPushRedditSnapshotPayload,
  normalizeRedditUsername,
} from "./reddit-onboarding";
import { nowIso } from "./time";
import type { Env } from "../types/env";

async function enqueueRedditFeatureDerivationJob(input: {
  tx: AuthBootstrapTx;
  userId: string;
  snapshotId: string;
  redditUsername: string;
  createdAt: string;
}): Promise<void> {
  const existingJob = await input.tx.getLatestJobByTypeAndSubject("reddit_feature_derivation", "user", input.userId);
  if (existingJob && existingJob.status !== "failed") {
    const existingPayload = parseJobPayload(existingJob.payload_json);
    if (existingPayload.snapshot_id === input.snapshotId) {
      return;
    }
  }

  await input.tx.insertJob({
    job_id: createId("job"),
    job_type: "reddit_feature_derivation",
    job_scope: "platform",
    community_id: null,
    subject_type: "user",
    subject_id: input.userId,
    status: "queued",
    payload_json: JSON.stringify({
      snapshot_id: input.snapshotId,
      reddit_username: input.redditUsername,
    }),
    result_ref: input.snapshotId,
    error_code: null,
    attempt_count: 0,
    available_at: input.createdAt,
    created_at: input.createdAt,
    updated_at: input.createdAt,
  });
}

function parseJobPayload(raw: string | null): { reddit_username?: string; snapshot_id?: string } {
  if (!raw) {
    return {};
  }

  try {
    return JSON.parse(raw) as { reddit_username?: string; snapshot_id?: string };
  } catch {
    return {};
  }
}

function classifyImportFailure(error: unknown): "rate_limited" | "source_error" {
  if (error instanceof Error && error.message.includes("http_429")) {
    return "rate_limited";
  }

  return "source_error";
}

export async function runRedditSnapshotImportJob(input: {
  env: Env;
  store: AuthBootstrapStore;
  jobId: string;
}): Promise<void> {
  const job = await input.store.getJobById(input.jobId);
  if (!job) {
    throw new Error(`job_not_found:${input.jobId}`);
  }

  const timestamp = nowIso();
  const payload = parseJobPayload(job.payload_json);
  const redditUsername = payload.reddit_username ? normalizeRedditUsername(payload.reddit_username) : null;
  if (!redditUsername) {
    await input.store.withTransaction(async (tx) => {
      await tx.updateJobStatus({
        job_id: job.job_id,
        status: "failed",
        result_ref: null,
        error_code: "bad_payload",
        available_at: null,
        updated_at: timestamp,
      });
    });
    return;
  }

  const verification = await input.store.getLatestRedditVerificationSessionForUserAndUsername(job.subject_id, redditUsername);
  if (!verification || verification.status !== "verified") {
    await input.store.withTransaction(async (tx) => {
      await tx.updateJobStatus({
        job_id: job.job_id,
        status: "failed",
        result_ref: null,
        error_code: "verification_required",
        available_at: null,
        updated_at: timestamp,
      });
    });
    return;
  }

  const existingSnapshot = await input.store.getLatestExternalReputationSnapshotForUserAndHandle(job.subject_id, redditUsername);
  if (existingSnapshot) {
    await input.store.withTransaction(async (tx) => {
      await tx.updateJobStatus({
        job_id: job.job_id,
        status: "succeeded",
        result_ref: existingSnapshot.external_reputation_snapshot_id,
        error_code: null,
        available_at: null,
        updated_at: timestamp,
      });
      await enqueueRedditFeatureDerivationJob({
        tx,
        userId: job.subject_id,
        snapshotId: existingSnapshot.external_reputation_snapshot_id,
        redditUsername,
        createdAt: timestamp,
      });
    });
    return;
  }

  try {
    const snapshotPayload = await buildPullPushRedditSnapshotPayload({
      username: redditUsername,
      pullpushBaseUrl: input.env.PULLPUSH_BASE_URL,
      maxItems: input.env.REDDIT_IMPORT_MAX_ITEMS ? Number.parseInt(input.env.REDDIT_IMPORT_MAX_ITEMS, 10) : undefined,
    });

    const snapshotId = createId("ers");
    await input.store.withTransaction(async (tx) => {
      await tx.insertExternalReputationSnapshot({
        external_reputation_snapshot_id: snapshotId,
        user_id: job.subject_id,
        source_platform: "reddit",
        snapshot_type: "onboarding",
        source_account_handle: redditUsername,
        proof_method: "profile_code",
        captured_at: timestamp,
        snapshot_payload_json: JSON.stringify(snapshotPayload),
        created_at: timestamp,
        updated_at: timestamp,
      });

      await tx.updateJobStatus({
        job_id: job.job_id,
        status: "succeeded",
        result_ref: snapshotId,
        error_code: null,
        available_at: null,
        updated_at: timestamp,
      });
      await enqueueRedditFeatureDerivationJob({
        tx,
        userId: job.subject_id,
        snapshotId,
        redditUsername,
        createdAt: timestamp,
      });
    });
  } catch (error) {
    await input.store.withTransaction(async (tx) => {
      await tx.updateJobStatus({
        job_id: job.job_id,
        status: "failed",
        result_ref: null,
        error_code: classifyImportFailure(error),
        available_at: null,
        updated_at: nowIso(),
      });
    });
  }
}
