import type { AuthBootstrapStore } from "./db";
import { runCommunityProvisioningJob } from "./community-provisioning-service";
import { runCommunityRegistryPublicationJob } from "./community-registry-publication-service";
import { nowIso } from "./time";
import type { Env } from "../types/env";
import type { JobRow } from "../types/db";

export async function runOneCommunityJob(input: {
  env: Env;
  store: AuthBootstrapStore;
  jobType: Extract<JobRow["job_type"], "community_provisioning" | "community_registry_publication">;
}): Promise<boolean> {
  const job = await input.store.claimNextRunnableJob(input.jobType, nowIso());
  if (!job) {
    return false;
  }

  if (job.job_type === "community_provisioning") {
    await runCommunityProvisioningJob({
      env: input.env,
      store: input.store,
      jobId: job.job_id,
    });
    return true;
  }

  await runCommunityRegistryPublicationJob({
    env: input.env,
    store: input.store,
    jobId: job.job_id,
  });
  return true;
}
