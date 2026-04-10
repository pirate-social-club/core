import type { AuthBootstrapStore } from "./db";
import { runRedditFeatureDerivationJob } from "./reddit-feature-derivation-service";
import { runRedditSnapshotImportJob } from "./reddit-import-service";
import { nowIso } from "./time";
import type { Env } from "../types/env";
import type { JobRow } from "../types/db";

export async function runOnePlatformJob(input: {
  env: Env;
  store: AuthBootstrapStore;
  jobType: Extract<JobRow["job_type"], "reddit_snapshot_import" | "reddit_feature_derivation">;
}): Promise<boolean> {
  const job = await input.store.claimNextRunnableJob(input.jobType, nowIso());
  if (!job) {
    return false;
  }

  if (job.job_type === "reddit_snapshot_import") {
    await runRedditSnapshotImportJob({
      env: input.env,
      store: input.store,
      jobId: job.job_id,
    });
    return true;
  }

  if (job.job_type === "reddit_feature_derivation") {
    await runRedditFeatureDerivationJob({
      env: input.env,
      store: input.store,
      jobId: job.job_id,
    });
    return true;
  }

  return true;
}
