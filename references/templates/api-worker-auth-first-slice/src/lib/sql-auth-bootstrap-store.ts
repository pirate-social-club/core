import type {
  AuthBootstrapStore,
  AuthBootstrapTx,
  InsertAuditLogInput,
  InsertAuthProviderLinkInput,
  InsertWalletAttachmentInput,
  InsertCommunityInput,
  InsertCommunityMembershipRequestInput,
  UpdateCommunityMembershipRequestInput,
  UpsertCommunityGateRuleInput,
  UpsertCommunityMembershipProjectionInput,
  InsertCommunityDatabaseBindingInput,
  InsertCommunityRegistryAttemptInput,
  InsertCommunityPostProjectionInput,
  InsertDeviceSessionInput,
  InsertExternalReputationSnapshotInput,
  InsertGlobalHandleInput,
  InsertJobInput,
  InsertNamespaceVerificationInput,
  InsertNamespaceVerificationSessionInput,
  InsertProfileInput,
  InsertRedditVerificationSessionInput,
  InsertUserInput,
  InsertVerificationSessionInput,
  UpdateCommunityRegistryAttemptInput,
  UpdateCommunityRegistryStateInput,
  UpdateJobStatusInput,
  UpdateProfileInput,
  UpdateUserPrimaryWalletAttachmentInput,
  UpdateUserVerificationInput,
  UpsertUserAudienceSegmentInput,
  UpsertCommunityRegistryTableRefInput,
  UpsertCommunityMoneyPolicyInput,
  UpsertUserInterestTagInput,
  UpsertUserRedditFeatureProfileInput,
  UpsertUserRedditSubredditAffinityInput,
} from "./db";
import { UniqueConstraintError } from "./db";
import type {
  AuthProviderLinkRow,
  CommunityDatabaseBindingRow,
  CommunityGateRuleRow,
  CommunityMembershipRequestRow,
  CommunityMembershipProjectionRow,
  CommunityRegistryAttemptRow,
  CommunityRegistryTableRefRow,
  CommunityMoneyPolicyRow,
  CommunityRow,
  DeviceSessionRow,
  ExternalReputationSnapshotRow,
  GlobalHandleRow,
  JobRow,
  NamespaceVerificationRow,
  NamespaceVerificationSessionRow,
  ProfileRow,
  RedditVerificationSessionRow,
  UserAudienceSegmentRow,
  UserInterestTagRow,
  UserRedditFeatureProfileRow,
  UserRedditSubredditAffinityRow,
  UserRow,
  VerificationSessionRow,
  WalletAttachmentRow,
} from "../types/db";

export type SqlParams = Record<string, string | number | null>;

export interface SqlExecutor {
  get<T>(sql: string, params?: SqlParams): Promise<T | null>;
  all<T>(sql: string, params?: SqlParams): Promise<T[]>;
  run(sql: string, params?: SqlParams): Promise<void>;
}

export interface TransactionalSqlExecutor extends SqlExecutor {
  transaction<T>(fn: (tx: SqlExecutor) => Promise<T>): Promise<T>;
}

function mapUniqueConstraintField(rawFields: string[]): string {
  if (rawFields.includes("provider_subject")) {
    return "auth_provider_links.provider_subject";
  }

  if (rawFields.includes("auth_provider_links.provider_subject")) {
    return "auth_provider_links.provider_subject";
  }

  if (
    rawFields.includes("auth_provider_links.provider") &&
    rawFields.includes("auth_provider_links.provider_subject")
  ) {
    return "auth_provider_links.provider_subject";
  }

  if (rawFields.includes("global_handles.label_normalized")) {
    return "global_handles.label_normalized";
  }

  if (rawFields.includes("label_normalized")) {
    return "global_handles.label_normalized";
  }

  if (
    rawFields.includes("wallet_attachments.user_id") &&
    rawFields.includes("wallet_attachments.chain_namespace") &&
    rawFields.includes("wallet_attachments.wallet_address_normalized")
  ) {
    return "wallet_attachments.user_wallet";
  }

  if (
    rawFields.includes("user_id") &&
    rawFields.includes("chain_namespace") &&
    rawFields.includes("wallet_address_normalized")
  ) {
    return "wallet_attachments.user_wallet";
  }

  if (rawFields.includes("wallet_attachments.user_id") && rawFields.includes("wallet_attachments.is_primary")) {
    return "wallet_attachments.primary";
  }

  if (rawFields.length === 1 && (rawFields[0] === "user_id" || rawFields[0] === "wallet_attachments.user_id")) {
    return "wallet_attachments.primary";
  }

  return rawFields[rawFields.length - 1] ?? "unknown";
}

function rethrowSqlError(error: unknown): never {
  if (error instanceof UniqueConstraintError) {
    throw error;
  }

  if (error && typeof error === "object") {
    const postgresError = error as {
      code?: string;
      constraint?: string;
      detail?: string;
      message?: string;
    };

    if (postgresError.code === "23505") {
      const detailMatch = postgresError.detail?.match(/Key \((.+)\)=/);
      if (detailMatch) {
        const rawFields = detailMatch[1].split(",").map((field) => field.trim());
        throw new UniqueConstraintError(
          mapUniqueConstraintField(rawFields),
          postgresError.message ?? "duplicate value",
        );
      }

      const constraint = postgresError.constraint ?? "";
      if (constraint.includes("auth_provider_links")) {
        throw new UniqueConstraintError(
          "auth_provider_links.provider_subject",
          postgresError.message ?? "duplicate auth provider link",
        );
      }

      if (constraint.includes("global_handles")) {
        throw new UniqueConstraintError(
          "global_handles.label_normalized",
          postgresError.message ?? "duplicate global handle",
        );
      }

      if (constraint.includes("wallet_attachments_active_primary")) {
        throw new UniqueConstraintError(
          "wallet_attachments.primary",
          postgresError.message ?? "duplicate primary wallet attachment",
        );
      }

      if (constraint.includes("wallet_attachments")) {
        throw new UniqueConstraintError(
          "wallet_attachments.user_wallet",
          postgresError.message ?? "duplicate wallet attachment",
        );
      }

      throw new UniqueConstraintError("unknown", postgresError.message ?? "duplicate value");
    }
  }

  if (error instanceof Error) {
    const match = error.message.match(/UNIQUE constraint failed: (.+)$/);
    if (match) {
      const rawFields = match[1].split(",").map((field) => field.trim());
      throw new UniqueConstraintError(mapUniqueConstraintField(rawFields), error.message);
    }
  }

  throw error;
}

class SqlAuthBootstrapQueries {
  constructor(protected readonly db: SqlExecutor) {}

  findActiveAuthProviderLink(provider: string, providerSubject: string): Promise<AuthProviderLinkRow | null> {
    return this.db.get<AuthProviderLinkRow>(
      `SELECT
         auth_provider_link_id,
         user_id,
         provider,
         provider_subject,
         provider_user_ref,
         status,
         linked_at,
         revoked_at,
         created_at,
         updated_at
       FROM auth_provider_links
       WHERE provider = :provider
         AND provider_subject = :provider_subject
         AND status = 'active'`,
      {
        provider,
        provider_subject: providerSubject,
      },
    );
  }

  getUser(userId: string): Promise<UserRow | null> {
    return this.db.get<UserRow>(
      `SELECT
         user_id,
         primary_wallet_attachment_id,
         verification_state,
         capability_provider,
         verification_capabilities_json,
         verified_at,
         nationality,
         current_verification_session_id,
         created_at,
         updated_at
       FROM users
       WHERE user_id = :user_id`,
      { user_id: userId },
    );
  }

  getProfileByUserId(userId: string): Promise<ProfileRow | null> {
    return this.db.get<ProfileRow>(
      `SELECT
         user_id,
         display_name,
         bio,
         avatar_ref,
         cover_ref,
         global_handle_id,
         created_at,
         updated_at
       FROM profiles
       WHERE user_id = :user_id`,
      { user_id: userId },
    );
  }

  getGlobalHandleById(globalHandleId: string): Promise<GlobalHandleRow | null> {
    return this.db.get<GlobalHandleRow>(
      `SELECT
         global_handle_id,
         user_id,
         label_normalized,
         label_display,
         status,
         tier,
         issuance_source,
         redirect_target_global_handle_id,
         price_paid_usd,
         free_rename_consumed,
         issued_at,
         replaced_at,
         created_at,
         updated_at
       FROM global_handles
       WHERE global_handle_id = :global_handle_id`,
      { global_handle_id: globalHandleId },
    );
  }

  listActiveWalletAttachments(userId: string): Promise<WalletAttachmentRow[]> {
    return this.db.all<WalletAttachmentRow>(
      `SELECT
         wallet_attachment_id,
         user_id,
         chain_namespace,
         wallet_address_normalized,
         wallet_address_display,
         source_provider,
         source_subject,
         attachment_kind,
         is_primary,
         status,
         attached_at,
         detached_at,
         created_at,
         updated_at
       FROM wallet_attachments
       WHERE user_id = :user_id
         AND status = 'active'
       ORDER BY is_primary DESC, attached_at ASC`,
      { user_id: userId },
    );
  }

  getPrimaryWalletAttachmentForUser(userId: string): Promise<WalletAttachmentRow | null> {
    return this.db.get<WalletAttachmentRow>(
      `SELECT
         wallet_attachment_id,
         user_id,
         chain_namespace,
         wallet_address_normalized,
         wallet_address_display,
         source_provider,
         source_subject,
         attachment_kind,
         is_primary,
         status,
         attached_at,
         detached_at,
         created_at,
         updated_at
       FROM wallet_attachments
       WHERE user_id = :user_id
         AND status = 'active'
         AND is_primary = 1
       LIMIT 1`,
      { user_id: userId },
    );
  }

  getVerificationSessionById(verificationSessionId: string): Promise<VerificationSessionRow | null> {
    return this.db.get<VerificationSessionRow>(
      `SELECT
         verification_session_id,
         user_id,
         provider,
         session_kind,
         requested_capabilities_json,
         status,
         upstream_session_ref,
         result_ref,
         failure_code,
         started_at,
         completed_at,
         expires_at,
         created_at,
         updated_at
       FROM verification_sessions
       WHERE verification_session_id = :verification_session_id`,
      { verification_session_id: verificationSessionId },
    );
  }

  getLatestVerificationSessionForUser(userId: string): Promise<VerificationSessionRow | null> {
    return this.db.get<VerificationSessionRow>(
      `SELECT
         verification_session_id,
         user_id,
         provider,
         session_kind,
         requested_capabilities_json,
         status,
         upstream_session_ref,
         result_ref,
         failure_code,
         started_at,
         completed_at,
         expires_at,
         created_at,
         updated_at
       FROM verification_sessions
       WHERE user_id = :user_id
       ORDER BY created_at DESC, verification_session_id DESC
       LIMIT 1`,
      { user_id: userId },
    );
  }

  getDeviceSessionById(deviceSessionId: string): Promise<DeviceSessionRow | null> {
    return this.db.get<DeviceSessionRow>(
      `SELECT
         device_session_id,
         device_code,
         user_code,
         authorized_user_id,
         status,
         client_name,
         created_at,
         updated_at,
         expires_at,
         authorized_at,
         completed_at
       FROM device_sessions
       WHERE device_session_id = :device_session_id`,
      { device_session_id: deviceSessionId },
    );
  }

  getDeviceSessionByDeviceCode(deviceCode: string): Promise<DeviceSessionRow | null> {
    return this.db.get<DeviceSessionRow>(
      `SELECT
         device_session_id,
         device_code,
         user_code,
         authorized_user_id,
         status,
         client_name,
         created_at,
         updated_at,
         expires_at,
         authorized_at,
         completed_at
       FROM device_sessions
       WHERE device_code = :device_code`,
      { device_code: deviceCode },
    );
  }

  getLatestRedditVerificationSessionForUser(userId: string): Promise<RedditVerificationSessionRow | null> {
    return this.db.get<RedditVerificationSessionRow>(
      `SELECT
         reddit_verification_session_id,
         user_id,
         reddit_username,
         verification_code,
         code_placement_surface,
         status,
         verification_hint,
         failure_code,
         checked_count,
         last_checked_at,
         verified_at,
         expires_at,
         created_at,
         updated_at
       FROM reddit_verification_sessions
       WHERE user_id = :user_id
       ORDER BY created_at DESC, reddit_verification_session_id DESC
       LIMIT 1`,
      { user_id: userId },
    );
  }

  getLatestRedditVerificationSessionForUserAndUsername(
    userId: string,
    redditUsername: string,
  ): Promise<RedditVerificationSessionRow | null> {
    return this.db.get<RedditVerificationSessionRow>(
      `SELECT
         reddit_verification_session_id,
         user_id,
         reddit_username,
         verification_code,
         code_placement_surface,
         status,
         verification_hint,
         failure_code,
         checked_count,
         last_checked_at,
         verified_at,
         expires_at,
         created_at,
         updated_at
       FROM reddit_verification_sessions
       WHERE user_id = :user_id
         AND reddit_username = :reddit_username
       ORDER BY created_at DESC, reddit_verification_session_id DESC
       LIMIT 1`,
      {
        user_id: userId,
        reddit_username: redditUsername,
      },
    );
  }

  getLatestExternalReputationSnapshotForUser(userId: string): Promise<ExternalReputationSnapshotRow | null> {
    return this.db.get<ExternalReputationSnapshotRow>(
      `SELECT
         external_reputation_snapshot_id,
         user_id,
         source_platform,
         snapshot_type,
         source_account_handle,
         proof_method,
         captured_at,
         snapshot_payload_json,
         created_at,
         updated_at
       FROM external_reputation_snapshots
       WHERE user_id = :user_id
         AND source_platform = 'reddit'
       ORDER BY captured_at DESC, external_reputation_snapshot_id DESC
       LIMIT 1`,
      { user_id: userId },
    );
  }

  getExternalReputationSnapshotById(snapshotId: string): Promise<ExternalReputationSnapshotRow | null> {
    return this.db.get<ExternalReputationSnapshotRow>(
      `SELECT
         external_reputation_snapshot_id,
         user_id,
         source_platform,
         snapshot_type,
         source_account_handle,
         proof_method,
         captured_at,
         snapshot_payload_json,
         created_at,
         updated_at
       FROM external_reputation_snapshots
       WHERE external_reputation_snapshot_id = :external_reputation_snapshot_id`,
      {
        external_reputation_snapshot_id: snapshotId,
      },
    );
  }

  getLatestExternalReputationSnapshotForUserAndHandle(
    userId: string,
    sourceAccountHandle: string,
  ): Promise<ExternalReputationSnapshotRow | null> {
    return this.db.get<ExternalReputationSnapshotRow>(
      `SELECT
         external_reputation_snapshot_id,
         user_id,
         source_platform,
         snapshot_type,
         source_account_handle,
         proof_method,
         captured_at,
         snapshot_payload_json,
         created_at,
         updated_at
       FROM external_reputation_snapshots
       WHERE user_id = :user_id
         AND source_platform = 'reddit'
         AND source_account_handle = :source_account_handle
       ORDER BY captured_at DESC, external_reputation_snapshot_id DESC
       LIMIT 1`,
      {
        user_id: userId,
        source_account_handle: sourceAccountHandle,
      },
    );
  }

  listUserRedditSubredditAffinitiesForSnapshot(snapshotId: string): Promise<UserRedditSubredditAffinityRow[]> {
    return this.db.all<UserRedditSubredditAffinityRow>(
      `SELECT
         affinity_id,
         user_id,
         source_snapshot_id,
         subreddit,
         post_count,
         comment_count,
         post_score,
         comment_score,
         total_score,
         first_seen_at,
         last_seen_at,
         weight,
         feature_version,
         derived_at,
         created_at,
         updated_at
       FROM user_reddit_subreddit_affinities
       WHERE source_snapshot_id = :source_snapshot_id
       ORDER BY total_score DESC, subreddit ASC`,
      {
        source_snapshot_id: snapshotId,
      },
    );
  }

  listUserInterestTagsForSnapshot(snapshotId: string): Promise<UserInterestTagRow[]> {
    return this.db.all<UserInterestTagRow>(
      `SELECT
         interest_tag_id,
         user_id,
         source_snapshot_id,
         tag,
         source,
         confidence,
         weight,
         evidence_json::text AS evidence_json,
         feature_version,
         derived_at,
         created_at,
         updated_at
       FROM user_interest_tags
       WHERE source_snapshot_id = :source_snapshot_id
       ORDER BY confidence DESC, weight DESC, tag ASC`,
      {
        source_snapshot_id: snapshotId,
      },
    );
  }

  listUserAudienceSegmentsForSnapshot(snapshotId: string): Promise<UserAudienceSegmentRow[]> {
    return this.db.all<UserAudienceSegmentRow>(
      `SELECT
         audience_segment_id,
         user_id,
         source_snapshot_id,
         segment_key,
         source,
         confidence,
         eligibility_state,
         evidence_json::text AS evidence_json,
         derivation_version,
         derived_at,
         expires_at,
         created_at,
         updated_at
       FROM user_audience_segments
       WHERE source_snapshot_id = :source_snapshot_id
       ORDER BY confidence DESC, segment_key ASC`,
      {
        source_snapshot_id: snapshotId,
      },
    );
  }

  getNamespaceVerificationSessionById(namespaceVerificationSessionId: string): Promise<NamespaceVerificationSessionRow | null> {
    return this.db.get<NamespaceVerificationSessionRow>(
      `SELECT
         namespace_verification_session_id,
         namespace_verification_id,
         user_id,
         family,
         submitted_root_label,
         normalized_root_label,
         status,
         challenge_host,
         challenge_txt_value,
         challenge_expires_at,
         root_exists,
         root_control_verified,
         expiry_horizon_sufficient,
         routing_enabled,
         pirate_dns_authority_verified,
         club_attach_allowed,
         pirate_web_routing_allowed,
         pirate_subdomain_issuance_allowed,
         control_class,
         operation_class,
         observation_provider,
         evidence_bundle_ref,
         failure_reason,
         accepted_at,
         expires_at,
         created_at,
         updated_at
       FROM namespace_verification_sessions
       WHERE namespace_verification_session_id = :namespace_verification_session_id`,
      { namespace_verification_session_id: namespaceVerificationSessionId },
    );
  }

  getLatestNamespaceVerificationSessionForUser(userId: string): Promise<NamespaceVerificationSessionRow | null> {
    return this.db.get<NamespaceVerificationSessionRow>(
      `SELECT
         namespace_verification_session_id,
         namespace_verification_id,
         user_id,
         family,
         submitted_root_label,
         normalized_root_label,
         status,
         challenge_host,
         challenge_txt_value,
         challenge_expires_at,
         root_exists,
         root_control_verified,
         expiry_horizon_sufficient,
         routing_enabled,
         pirate_dns_authority_verified,
         club_attach_allowed,
         pirate_web_routing_allowed,
         pirate_subdomain_issuance_allowed,
         control_class,
         operation_class,
         observation_provider,
         evidence_bundle_ref,
         failure_reason,
         accepted_at,
         expires_at,
         created_at,
         updated_at
       FROM namespace_verification_sessions
       WHERE user_id = :user_id
       ORDER BY created_at DESC, namespace_verification_session_id DESC
       LIMIT 1`,
      { user_id: userId },
    );
  }

  getLatestNamespaceVerificationForUser(userId: string): Promise<NamespaceVerificationRow | null> {
    return this.db.get<NamespaceVerificationRow>(
      `SELECT
         namespace_verification_id,
         source_namespace_verification_session_id,
         user_id,
         family,
         normalized_root_label,
         status,
         root_exists,
         root_control_verified,
         expiry_horizon_sufficient,
         routing_enabled,
         pirate_dns_authority_verified,
         club_attach_allowed,
         pirate_web_routing_allowed,
         pirate_subdomain_issuance_allowed,
         control_class,
         operation_class,
         observation_provider,
         evidence_bundle_ref,
         accepted_at,
         expires_at,
         created_at,
         updated_at
       FROM namespace_verifications
       WHERE user_id = :user_id
       ORDER BY accepted_at DESC, namespace_verification_id DESC
       LIMIT 1`,
      { user_id: userId },
    );
  }

  getNamespaceVerificationById(namespaceVerificationId: string): Promise<NamespaceVerificationRow | null> {
    return this.db.get<NamespaceVerificationRow>(
      `SELECT
         namespace_verification_id,
         source_namespace_verification_session_id,
         user_id,
         family,
         normalized_root_label,
         status,
         root_exists,
         root_control_verified,
         expiry_horizon_sufficient,
         routing_enabled,
         pirate_dns_authority_verified,
         club_attach_allowed,
         pirate_web_routing_allowed,
         pirate_subdomain_issuance_allowed,
         control_class,
         operation_class,
         observation_provider,
         evidence_bundle_ref,
         accepted_at,
         expires_at,
         created_at,
         updated_at
       FROM namespace_verifications
       WHERE namespace_verification_id = :namespace_verification_id`,
      { namespace_verification_id: namespaceVerificationId },
    );
  }

  getCommunityRegistryAttemptById(registryAttemptId: string): Promise<CommunityRegistryAttemptRow | null> {
    return this.db.get<CommunityRegistryAttemptRow>(
      `SELECT
         registry_attempt_id,
         actor_user_id,
         actor_primary_wallet_snapshot,
         actor_governance_address_snapshot,
         namespace_verification_id,
         normalized_root_label,
         community_id,
         attempt_status,
         failure_code,
         created_at,
         updated_at
       FROM community_registry_attempts
       WHERE registry_attempt_id = :registry_attempt_id`,
      { registry_attempt_id: registryAttemptId },
    );
  }

  getCommunityRegistryTableRefByCommunityId(communityId: string): Promise<CommunityRegistryTableRefRow | null> {
    return this.db.get<CommunityRegistryTableRefRow>(
      `SELECT
         community_id,
         tableland_chain_id,
         attempts_table_name,
         club_registry_table_name,
         club_namespace_table_name,
         publisher_kind,
         last_published_snapshot_hash,
         last_publish_attempted_at,
         last_publish_succeeded_at,
         created_at,
         updated_at
       FROM community_registry_table_refs
       WHERE community_id = :community_id`,
      { community_id: communityId },
    );
  }

  getActiveCommunityDatabaseBinding(communityId: string): Promise<CommunityDatabaseBindingRow | null> {
    return this.db.get<CommunityDatabaseBindingRow>(
      `SELECT
         community_database_binding_id,
         community_id,
         binding_role,
         organization_slug,
         group_name,
         group_id,
         database_name,
         database_id,
         database_url,
         location,
         status,
         transferred_at,
         created_at,
         updated_at
       FROM community_database_bindings
       WHERE community_id = :community_id
         AND binding_role = 'primary'
         AND status = 'active'
       LIMIT 1`,
      { community_id: communityId },
    );
  }

  findCommunityByNamespaceVerificationId(namespaceVerificationId: string): Promise<CommunityRow | null> {
    return this.db.get<CommunityRow>(
      `SELECT
         community_id,
         creator_user_id,
         display_name,
         membership_mode,
         status,
         provisioning_state,
         transfer_state,
         registry_publication_state,
         registry_attempt_id,
         registry_published_at,
         registry_publication_job_id,
         registry_error_code,
         route_slug,
         namespace_verification_id,
         primary_database_binding_id,
         created_at,
         updated_at
       FROM communities
       WHERE namespace_verification_id = :namespace_verification_id`,
      { namespace_verification_id: namespaceVerificationId },
    );
  }

  getCommunityById(communityId: string): Promise<CommunityRow | null> {
    return this.db.get<CommunityRow>(
      `SELECT
         community_id,
         creator_user_id,
         display_name,
         membership_mode,
         status,
         provisioning_state,
         transfer_state,
         registry_publication_state,
         registry_attempt_id,
         registry_published_at,
         registry_publication_job_id,
         registry_error_code,
         route_slug,
         namespace_verification_id,
         primary_database_binding_id,
         created_at,
         updated_at
       FROM communities
       WHERE community_id = :community_id`,
      { community_id: communityId },
    );
  }

  listCommunityGateRules(communityId: string): Promise<CommunityGateRuleRow[]> {
    return this.db.all<CommunityGateRuleRow>(
      `SELECT
         gate_rule_id,
         community_id,
         scope,
         gate_family,
         gate_type,
         proof_requirements_json,
         chain_namespace,
         gate_config_json,
         status,
         created_at,
         updated_at
       FROM community_gate_rules
       WHERE community_id = :community_id
       ORDER BY created_at ASC`,
      {
        community_id: communityId,
      },
    );
  }

  getCommunityGateRuleById(gateRuleId: string): Promise<CommunityGateRuleRow | null> {
    return this.db.get<CommunityGateRuleRow>(
      `SELECT
         gate_rule_id,
         community_id,
         scope,
         gate_family,
         gate_type,
         proof_requirements_json,
         chain_namespace,
         gate_config_json,
         status,
         created_at,
         updated_at
       FROM community_gate_rules
       WHERE gate_rule_id = :gate_rule_id`,
      {
        gate_rule_id: gateRuleId,
      },
    );
  }

  listActiveCommunityGateRules(
    communityId: string,
    scope: CommunityGateRuleRow["scope"],
  ): Promise<CommunityGateRuleRow[]> {
    return this.db.all<CommunityGateRuleRow>(
      `SELECT
         gate_rule_id,
         community_id,
         scope,
         gate_family,
         gate_type,
         proof_requirements_json,
         chain_namespace,
         gate_config_json,
         status,
         created_at,
         updated_at
       FROM community_gate_rules
       WHERE community_id = :community_id
         AND scope = :scope
         AND status = 'active'
       ORDER BY created_at ASC`,
      {
        community_id: communityId,
        scope,
      },
    );
  }

  getCommunityMembershipProjection(
    communityId: string,
    userId: string,
  ): Promise<CommunityMembershipProjectionRow | null> {
    return this.db.get<CommunityMembershipProjectionRow>(
      `SELECT
         projection_id,
         community_id,
         user_id,
         membership_state,
         role_summary_json,
         source_updated_at,
         created_at,
         updated_at
       FROM community_membership_projections
       WHERE community_id = :community_id
         AND user_id = :user_id`,
      {
        community_id: communityId,
        user_id: userId,
      },
    );
  }

  getPendingCommunityMembershipRequest(
    communityId: string,
    applicantUserId: string,
  ): Promise<CommunityMembershipRequestRow | null> {
    return this.db.get<CommunityMembershipRequestRow>(
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
       FROM community_membership_requests
       WHERE community_id = :community_id
         AND applicant_user_id = :applicant_user_id
         AND status = 'pending'
       ORDER BY created_at DESC
       LIMIT 1`,
      {
        community_id: communityId,
        applicant_user_id: applicantUserId,
      },
    );
  }

  getCommunityMembershipRequestById(
    membershipRequestId: string,
  ): Promise<CommunityMembershipRequestRow | null> {
    return this.db.get<CommunityMembershipRequestRow>(
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
       FROM community_membership_requests
       WHERE membership_request_id = :membership_request_id`,
      {
        membership_request_id: membershipRequestId,
      },
    );
  }

  listPendingCommunityMembershipRequests(
    communityId: string,
  ): Promise<CommunityMembershipRequestRow[]> {
    return this.db.all<CommunityMembershipRequestRow>(
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
       FROM community_membership_requests
       WHERE community_id = :community_id
         AND status = 'pending'
       ORDER BY created_at ASC`,
      {
        community_id: communityId,
      },
    );
  }

  getCommunityMoneyPolicyByCommunityId(communityId: string): Promise<CommunityMoneyPolicyRow | null> {
    return this.db.get<CommunityMoneyPolicyRow>(
      `SELECT
         community_id,
         funding_preference,
         accepted_funding_assets_json,
         accepted_source_chains_json,
         approved_route_providers_json,
         destination_settlement_chain_json,
         destination_settlement_token,
         treasury_denomination,
         max_slippage_bps,
         quote_ttl_seconds,
         route_required,
         route_status_policy,
         route_hop_tolerance,
         updated_at
       FROM community_money_policies
       WHERE community_id = :community_id`,
      { community_id: communityId },
    );
  }

  getJobById(jobId: string): Promise<JobRow | null> {
    return this.db.get<JobRow>(
      `SELECT
         job_id,
         job_type,
         job_scope,
         community_id,
         subject_type,
         subject_id,
         status,
         payload_json,
         result_ref,
         error_code,
         attempt_count,
         available_at,
         created_at,
         updated_at
       FROM jobs
       WHERE job_id = :job_id`,
      { job_id: jobId },
    );
  }

  findLatestJobBySubject(subjectType: string, subjectId: string): Promise<JobRow | null> {
    return this.db.get<JobRow>(
      `SELECT
         job_id,
         job_type,
         job_scope,
         community_id,
         subject_type,
         subject_id,
         status,
         payload_json,
         result_ref,
         error_code,
         attempt_count,
         available_at,
         created_at,
         updated_at
       FROM jobs
       WHERE subject_type = :subject_type
         AND subject_id = :subject_id
       ORDER BY created_at DESC, job_id DESC
       LIMIT 1`,
      {
        subject_type: subjectType,
        subject_id: subjectId,
      },
    );
  }

  getLatestJobByTypeAndSubject(jobType: JobRow["job_type"], subjectType: string, subjectId: string): Promise<JobRow | null> {
    return this.db.get<JobRow>(
      `SELECT
         job_id,
         job_type,
         job_scope,
         community_id,
         subject_type,
         subject_id,
         status,
         payload_json,
         result_ref,
         error_code,
         attempt_count,
         available_at,
         created_at,
         updated_at
       FROM jobs
       WHERE job_type = :job_type
         AND subject_type = :subject_type
         AND subject_id = :subject_id
       ORDER BY created_at DESC, job_id DESC
       LIMIT 1`,
      {
        job_type: jobType,
        subject_type: subjectType,
        subject_id: subjectId,
      },
    );
  }

  async claimNextRunnableJob(jobType: JobRow["job_type"], nowIso: string): Promise<JobRow | null> {
    const candidate = await this.db.get<{ job_id: string }>(
      `SELECT job_id
       FROM jobs
       WHERE job_type = :job_type
         AND status = 'queued'
         AND (available_at IS NULL OR available_at <= :available_at)
       ORDER BY created_at ASC, job_id ASC
       LIMIT 1`,
      {
        job_type: jobType,
        available_at: nowIso,
      },
    );

    if (!candidate) {
      return null;
    }

    await this.db.run(
      `UPDATE jobs
       SET status = 'running',
           attempt_count = attempt_count + 1,
           updated_at = :updated_at
       WHERE job_id = :job_id
         AND status = 'queued'`,
      {
        job_id: candidate.job_id,
        updated_at: nowIso,
      },
    );

    return this.db.get<JobRow>(
      `SELECT
         job_id,
         job_type,
         job_scope,
         community_id,
         subject_type,
         subject_id,
         status,
         payload_json,
         result_ref,
         error_code,
         attempt_count,
         available_at,
         created_at,
         updated_at
       FROM jobs
       WHERE job_id = :job_id
         AND status = 'running'
         AND updated_at = :updated_at`,
      {
        job_id: candidate.job_id,
        updated_at: nowIso,
      },
    );
  }

  async resetRunningJobs(
    jobType: JobRow["job_type"],
    updatedBeforeIso: string,
    resetAtIso: string,
  ): Promise<number> {
    const staleJobs = await this.db.all<{ job_id: string }>(
      `SELECT job_id
       FROM jobs
       WHERE job_type = :job_type
         AND status = 'running'
         AND updated_at < :updated_before`,
      {
        job_type: jobType,
        updated_before: updatedBeforeIso,
      },
    );

    for (const row of staleJobs) {
      await this.db.run(
        `UPDATE jobs
         SET status = 'queued',
             available_at = :available_at,
             updated_at = :updated_at
         WHERE job_id = :job_id
           AND status = 'running'`,
        {
          job_id: row.job_id,
          available_at: resetAtIso,
          updated_at: resetAtIso,
        },
      );
    }

    return staleJobs.length;
  }

  listCommunitiesRequiringRegistryAttention(): Promise<CommunityRow[]> {
    return this.db.all<CommunityRow>(
      `SELECT
         community_id,
         creator_user_id,
         display_name,
         membership_mode,
         status,
         provisioning_state,
         transfer_state,
         registry_publication_state,
         registry_attempt_id,
         registry_published_at,
         registry_publication_job_id,
         registry_error_code,
         route_slug,
         namespace_verification_id,
         primary_database_binding_id,
         created_at,
         updated_at
       FROM communities
       WHERE registry_publication_state IN ('pending_create', 'pending_seed', 'stale', 'publication_error')
       ORDER BY updated_at DESC, community_id DESC`,
      {},
    );
  }
}

class SqlAuthBootstrapTx extends SqlAuthBootstrapQueries implements AuthBootstrapTx {
  async insertUser(input: InsertUserInput): Promise<void> {
    try {
      await this.db.run(
        `INSERT INTO users (
           user_id,
           primary_wallet_attachment_id,
           verification_state,
           capability_provider,
           verification_capabilities_json,
           verified_at,
           nationality,
           current_verification_session_id,
           created_at,
           updated_at
         ) VALUES (
           :user_id,
           NULL,
           'unverified',
           NULL,
           :verification_capabilities_json,
           NULL,
           NULL,
           NULL,
           :created_at,
           :updated_at
         )`,
        input,
      );
    } catch (error) {
      rethrowSqlError(error);
    }
  }

  async insertGlobalHandle(input: InsertGlobalHandleInput): Promise<void> {
    try {
      await this.db.run(
        `INSERT INTO global_handles (
           global_handle_id,
           user_id,
           label_normalized,
           label_display,
           status,
           tier,
           issuance_source,
           redirect_target_global_handle_id,
           price_paid_usd,
           free_rename_consumed,
           issued_at,
           replaced_at,
           created_at,
           updated_at
         ) VALUES (
           :global_handle_id,
           :user_id,
           :label_normalized,
           :label_display,
           'active',
           'generated',
           'generated_signup',
           NULL,
           NULL,
           0,
           :issued_at,
           NULL,
           :created_at,
           :updated_at
         )`,
        input,
      );
    } catch (error) {
      rethrowSqlError(error);
    }
  }

  async updateUserVerification(input: UpdateUserVerificationInput): Promise<void> {
    await this.db.run(
      `UPDATE users
       SET verification_state = :verification_state,
           capability_provider = :capability_provider,
           verification_capabilities_json = :verification_capabilities_json,
           verified_at = :verified_at,
           nationality = :nationality,
           current_verification_session_id = :current_verification_session_id,
           updated_at = :updated_at
       WHERE user_id = :user_id`,
      input,
    );
  }

  async insertProfile(input: InsertProfileInput): Promise<void> {
    await this.db.run(
      `INSERT INTO profiles (
         user_id,
         display_name,
         bio,
         avatar_ref,
         cover_ref,
         global_handle_id,
         created_at,
         updated_at
       ) VALUES (
         :user_id,
         NULL,
         NULL,
         NULL,
         NULL,
         :global_handle_id,
         :created_at,
         :updated_at
       )`,
      input,
    );
  }

  async updateProfile(input: UpdateProfileInput): Promise<void> {
    await this.db.run(
      `UPDATE profiles
       SET display_name = :display_name,
           bio = :bio,
           avatar_ref = :avatar_ref,
           updated_at = :updated_at
       WHERE user_id = :user_id`,
      input,
    );
  }

  async updateUserPrimaryWalletAttachment(input: UpdateUserPrimaryWalletAttachmentInput): Promise<void> {
    await this.db.run(
      `UPDATE users
       SET primary_wallet_attachment_id = :primary_wallet_attachment_id,
           updated_at = :updated_at
       WHERE user_id = :user_id`,
      input,
    );
  }

  async insertDeviceSession(input: InsertDeviceSessionInput): Promise<void> {
    await this.db.run(
      `INSERT INTO device_sessions (
         device_session_id,
         device_code,
         user_code,
         authorized_user_id,
         status,
         client_name,
         created_at,
         updated_at,
         expires_at,
         authorized_at,
         completed_at
       ) VALUES (
         :device_session_id,
         :device_code,
         :user_code,
         :authorized_user_id,
         :status,
         :client_name,
         :created_at,
         :updated_at,
         :expires_at,
         :authorized_at,
         :completed_at
       )`,
      input,
    );
  }

  async updateDeviceSession(input: InsertDeviceSessionInput): Promise<void> {
    await this.db.run(
      `UPDATE device_sessions
       SET device_code = :device_code,
           user_code = :user_code,
           authorized_user_id = :authorized_user_id,
           status = :status,
           client_name = :client_name,
           updated_at = :updated_at,
           expires_at = :expires_at,
           authorized_at = :authorized_at,
           completed_at = :completed_at
       WHERE device_session_id = :device_session_id`,
      input,
    );
  }

  async insertAuthProviderLink(input: InsertAuthProviderLinkInput): Promise<void> {
    try {
      await this.db.run(
        `INSERT INTO auth_provider_links (
           auth_provider_link_id,
           user_id,
           provider,
           provider_subject,
           provider_user_ref,
           status,
           linked_at,
           revoked_at,
           created_at,
           updated_at
         ) VALUES (
           :auth_provider_link_id,
           :user_id,
           :provider,
           :provider_subject,
           :provider_user_ref,
           'active',
           :linked_at,
           NULL,
           :created_at,
           :updated_at
         )`,
        input,
      );
    } catch (error) {
      rethrowSqlError(error);
    }
  }

  async insertWalletAttachment(input: InsertWalletAttachmentInput): Promise<void> {
    try {
      await this.db.run(
        `INSERT INTO wallet_attachments (
           wallet_attachment_id,
           user_id,
           chain_namespace,
           wallet_address_normalized,
           wallet_address_display,
           source_provider,
           source_subject,
           attachment_kind,
           is_primary,
           status,
           attached_at,
           detached_at,
           created_at,
           updated_at
         ) VALUES (
           :wallet_attachment_id,
           :user_id,
           :chain_namespace,
           :wallet_address_normalized,
           :wallet_address_display,
           :source_provider,
           :source_subject,
           :attachment_kind,
           :is_primary,
           :status,
           :attached_at,
           :detached_at,
           :created_at,
           :updated_at
         )`,
        input,
      );
    } catch (error) {
      rethrowSqlError(error);
    }
  }

  async insertVerificationSession(input: InsertVerificationSessionInput): Promise<void> {
    await this.db.run(
      `INSERT INTO verification_sessions (
         verification_session_id,
         user_id,
         provider,
         session_kind,
         requested_capabilities_json,
         status,
         upstream_session_ref,
         result_ref,
         failure_code,
         started_at,
         completed_at,
         expires_at,
         created_at,
         updated_at
       ) VALUES (
         :verification_session_id,
         :user_id,
         :provider,
         :session_kind,
         :requested_capabilities_json,
         :status,
         :upstream_session_ref,
         :result_ref,
         :failure_code,
         :started_at,
         :completed_at,
         :expires_at,
         :created_at,
         :updated_at
       )`,
      input,
    );
  }

  async updateVerificationSession(input: InsertVerificationSessionInput): Promise<void> {
    await this.db.run(
      `UPDATE verification_sessions
       SET user_id = :user_id,
           provider = :provider,
           session_kind = :session_kind,
           requested_capabilities_json = :requested_capabilities_json,
           status = :status,
           upstream_session_ref = :upstream_session_ref,
           result_ref = :result_ref,
           failure_code = :failure_code,
           started_at = :started_at,
           completed_at = :completed_at,
           expires_at = :expires_at,
           updated_at = :updated_at
       WHERE verification_session_id = :verification_session_id`,
      input,
    );
  }

  async insertRedditVerificationSession(input: InsertRedditVerificationSessionInput): Promise<void> {
    await this.db.run(
      `INSERT INTO reddit_verification_sessions (
         reddit_verification_session_id,
         user_id,
         reddit_username,
         verification_code,
         code_placement_surface,
         status,
         verification_hint,
         failure_code,
         checked_count,
         last_checked_at,
         verified_at,
         expires_at,
         created_at,
         updated_at
       ) VALUES (
         :reddit_verification_session_id,
         :user_id,
         :reddit_username,
         :verification_code,
         :code_placement_surface,
         :status,
         :verification_hint,
         :failure_code,
         :checked_count,
         :last_checked_at,
         :verified_at,
         :expires_at,
         :created_at,
         :updated_at
       )`,
      input,
    );
  }

  async updateRedditVerificationSession(input: InsertRedditVerificationSessionInput): Promise<void> {
    await this.db.run(
      `UPDATE reddit_verification_sessions
       SET user_id = :user_id,
           reddit_username = :reddit_username,
           verification_code = :verification_code,
           code_placement_surface = :code_placement_surface,
           status = :status,
           verification_hint = :verification_hint,
           failure_code = :failure_code,
           checked_count = :checked_count,
           last_checked_at = :last_checked_at,
           verified_at = :verified_at,
           expires_at = :expires_at,
           updated_at = :updated_at
       WHERE reddit_verification_session_id = :reddit_verification_session_id`,
      input,
    );
  }

  async insertExternalReputationSnapshot(input: InsertExternalReputationSnapshotInput): Promise<void> {
    await this.db.run(
      `INSERT INTO external_reputation_snapshots (
         external_reputation_snapshot_id,
         user_id,
         source_platform,
         snapshot_type,
         source_account_handle,
         proof_method,
         captured_at,
         snapshot_payload_json,
         created_at,
         updated_at
       ) VALUES (
         :external_reputation_snapshot_id,
         :user_id,
         :source_platform,
         :snapshot_type,
         :source_account_handle,
         :proof_method,
         :captured_at,
         :snapshot_payload_json,
         :created_at,
         :updated_at
       )`,
      input,
    );
  }

  async deleteUserRedditSubredditAffinitiesForSnapshot(snapshotId: string): Promise<void> {
    await this.db.run(
      `DELETE FROM user_reddit_subreddit_affinities
       WHERE source_snapshot_id = :source_snapshot_id`,
      {
        source_snapshot_id: snapshotId,
      },
    );
  }

  async deleteUserInterestTagsForSnapshot(snapshotId: string): Promise<void> {
    await this.db.run(
      `DELETE FROM user_interest_tags
       WHERE source_snapshot_id = :source_snapshot_id`,
      {
        source_snapshot_id: snapshotId,
      },
    );
  }

  async deleteUserAudienceSegmentsForSnapshot(snapshotId: string): Promise<void> {
    await this.db.run(
      `DELETE FROM user_audience_segments
       WHERE source_snapshot_id = :source_snapshot_id`,
      {
        source_snapshot_id: snapshotId,
      },
    );
  }

  async deleteUserRedditFeatureProfilesForSnapshot(snapshotId: string): Promise<void> {
    await this.db.run(
      `DELETE FROM user_reddit_feature_profiles
       WHERE source_snapshot_id = :source_snapshot_id`,
      {
        source_snapshot_id: snapshotId,
      },
    );
  }

  async upsertUserRedditSubredditAffinity(input: UpsertUserRedditSubredditAffinityInput): Promise<void> {
    await this.db.run(
      `INSERT INTO user_reddit_subreddit_affinities (
         affinity_id,
         user_id,
         source_snapshot_id,
         subreddit,
         post_count,
         comment_count,
         post_score,
         comment_score,
         total_score,
         first_seen_at,
         last_seen_at,
         weight,
         feature_version,
         derived_at,
         created_at,
         updated_at
       ) VALUES (
         :affinity_id,
         :user_id,
         :source_snapshot_id,
         :subreddit,
         :post_count,
         :comment_count,
         :post_score,
         :comment_score,
         :total_score,
         :first_seen_at,
         :last_seen_at,
         :weight,
         :feature_version,
         :derived_at,
         :created_at,
         :updated_at
       )
       ON CONFLICT (user_id, source_snapshot_id, subreddit) DO UPDATE SET
         post_count = EXCLUDED.post_count,
         comment_count = EXCLUDED.comment_count,
         post_score = EXCLUDED.post_score,
         comment_score = EXCLUDED.comment_score,
         total_score = EXCLUDED.total_score,
         first_seen_at = EXCLUDED.first_seen_at,
         last_seen_at = EXCLUDED.last_seen_at,
         weight = EXCLUDED.weight,
         feature_version = EXCLUDED.feature_version,
         derived_at = EXCLUDED.derived_at,
         updated_at = EXCLUDED.updated_at`,
      input,
    );
  }

  async upsertUserInterestTag(input: UpsertUserInterestTagInput): Promise<void> {
    await this.db.run(
      `INSERT INTO user_interest_tags (
         interest_tag_id,
         user_id,
         source_snapshot_id,
         tag,
         source,
         confidence,
         weight,
         evidence_json,
         feature_version,
         derived_at,
         created_at,
         updated_at
       ) VALUES (
         :interest_tag_id,
         :user_id,
         :source_snapshot_id,
         :tag,
         :source,
         :confidence,
         :weight,
         :evidence_json,
         :feature_version,
         :derived_at,
         :created_at,
         :updated_at
       )
       ON CONFLICT (user_id, source_snapshot_id, tag, source) DO UPDATE SET
         confidence = EXCLUDED.confidence,
         weight = EXCLUDED.weight,
         evidence_json = EXCLUDED.evidence_json,
         feature_version = EXCLUDED.feature_version,
         derived_at = EXCLUDED.derived_at,
         updated_at = EXCLUDED.updated_at`,
      input,
    );
  }

  async upsertUserAudienceSegment(input: UpsertUserAudienceSegmentInput): Promise<void> {
    await this.db.run(
      `INSERT INTO user_audience_segments (
         audience_segment_id,
         user_id,
         source_snapshot_id,
         segment_key,
         source,
         confidence,
         eligibility_state,
         evidence_json,
         derivation_version,
         derived_at,
         expires_at,
         created_at,
         updated_at
       ) VALUES (
         :audience_segment_id,
         :user_id,
         :source_snapshot_id,
         :segment_key,
         :source,
         :confidence,
         :eligibility_state,
         :evidence_json,
         :derivation_version,
         :derived_at,
         :expires_at,
         :created_at,
         :updated_at
       )
       ON CONFLICT (user_id, source_snapshot_id, segment_key, source) DO UPDATE SET
         confidence = EXCLUDED.confidence,
         eligibility_state = EXCLUDED.eligibility_state,
         evidence_json = EXCLUDED.evidence_json,
         derivation_version = EXCLUDED.derivation_version,
         derived_at = EXCLUDED.derived_at,
         expires_at = EXCLUDED.expires_at,
         updated_at = EXCLUDED.updated_at`,
      input,
    );
  }

  async upsertUserRedditFeatureProfile(input: UpsertUserRedditFeatureProfileInput): Promise<void> {
    await this.db.run(
      `INSERT INTO user_reddit_feature_profiles (
         feature_profile_id,
         user_id,
         source_snapshot_id,
         source,
         profile_json,
         confidence,
         feature_version,
         derived_at,
         created_at,
         updated_at
       ) VALUES (
         :feature_profile_id,
         :user_id,
         :source_snapshot_id,
         :source,
         :profile_json,
         :confidence,
         :feature_version,
         :derived_at,
         :created_at,
         :updated_at
       )
       ON CONFLICT (user_id, source_snapshot_id, source, feature_version) DO UPDATE SET
         profile_json = EXCLUDED.profile_json,
         confidence = EXCLUDED.confidence,
         derived_at = EXCLUDED.derived_at,
         updated_at = EXCLUDED.updated_at`,
      input,
    );
  }

  async insertNamespaceVerificationSession(input: InsertNamespaceVerificationSessionInput): Promise<void> {
    await this.db.run(
      `INSERT INTO namespace_verification_sessions (
         namespace_verification_session_id,
         namespace_verification_id,
         user_id,
         family,
         submitted_root_label,
         normalized_root_label,
         status,
         challenge_host,
         challenge_txt_value,
         challenge_expires_at,
         root_exists,
         root_control_verified,
         expiry_horizon_sufficient,
         routing_enabled,
         pirate_dns_authority_verified,
         club_attach_allowed,
         pirate_web_routing_allowed,
         pirate_subdomain_issuance_allowed,
         control_class,
         operation_class,
         observation_provider,
         evidence_bundle_ref,
         failure_reason,
         accepted_at,
         expires_at,
         created_at,
         updated_at
       ) VALUES (
         :namespace_verification_session_id,
         :namespace_verification_id,
         :user_id,
         :family,
         :submitted_root_label,
         :normalized_root_label,
         :status,
         :challenge_host,
         :challenge_txt_value,
         :challenge_expires_at,
         :root_exists,
         :root_control_verified,
         :expiry_horizon_sufficient,
         :routing_enabled,
         :pirate_dns_authority_verified,
         :club_attach_allowed,
         :pirate_web_routing_allowed,
         :pirate_subdomain_issuance_allowed,
         :control_class,
         :operation_class,
         :observation_provider,
         :evidence_bundle_ref,
         :failure_reason,
         :accepted_at,
         :expires_at,
         :created_at,
         :updated_at
       )`,
      input,
    );
  }

  async updateNamespaceVerificationSession(input: InsertNamespaceVerificationSessionInput): Promise<void> {
    await this.db.run(
      `UPDATE namespace_verification_sessions
       SET namespace_verification_id = :namespace_verification_id,
           user_id = :user_id,
           family = :family,
           submitted_root_label = :submitted_root_label,
           normalized_root_label = :normalized_root_label,
           status = :status,
           challenge_host = :challenge_host,
           challenge_txt_value = :challenge_txt_value,
           challenge_expires_at = :challenge_expires_at,
           root_exists = :root_exists,
           root_control_verified = :root_control_verified,
           expiry_horizon_sufficient = :expiry_horizon_sufficient,
           routing_enabled = :routing_enabled,
           pirate_dns_authority_verified = :pirate_dns_authority_verified,
           club_attach_allowed = :club_attach_allowed,
           pirate_web_routing_allowed = :pirate_web_routing_allowed,
           pirate_subdomain_issuance_allowed = :pirate_subdomain_issuance_allowed,
           control_class = :control_class,
           operation_class = :operation_class,
           observation_provider = :observation_provider,
           evidence_bundle_ref = :evidence_bundle_ref,
           failure_reason = :failure_reason,
           accepted_at = :accepted_at,
           expires_at = :expires_at,
           updated_at = :updated_at
       WHERE namespace_verification_session_id = :namespace_verification_session_id`,
      input,
    );
  }

  async insertNamespaceVerification(input: InsertNamespaceVerificationInput): Promise<void> {
    await this.db.run(
      `INSERT INTO namespace_verifications (
         namespace_verification_id,
         source_namespace_verification_session_id,
         user_id,
         family,
         normalized_root_label,
         status,
         root_exists,
         root_control_verified,
         expiry_horizon_sufficient,
         routing_enabled,
         pirate_dns_authority_verified,
         club_attach_allowed,
         pirate_web_routing_allowed,
         pirate_subdomain_issuance_allowed,
         control_class,
         operation_class,
         observation_provider,
         evidence_bundle_ref,
         accepted_at,
         expires_at,
         created_at,
         updated_at
       ) VALUES (
         :namespace_verification_id,
         :source_namespace_verification_session_id,
         :user_id,
         :family,
         :normalized_root_label,
         :status,
         :root_exists,
         :root_control_verified,
         :expiry_horizon_sufficient,
         :routing_enabled,
         :pirate_dns_authority_verified,
         :club_attach_allowed,
         :pirate_web_routing_allowed,
         :pirate_subdomain_issuance_allowed,
         :control_class,
         :operation_class,
         :observation_provider,
         :evidence_bundle_ref,
         :accepted_at,
         :expires_at,
         :created_at,
         :updated_at
       )`,
      input,
    );
  }

  async insertCommunity(input: InsertCommunityInput): Promise<void> {
    try {
      await this.db.run(
        `INSERT INTO communities (
           community_id,
           creator_user_id,
           display_name,
           membership_mode,
           status,
           provisioning_state,
           transfer_state,
           registry_publication_state,
           registry_attempt_id,
           registry_published_at,
           registry_publication_job_id,
           registry_error_code,
           route_slug,
           namespace_verification_id,
           primary_database_binding_id,
           created_at,
           updated_at
         ) VALUES (
           :community_id,
           :creator_user_id,
           :display_name,
           :membership_mode,
           :status,
           :provisioning_state,
           :transfer_state,
           :registry_publication_state,
           :registry_attempt_id,
           :registry_published_at,
           :registry_publication_job_id,
           :registry_error_code,
           :route_slug,
           :namespace_verification_id,
           :primary_database_binding_id,
           :created_at,
           :updated_at
         )`,
        {
          ...input,
          registry_publication_state: input.registry_publication_state ?? "not_started",
          registry_attempt_id: input.registry_attempt_id ?? null,
          registry_published_at: input.registry_published_at ?? null,
          registry_publication_job_id: input.registry_publication_job_id ?? null,
          registry_error_code: input.registry_error_code ?? null,
        },
      );
    } catch (error) {
      rethrowSqlError(error);
    }
  }

  async insertCommunityRegistryAttempt(input: InsertCommunityRegistryAttemptInput): Promise<void> {
    await this.db.run(
      `INSERT INTO community_registry_attempts (
         registry_attempt_id,
         actor_user_id,
         actor_primary_wallet_snapshot,
         actor_governance_address_snapshot,
         namespace_verification_id,
         normalized_root_label,
         community_id,
         attempt_status,
         failure_code,
         created_at,
         updated_at
       ) VALUES (
         :registry_attempt_id,
         :actor_user_id,
         :actor_primary_wallet_snapshot,
         :actor_governance_address_snapshot,
         :namespace_verification_id,
         :normalized_root_label,
         :community_id,
         :attempt_status,
         :failure_code,
         :created_at,
         :updated_at
       )`,
      input,
    );
  }

  async updateCommunityRegistryAttempt(input: UpdateCommunityRegistryAttemptInput): Promise<void> {
    await this.db.run(
      `UPDATE community_registry_attempts
       SET community_id = :community_id,
           attempt_status = :attempt_status,
           failure_code = :failure_code,
           updated_at = :updated_at
       WHERE registry_attempt_id = :registry_attempt_id`,
      input,
    );
  }

  async upsertCommunityRegistryTableRef(input: UpsertCommunityRegistryTableRefInput): Promise<void> {
    await this.db.run(
      `INSERT INTO community_registry_table_refs (
         community_id,
         tableland_chain_id,
         attempts_table_name,
         club_registry_table_name,
         club_namespace_table_name,
         publisher_kind,
         last_published_snapshot_hash,
         last_publish_attempted_at,
         last_publish_succeeded_at,
         created_at,
         updated_at
       ) VALUES (
         :community_id,
         :tableland_chain_id,
         :attempts_table_name,
         :club_registry_table_name,
         :club_namespace_table_name,
         :publisher_kind,
         :last_published_snapshot_hash,
         :last_publish_attempted_at,
         :last_publish_succeeded_at,
         :created_at,
         :updated_at
       )
       ON CONFLICT(community_id) DO UPDATE SET
         tableland_chain_id = excluded.tableland_chain_id,
         attempts_table_name = excluded.attempts_table_name,
         club_registry_table_name = excluded.club_registry_table_name,
         club_namespace_table_name = excluded.club_namespace_table_name,
         publisher_kind = excluded.publisher_kind,
         last_published_snapshot_hash = excluded.last_published_snapshot_hash,
         last_publish_attempted_at = excluded.last_publish_attempted_at,
         last_publish_succeeded_at = excluded.last_publish_succeeded_at,
         updated_at = excluded.updated_at`,
      input,
    );
  }

  async updateCommunityRegistryState(input: UpdateCommunityRegistryStateInput): Promise<void> {
    const assignments = [
      input.provisioning_state !== undefined ? `provisioning_state = :provisioning_state` : null,
      input.registry_publication_state !== undefined
        ? `registry_publication_state = :registry_publication_state`
        : null,
      input.registry_attempt_id !== undefined ? `registry_attempt_id = :registry_attempt_id` : null,
      input.registry_published_at !== undefined ? `registry_published_at = :registry_published_at` : null,
      input.registry_publication_job_id !== undefined
        ? `registry_publication_job_id = :registry_publication_job_id`
        : null,
      input.registry_error_code !== undefined ? `registry_error_code = :registry_error_code` : null,
      input.primary_database_binding_id !== undefined
        ? `primary_database_binding_id = :primary_database_binding_id`
        : null,
      `updated_at = :updated_at`,
    ].filter(Boolean);

    await this.db.run(
      `UPDATE communities
       SET ${assignments.join(", ")}
       WHERE community_id = :community_id`,
      input,
    );
  }

  async insertCommunityDatabaseBinding(input: InsertCommunityDatabaseBindingInput): Promise<void> {
    await this.db.run(
      `INSERT INTO community_database_bindings (
         community_database_binding_id,
         community_id,
         binding_role,
         organization_slug,
         group_name,
         group_id,
         database_name,
         database_id,
         database_url,
         location,
         status,
         transferred_at,
         created_at,
         updated_at
       ) VALUES (
         :community_database_binding_id,
         :community_id,
         :binding_role,
         :organization_slug,
         :group_name,
         :group_id,
         :database_name,
         :database_id,
         :database_url,
         :location,
         :status,
         :transferred_at,
         :created_at,
         :updated_at
       )`,
      input,
    );
  }

  async upsertCommunityMoneyPolicy(input: UpsertCommunityMoneyPolicyInput): Promise<void> {
    await this.db.run(
      `INSERT INTO community_money_policies (
         community_id,
         funding_preference,
         accepted_funding_assets_json,
         accepted_source_chains_json,
         approved_route_providers_json,
         destination_settlement_chain_json,
         destination_settlement_token,
         treasury_denomination,
         max_slippage_bps,
         quote_ttl_seconds,
         route_required,
         route_status_policy,
         route_hop_tolerance,
         updated_at
       ) VALUES (
         :community_id,
         :funding_preference,
         :accepted_funding_assets_json,
         :accepted_source_chains_json,
         :approved_route_providers_json,
         :destination_settlement_chain_json,
         :destination_settlement_token,
         :treasury_denomination,
         :max_slippage_bps,
         :quote_ttl_seconds,
         :route_required,
         :route_status_policy,
         :route_hop_tolerance,
         :updated_at
       )
       ON CONFLICT(community_id) DO UPDATE SET
         funding_preference = excluded.funding_preference,
         accepted_funding_assets_json = excluded.accepted_funding_assets_json,
         accepted_source_chains_json = excluded.accepted_source_chains_json,
         approved_route_providers_json = excluded.approved_route_providers_json,
         destination_settlement_chain_json = excluded.destination_settlement_chain_json,
         destination_settlement_token = excluded.destination_settlement_token,
         treasury_denomination = excluded.treasury_denomination,
         max_slippage_bps = excluded.max_slippage_bps,
         quote_ttl_seconds = excluded.quote_ttl_seconds,
         route_required = excluded.route_required,
         route_status_policy = excluded.route_status_policy,
         route_hop_tolerance = excluded.route_hop_tolerance,
         updated_at = excluded.updated_at`,
      input,
    );
  }

  async insertJob(input: InsertJobInput): Promise<void> {
    await this.db.run(
      `INSERT INTO jobs (
         job_id,
         job_type,
         job_scope,
         community_id,
         subject_type,
         subject_id,
         status,
         payload_json,
         result_ref,
         error_code,
         attempt_count,
         available_at,
         created_at,
         updated_at
       ) VALUES (
         :job_id,
         :job_type,
         :job_scope,
         :community_id,
         :subject_type,
         :subject_id,
         :status,
         :payload_json,
         :result_ref,
         :error_code,
         :attempt_count,
         :available_at,
         :created_at,
         :updated_at
       )`,
      input,
    );
  }

  async updateJobStatus(input: UpdateJobStatusInput): Promise<void> {
    await this.db.run(
      `UPDATE jobs
       SET status = :status,
           result_ref = :result_ref,
           error_code = :error_code,
           available_at = :available_at,
           updated_at = :updated_at
       WHERE job_id = :job_id`,
      input,
    );
  }

  async insertCommunityPostProjection(input: InsertCommunityPostProjectionInput): Promise<void> {
    await this.db.run(
      `INSERT INTO community_post_projections (
         projection_id,
         community_id,
         source_post_id,
         author_user_id,
         identity_mode,
         post_type,
         status,
         source_created_at,
         projected_payload_json,
         projection_version,
         created_at,
         updated_at
       ) VALUES (
         :projection_id,
         :community_id,
         :source_post_id,
         :author_user_id,
         :identity_mode,
         :post_type,
         :status,
         :source_created_at,
         :projected_payload_json,
         :projection_version,
         :created_at,
         :updated_at
       )`,
      input,
    );
  }

  async upsertCommunityMembershipProjection(input: UpsertCommunityMembershipProjectionInput): Promise<void> {
    await this.db.run(
      `INSERT INTO community_membership_projections (
         projection_id,
         community_id,
         user_id,
         membership_state,
         role_summary_json,
         source_updated_at,
         created_at,
         updated_at
       ) VALUES (
         :projection_id,
         :community_id,
         :user_id,
         :membership_state,
         :role_summary_json,
         :source_updated_at,
         :created_at,
         :updated_at
       )
       ON CONFLICT (community_id, user_id) DO UPDATE SET
         membership_state = EXCLUDED.membership_state,
         role_summary_json = EXCLUDED.role_summary_json,
         source_updated_at = EXCLUDED.source_updated_at,
         updated_at = EXCLUDED.updated_at`,
      input,
    );
  }

  async insertCommunityMembershipRequest(input: InsertCommunityMembershipRequestInput): Promise<void> {
    await this.db.run(
      `INSERT INTO community_membership_requests (
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
         :status,
         :note,
         :reviewed_by_user_id,
         :review_reason,
         :resolved_at,
         :expires_at,
         :created_at,
         :updated_at
       )`,
      input,
    );
  }

  async updateCommunityMembershipRequest(input: UpdateCommunityMembershipRequestInput): Promise<void> {
    await this.db.run(
      `UPDATE community_membership_requests
       SET status = :status,
           reviewed_by_user_id = :reviewed_by_user_id,
           review_reason = :review_reason,
           resolved_at = :resolved_at,
           updated_at = :updated_at
       WHERE membership_request_id = :membership_request_id`,
      input,
    );
  }

  async upsertCommunityGateRule(input: UpsertCommunityGateRuleInput): Promise<void> {
    await this.db.run(
      `INSERT INTO community_gate_rules (
         gate_rule_id,
         community_id,
         scope,
         gate_family,
         gate_type,
         proof_requirements_json,
         chain_namespace,
         gate_config_json,
         status,
         created_at,
         updated_at
       ) VALUES (
         :gate_rule_id,
         :community_id,
         :scope,
         :gate_family,
         :gate_type,
         :proof_requirements_json,
         :chain_namespace,
         :gate_config_json,
         :status,
         :created_at,
         :updated_at
       )
       ON CONFLICT (gate_rule_id) DO UPDATE SET
         scope = EXCLUDED.scope,
         gate_family = EXCLUDED.gate_family,
         gate_type = EXCLUDED.gate_type,
         proof_requirements_json = EXCLUDED.proof_requirements_json,
         chain_namespace = EXCLUDED.chain_namespace,
         gate_config_json = EXCLUDED.gate_config_json,
         status = EXCLUDED.status,
         updated_at = EXCLUDED.updated_at`,
      input,
    );
  }

  async insertAuditLog(input: InsertAuditLogInput): Promise<void> {
    await this.db.run(
      `INSERT INTO audit_log (
         audit_event_id,
         actor_type,
         actor_id,
         action,
         target_type,
         target_id,
         community_id,
         metadata_json,
         created_at
       ) VALUES (
         :audit_event_id,
         :actor_type,
         :actor_id,
         :action,
         :target_type,
         :target_id,
         :community_id,
         :metadata_json,
         :created_at
       )`,
      input,
    );
  }
}

export class SqlAuthBootstrapStore extends SqlAuthBootstrapQueries implements AuthBootstrapStore {
  constructor(private readonly executor: TransactionalSqlExecutor) {
    super(executor);
  }

  withTransaction<T>(fn: (tx: AuthBootstrapTx) => Promise<T>): Promise<T> {
    return this.executor.transaction((tx) => fn(new SqlAuthBootstrapTx(tx)));
  }
}
