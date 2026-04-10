import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { AuthBootstrapStore, InsertJobInput } from "./db";
import { createId } from "./ids";
import { nowIso } from "./time";
import type { Env } from "../types/env";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../../");

function communityDbPath(env: Env, communityId: string): string {
  const root = env.LOCAL_COMMUNITY_DB_ROOT?.trim() || "/tmp/pirate-community-dbs";
  return resolve(root, `${communityId}.db`);
}

export async function runCommunityProvisioningJob(input: {
  env: Env;
  store: AuthBootstrapStore;
  jobId: string;
}): Promise<void> {
  const now = nowIso();
  const job = await input.store.getJobById(input.jobId);
  if (!job) {
    throw new Error(`job_not_found:${input.jobId}`);
  }

  if (!job.community_id) {
    throw new Error(`job_missing_community:${input.jobId}`);
  }

  const community = await input.store.getCommunityById(job.community_id);
  if (!community) {
    throw new Error(`community_not_found:${job.community_id}`);
  }

  if (!community.namespace_verification_id) {
    throw new Error(`community_missing_namespace_verification:${community.community_id}`);
  }
  const namespaceVerification = await input.store.getNamespaceVerificationById(
    community.namespace_verification_id,
  );
  if (!namespaceVerification) {
    throw new Error(`namespace_verification_not_found:${community.namespace_verification_id}`);
  }

  const communityDb = communityDbPath(input.env, community.community_id);
  const bindingId = `cdb_${community.community_id}_primary`;
  const registryJobId = createId("job");
  const payload =
    job.payload_json == null
      ? {}
      : (JSON.parse(job.payload_json) as {
          description?: string | null;
          membership_mode?: "open" | "request" | "gated";
          default_age_gate_policy?: "none" | "18_plus";
          handle_policy_template?: "standard" | "premium" | "membership_gated" | "custom";
        });

  // This service is designed for the Bun job runner path, not the public Worker runtime.
  const bootstrap = Bun.spawnSync(
    [
      "bash",
      resolve(REPO_ROOT, "scripts/bootstrap-community-db.sh"),
      "--db",
      communityDb,
      "--community-id",
      community.community_id,
      "--user-id",
      community.creator_user_id,
      "--display-name",
      community.display_name,
      "--namespace-verification-id",
      community.namespace_verification_id,
      "--namespace-label",
      namespaceVerification.normalized_root_label,
      "--membership-mode",
      payload.membership_mode ?? community.membership_mode,
      "--default-age-gate-policy",
      payload.default_age_gate_policy ?? "none",
      "--handle-policy-template",
      payload.handle_policy_template ?? "standard",
      ...(payload.description ? ["--description", payload.description] : []),
    ],
    {
      cwd: REPO_ROOT,
      stdout: "pipe",
      stderr: "pipe",
    },
  );

  const completionTime = nowIso();

  if (bootstrap.exitCode !== 0) {
    const stderr = new TextDecoder().decode(bootstrap.stderr).trim() || "community_bootstrap_failed";

    await input.store.withTransaction(async (tx) => {
      await tx.updateJobStatus({
        job_id: job.job_id,
        status: "failed",
        result_ref: null,
        error_code: "provisioning_failed",
        available_at: null,
        updated_at: completionTime,
      });

      await tx.updateCommunityRegistryState({
        community_id: community.community_id,
        provisioning_state: "error",
        registry_publication_state: "publication_error",
        registry_error_code: "provisioning_failed",
        updated_at: completionTime,
      });

      if (community.registry_attempt_id) {
        await tx.updateCommunityRegistryAttempt({
          registry_attempt_id: community.registry_attempt_id,
          community_id: community.community_id,
          attempt_status: "failed",
          failure_code: "provisioning_failed",
          updated_at: completionTime,
        });
      }

      await tx.insertAuditLog({
        audit_event_id: createId("audit"),
        actor_type: "system",
        actor_id: null,
        action: "community.provisioning_failed",
        target_type: "community",
        target_id: community.community_id,
        community_id: community.community_id,
        metadata_json: JSON.stringify({
          job_id: job.job_id,
          stderr,
        }),
        created_at: completionTime,
      });
    });

    return;
  }

  const databaseUrl = `file://${communityDb}`;
  const registryJob: InsertJobInput = {
    job_id: registryJobId,
    job_type: "community_registry_publication",
    job_scope: "platform",
    community_id: community.community_id,
    subject_type: "community",
    subject_id: community.community_id,
    status: "queued",
    payload_json: JSON.stringify({
      community_id: community.community_id,
      registry_attempt_id: community.registry_attempt_id,
    }),
    result_ref: null,
    error_code: null,
    attempt_count: 0,
    available_at: completionTime,
    created_at: completionTime,
    updated_at: completionTime,
  };

  await input.store.withTransaction(async (tx) => {
    await tx.insertCommunityDatabaseBinding({
      community_database_binding_id: bindingId,
      community_id: community.community_id,
      binding_role: "primary",
      organization_slug: "local-dev",
      group_name: `club-${community.community_id}`,
      group_id: null,
      database_name: "main",
      database_id: null,
      database_url: databaseUrl,
      location: "local",
      status: "active",
      transferred_at: null,
      created_at: now,
      updated_at: completionTime,
    });

    await tx.updateCommunityRegistryState({
      community_id: community.community_id,
      provisioning_state: "active",
      registry_publication_state: "pending_seed",
      registry_publication_job_id: registryJobId,
      registry_error_code: null,
      primary_database_binding_id: bindingId,
      updated_at: completionTime,
    });

    await tx.insertJob(registryJob);

    await tx.updateJobStatus({
      job_id: job.job_id,
      status: "succeeded",
      result_ref: databaseUrl,
      error_code: null,
      available_at: null,
      updated_at: completionTime,
    });

    await tx.insertAuditLog({
      audit_event_id: createId("audit"),
      actor_type: "system",
      actor_id: null,
      action: "community.provisioning_succeeded",
      target_type: "community",
      target_id: community.community_id,
      community_id: community.community_id,
      metadata_json: JSON.stringify({
        provisioning_job_id: job.job_id,
        registry_publication_job_id: registryJobId,
        community_db: communityDb,
      }),
      created_at: completionTime,
    });
  });
}
