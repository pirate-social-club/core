import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import type { AuthBootstrapStore } from "./db";
import { createId } from "./ids";
import { RegistryPublisherClient, RegistryPublisherError } from "./registry-publisher-client";
import { nowIso } from "./time";
import type { Env } from "../types/env";

function snapshotHash(input: unknown): string {
  return createHash("sha256").update(JSON.stringify(input)).digest("hex");
}

type CommunityDbRegistrySource = {
  description: string | null;
  governance_mode: "centralized" | "multisig" | "majeur";
  donation_policy_mode: "none" | "optional_creator_sidecar" | "fundraiser_default";
  donation_partner_status: "unconfigured" | "active" | "inactive";
  community_updated_at: string;
  namespace_id: string;
  namespace_display_label: string;
  namespace_normalized_label: string;
  namespace_route_family: string | null;
  namespace_status: "active" | "superseded" | "revoked";
  namespace_updated_at: string;
  handle_policy_template: "standard" | "premium" | "membership_gated" | "custom";
  handle_pricing_model: string | null;
  membership_required_for_claim: 0 | 1;
};

function namespaceSummaryFromSources(input: {
  source: CommunityDbRegistrySource;
  acceptedAt: string;
  routingEnabled: 0 | 1;
  pirateDnsAuthorityVerified: 0 | 1;
  operationClass: string | null;
}) {
  return {
    namespace_id: input.source.namespace_id,
    display_label: input.source.namespace_display_label,
    normalized_label: input.source.namespace_normalized_label,
    route_family: input.source.namespace_route_family ?? (input.routingEnabled === 1 ? "root" : "none"),
    namespace_role: input.operationClass === "pirate_delegated_namespace" ? "delegated" : "primary",
    status: input.source.namespace_status,
    root_proof_status: input.pirateDnsAuthorityVerified === 1 ? "verified" : "unverified",
    delegation_status: input.operationClass === "pirate_delegated_namespace" ? "delegated" : "not_delegated",
    last_verified_at: input.acceptedAt,
    updated_at: input.source.namespace_updated_at,
  };
}

function registrySummaryFromSources(input: {
  community: {
    display_name: string;
    status: string;
  };
  source: CommunityDbRegistrySource;
}) {
  return {
    display_name: input.community.display_name,
    description: input.source.description,
    avatar_ref: null,
    cover_ref: null,
    status: input.community.status === "suspended" ? "frozen" : input.community.status,
    governance_mode: input.source.governance_mode,
    governance_chain_id: null,
    governance_contract_address: null,
    governance_treasury_address: null,
    observed_owner_set_json: null,
    observed_owner_set_observed_at: null,
    governance_verification_state: input.source.governance_mode === "centralized" ? "not_required" : "pending",
    governance_last_verified_at: null,
    donation_policy_mode: input.source.donation_policy_mode,
    donation_partner_status: input.source.donation_partner_status,
    handle_policy_template: input.source.handle_policy_template,
    handle_pricing_model: input.source.handle_pricing_model,
    handle_claims_enabled: 1,
    handle_premium_enabled: input.source.handle_policy_template === "premium" ? 1 : 0,
    handle_auction_enabled: 0,
    updated_at: input.source.community_updated_at,
  };
}

function localDbPathFromBindingUrl(databaseUrl: string): string {
  if (!databaseUrl.startsWith("file://")) {
    throw new Error(`unsupported_community_database_url:${databaseUrl}`);
  }

  return fileURLToPath(databaseUrl);
}

function querySqliteJson<T>(databasePath: string, sql: string): T | null {
  const result = Bun.spawnSync(["sqlite3", "-noheader", databasePath, sql], {
    stdout: "pipe",
    stderr: "pipe",
  });

  if (result.exitCode !== 0) {
    const stderr = new TextDecoder().decode(result.stderr).trim() || "sqlite_query_failed";
    throw new Error(`community_db_query_failed:${stderr}`);
  }

  const stdout = new TextDecoder().decode(result.stdout).trim();
  if (!stdout) {
    return null;
  }

  return JSON.parse(stdout) as T;
}

function loadCommunityRegistrySource(databaseUrl: string, communityId: string): CommunityDbRegistrySource {
  const databasePath = localDbPathFromBindingUrl(databaseUrl);
  const communityIdSql = communityId.replace(/'/g, "''");
  const source = querySqliteJson<CommunityDbRegistrySource>(
    databasePath,
    `SELECT json_object(
      'description', c.description,
      'governance_mode', c.governance_mode,
      'donation_policy_mode', c.donation_policy_mode,
      'donation_partner_status', c.donation_partner_status,
      'community_updated_at', c.updated_at,
      'namespace_id', nb.namespace_id,
      'namespace_display_label', nb.display_label,
      'namespace_normalized_label', nb.normalized_label,
      'namespace_route_family', nb.route_family,
      'namespace_status', nb.status,
      'namespace_updated_at', nb.updated_at,
      'handle_policy_template', nhp.policy_template,
      'handle_pricing_model', nhp.pricing_model,
      'membership_required_for_claim', nhp.membership_required_for_claim
    )
    FROM communities c
    JOIN namespace_bindings nb
      ON nb.community_id = c.community_id
     AND nb.status = 'active'
    JOIN namespace_handle_policies nhp
      ON nhp.namespace_id = nb.namespace_id
    WHERE c.community_id = '${communityIdSql}'
    LIMIT 1;`,
  );

  if (!source) {
    throw new Error(`community_registry_source_not_found:${communityId}`);
  }

  return source;
}

function partialTableRefsFromPublisherError(error: RegistryPublisherError): {
  attempts_table_name: string;
  club_registry_table_name: string | null;
  club_namespace_table_name: string | null;
} | null {
  const details = error.details;
  if (!details) {
    return null;
  }

  const tableRefs =
    details.table_refs && typeof details.table_refs === "object"
      ? (details.table_refs as Record<string, unknown>)
      : null;
  if (!tableRefs) {
    return null;
  }

  return {
    attempts_table_name: String(tableRefs.attempts_table || ""),
    club_registry_table_name:
      tableRefs.club_registry_table == null ? null : String(tableRefs.club_registry_table),
    club_namespace_table_name:
      tableRefs.club_namespace_table == null ? null : String(tableRefs.club_namespace_table),
  };
}

export async function runCommunityRegistryPublicationJob(input: {
  env: Env;
  store: AuthBootstrapStore;
  jobId: string;
}): Promise<void> {
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
  if (!community.namespace_verification_id || !community.registry_attempt_id) {
    throw new Error(`community_missing_registry_seed:${community.community_id}`);
  }
  const registryAttemptId = community.registry_attempt_id;

  const namespaceVerification = await input.store.getNamespaceVerificationById(
    community.namespace_verification_id,
  );
  if (!namespaceVerification) {
    throw new Error(`namespace_verification_not_found:${community.namespace_verification_id}`);
  }

  const databaseBinding = await input.store.getActiveCommunityDatabaseBinding(community.community_id);
  if (!databaseBinding) {
    throw new Error(`community_database_binding_not_found:${community.community_id}`);
  }

  const communityDbSource = loadCommunityRegistrySource(
    databaseBinding.database_url,
    community.community_id,
  );
  const publisher = new RegistryPublisherClient(input.env);
  const timestamp = nowIso();

  const canonicalSeed = {
    registry: registrySummaryFromSources({
      community: {
        display_name: community.display_name,
        status: community.status,
      },
      source: communityDbSource,
    }),
    namespace_summary: namespaceSummaryFromSources({
      source: communityDbSource,
      acceptedAt: namespaceVerification.accepted_at,
      routingEnabled: namespaceVerification.routing_enabled,
      pirateDnsAuthorityVerified: namespaceVerification.pirate_dns_authority_verified,
      operationClass: namespaceVerification.operation_class,
    }),
  };

  const currentSnapshotHash = snapshotHash(canonicalSeed);
  const currentRefs = await input.store.getCommunityRegistryTableRefByCommunityId(community.community_id);
  if (
    currentRefs?.last_published_snapshot_hash === currentSnapshotHash &&
    currentRefs.club_registry_table_name &&
    currentRefs.club_namespace_table_name
  ) {
    await input.store.withTransaction(async (tx) => {
      await tx.updateJobStatus({
        job_id: job.job_id,
        status: "succeeded",
        result_ref: `tableland://${currentRefs.club_registry_table_name}/${community.community_id}`,
        error_code: null,
        available_at: null,
        updated_at: timestamp,
      });

      await tx.updateCommunityRegistryState({
        community_id: community.community_id,
        registry_publication_state: "published",
        registry_published_at: currentRefs.last_publish_succeeded_at ?? timestamp,
        registry_error_code: null,
        updated_at: timestamp,
      });
    });

    return;
  }

  try {
    const result = await publisher.publishCommunityCreate({
      registry_attempt_id: registryAttemptId,
      community_id: community.community_id,
      created_at: timestamp,
      existing_table_refs: {
        club_registry_table: currentRefs?.club_registry_table_name ?? null,
        club_namespace_table: currentRefs?.club_namespace_table_name ?? null,
      },
      canonical_seed: canonicalSeed,
    });

    await input.store.withTransaction(async (tx) => {
      await tx.upsertCommunityRegistryTableRef({
        community_id: community.community_id,
        tableland_chain_id: 84532,
        attempts_table_name: result.attempts_table,
        club_registry_table_name: result.club_registry_table,
        club_namespace_table_name: result.club_namespace_table,
        publisher_kind: "direct_key",
        last_published_snapshot_hash: currentSnapshotHash,
        last_publish_attempted_at: timestamp,
        last_publish_succeeded_at: result.registry_published_at,
        created_at: currentRefs?.created_at ?? timestamp,
        updated_at: timestamp,
      });

      await tx.updateCommunityRegistryState({
        community_id: community.community_id,
        registry_publication_state: "published",
        registry_published_at: result.registry_published_at,
        registry_error_code: null,
        updated_at: timestamp,
      });

      await tx.updateCommunityRegistryAttempt({
        registry_attempt_id: registryAttemptId,
        community_id: community.community_id,
        attempt_status: "succeeded",
        failure_code: null,
        updated_at: timestamp,
      });

      await tx.updateJobStatus({
        job_id: job.job_id,
        status: "succeeded",
        result_ref: result.result_ref,
        error_code: null,
        available_at: null,
        updated_at: timestamp,
      });

      await tx.insertAuditLog({
        audit_event_id: createId("audit"),
        actor_type: "system",
        actor_id: null,
        action: "community.registry_published",
        target_type: "community",
        target_id: community.community_id,
        community_id: community.community_id,
        metadata_json: JSON.stringify({
          registry_publication_job_id: job.job_id,
          club_registry_table_name: result.club_registry_table,
          club_namespace_table_name: result.club_namespace_table,
        }),
        created_at: timestamp,
      });
    });
  } catch (error) {
    const errorCode =
      error instanceof RegistryPublisherError ? error.errorCode : "registry_publication_failed";
    const attemptStatus =
      errorCode === "publisher_timeout_indeterminate" ? "in_progress" : ("failed" as const);
    const partialTableRefs =
      error instanceof RegistryPublisherError ? partialTableRefsFromPublisherError(error) : null;

    await input.store.withTransaction(async (tx) => {
      await tx.upsertCommunityRegistryTableRef({
        community_id: community.community_id,
        tableland_chain_id: currentRefs?.tableland_chain_id ?? 84532,
        attempts_table_name:
          partialTableRefs?.attempts_table_name ??
          currentRefs?.attempts_table_name ??
          "",
        club_registry_table_name:
          partialTableRefs?.club_registry_table_name ??
          currentRefs?.club_registry_table_name ??
          null,
        club_namespace_table_name:
          partialTableRefs?.club_namespace_table_name ??
          currentRefs?.club_namespace_table_name ??
          null,
        publisher_kind: currentRefs?.publisher_kind ?? "direct_key",
        last_published_snapshot_hash: currentRefs?.last_published_snapshot_hash ?? null,
        last_publish_attempted_at: timestamp,
        last_publish_succeeded_at: currentRefs?.last_publish_succeeded_at ?? null,
        created_at: currentRefs?.created_at ?? timestamp,
        updated_at: timestamp,
      });

      await tx.updateCommunityRegistryState({
        community_id: community.community_id,
        registry_publication_state: "publication_error",
        registry_error_code: errorCode,
        updated_at: timestamp,
      });

      await tx.updateCommunityRegistryAttempt({
        registry_attempt_id: registryAttemptId,
        community_id: community.community_id,
        attempt_status: attemptStatus,
        failure_code: errorCode === "publisher_timeout_indeterminate" ? null : errorCode,
        updated_at: timestamp,
      });

      await tx.updateJobStatus({
        job_id: job.job_id,
        status: "failed",
        result_ref: null,
        error_code: errorCode,
        available_at: null,
        updated_at: timestamp,
      });

      await tx.insertAuditLog({
        audit_event_id: createId("audit"),
        actor_type: "system",
        actor_id: null,
        action: "community.registry_publication_failed",
        target_type: "community",
        target_id: community.community_id,
        community_id: community.community_id,
        metadata_json: JSON.stringify({
          registry_publication_job_id: job.job_id,
          error_code: errorCode,
        }),
        created_at: timestamp,
      });
    });
  }
}
