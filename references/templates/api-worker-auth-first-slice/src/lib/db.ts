import type {
  AuthProviderLinkRow,
  CommunityDatabaseBindingRow,
  CommunityGateRuleRow,
  CommunityMembershipRequestRow,
  CommunityMembershipProjectionRow,
  CommunityRegistryAttemptRow,
  CommunityRegistryTableRefRow,
  CommunityRow,
  CommunityMoneyPolicyRow,
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

export type InsertUserInput = {
  user_id: string;
  verification_capabilities_json: string;
  created_at: string;
  updated_at: string;
};

export type InsertGlobalHandleInput = {
  global_handle_id: string;
  user_id: string;
  label_normalized: string;
  label_display: string;
  issued_at: string;
  created_at: string;
  updated_at: string;
};

export type InsertProfileInput = {
  user_id: string;
  global_handle_id: string;
  created_at: string;
  updated_at: string;
};

export type InsertAuthProviderLinkInput = {
  auth_provider_link_id: string;
  user_id: string;
  provider: string;
  provider_subject: string;
  provider_user_ref: string | null;
  linked_at: string;
  created_at: string;
  updated_at: string;
};

export type InsertWalletAttachmentInput = {
  wallet_attachment_id: string;
  user_id: string;
  chain_namespace: string;
  wallet_address_normalized: string;
  wallet_address_display: string;
  source_provider: string | null;
  source_subject: string | null;
  attachment_kind: "embedded" | "external" | "delegated";
  is_primary: 0 | 1;
  status: WalletAttachmentRow["status"];
  attached_at: string;
  detached_at: string | null;
  created_at: string;
  updated_at: string;
};

export type InsertCommunityInput = {
  community_id: string;
  creator_user_id: string;
  display_name: string;
  membership_mode: CommunityRow["membership_mode"];
  status: CommunityRow["status"];
  provisioning_state: CommunityRow["provisioning_state"];
  transfer_state: CommunityRow["transfer_state"];
  registry_publication_state?: CommunityRow["registry_publication_state"];
  registry_attempt_id?: string | null;
  registry_published_at?: string | null;
  registry_publication_job_id?: string | null;
  registry_error_code?: string | null;
  route_slug: string | null;
  namespace_verification_id: string;
  primary_database_binding_id: string | null;
  created_at: string;
  updated_at: string;
};

export type InsertVerificationSessionInput = {
  verification_session_id: string;
  user_id: string;
  provider: "self" | "very";
  session_kind: string;
  requested_capabilities_json: string;
  status: VerificationSessionRow["status"];
  upstream_session_ref: string | null;
  result_ref: string | null;
  failure_code: string | null;
  started_at: string;
  completed_at: string | null;
  expires_at: string | null;
  created_at: string;
  updated_at: string;
};

export type InsertRedditVerificationSessionInput = {
  reddit_verification_session_id: string;
  user_id: string;
  reddit_username: string;
  verification_code: string;
  code_placement_surface: RedditVerificationSessionRow["code_placement_surface"];
  status: RedditVerificationSessionRow["status"];
  verification_hint: string | null;
  failure_code: RedditVerificationSessionRow["failure_code"];
  checked_count: number;
  last_checked_at: string | null;
  verified_at: string | null;
  expires_at: string;
  created_at: string;
  updated_at: string;
};

export type InsertExternalReputationSnapshotInput = {
  external_reputation_snapshot_id: string;
  user_id: string;
  source_platform: ExternalReputationSnapshotRow["source_platform"];
  snapshot_type: ExternalReputationSnapshotRow["snapshot_type"];
  source_account_handle: string;
  proof_method: ExternalReputationSnapshotRow["proof_method"];
  captured_at: string;
  snapshot_payload_json: string;
  created_at: string;
  updated_at: string;
};

export type UpsertUserRedditSubredditAffinityInput = {
  affinity_id: string;
  user_id: string;
  source_snapshot_id: string;
  subreddit: string;
  post_count: number;
  comment_count: number;
  post_score: number;
  comment_score: number;
  total_score: number;
  first_seen_at: string | null;
  last_seen_at: string | null;
  weight: number;
  feature_version: string;
  derived_at: string;
  created_at: string;
  updated_at: string;
};

export type UpsertUserInterestTagInput = {
  interest_tag_id: string;
  user_id: string;
  source_snapshot_id: string;
  tag: string;
  source: UserInterestTagRow["source"];
  confidence: number;
  weight: number;
  evidence_json: string | null;
  feature_version: string;
  derived_at: string;
  created_at: string;
  updated_at: string;
};

export type UpsertUserAudienceSegmentInput = {
  audience_segment_id: string;
  user_id: string;
  source_snapshot_id: string;
  segment_key: string;
  source: UserAudienceSegmentRow["source"];
  confidence: number;
  eligibility_state: UserAudienceSegmentRow["eligibility_state"];
  evidence_json: string | null;
  derivation_version: string;
  derived_at: string;
  expires_at: string | null;
  created_at: string;
  updated_at: string;
};

export type UpsertUserRedditFeatureProfileInput = {
  feature_profile_id: string;
  user_id: string;
  source_snapshot_id: string;
  source: UserRedditFeatureProfileRow["source"];
  profile_json: string;
  confidence: number;
  feature_version: string;
  derived_at: string;
  created_at: string;
  updated_at: string;
};

export type UpdateUserVerificationInput = {
  user_id: string;
  verification_state: UserRow["verification_state"];
  capability_provider: UserRow["capability_provider"];
  verification_capabilities_json: string;
  verified_at: string | null;
  nationality: string | null;
  current_verification_session_id: string | null;
  updated_at: string;
};

export type UpdateUserPrimaryWalletAttachmentInput = {
  user_id: string;
  primary_wallet_attachment_id: string | null;
  updated_at: string;
};

export type InsertNamespaceVerificationSessionInput = {
  namespace_verification_session_id: string;
  namespace_verification_id: string | null;
  user_id: string;
  family: "hns";
  submitted_root_label: string;
  normalized_root_label: string | null;
  status: NamespaceVerificationSessionRow["status"];
  challenge_host: string | null;
  challenge_txt_value: string | null;
  challenge_expires_at: string | null;
  root_exists: 0 | 1 | null;
  root_control_verified: 0 | 1 | null;
  expiry_horizon_sufficient: 0 | 1 | null;
  routing_enabled: 0 | 1 | null;
  pirate_dns_authority_verified: 0 | 1 | null;
  club_attach_allowed: 0 | 1 | null;
  pirate_web_routing_allowed: 0 | 1 | null;
  pirate_subdomain_issuance_allowed: 0 | 1 | null;
  control_class: NamespaceVerificationSessionRow["control_class"];
  operation_class: NamespaceVerificationSessionRow["operation_class"];
  observation_provider: string | null;
  evidence_bundle_ref: string | null;
  failure_reason: string | null;
  accepted_at: string | null;
  expires_at: string;
  created_at: string;
  updated_at: string;
};

export type InsertNamespaceVerificationInput = {
  namespace_verification_id: string;
  source_namespace_verification_session_id: string;
  user_id: string;
  family: "hns";
  normalized_root_label: string;
  status: NamespaceVerificationRow["status"];
  root_exists: 0 | 1;
  root_control_verified: 0 | 1;
  expiry_horizon_sufficient: 0 | 1;
  routing_enabled: 0 | 1;
  pirate_dns_authority_verified: 0 | 1;
  club_attach_allowed: 0 | 1;
  pirate_web_routing_allowed: 0 | 1;
  pirate_subdomain_issuance_allowed: 0 | 1;
  control_class: NamespaceVerificationRow["control_class"];
  operation_class: NamespaceVerificationRow["operation_class"];
  observation_provider: string | null;
  evidence_bundle_ref: string | null;
  accepted_at: string;
  expires_at: string;
  created_at: string;
  updated_at: string;
};

export type UpdateProfileInput = {
  user_id: string;
  display_name: string | null;
  bio: string | null;
  avatar_ref: string | null;
  updated_at: string;
};

export type InsertDeviceSessionInput = {
  device_session_id: string;
  device_code: string;
  user_code: string;
  authorized_user_id: string | null;
  status: DeviceSessionRow["status"];
  client_name: string | null;
  created_at: string;
  updated_at: string;
  expires_at: string;
  authorized_at: string | null;
  completed_at: string | null;
};

export type UpsertCommunityMoneyPolicyInput = {
  community_id: string;
  funding_preference: string;
  accepted_funding_assets_json: string;
  accepted_source_chains_json: string;
  approved_route_providers_json: string | null;
  destination_settlement_chain_json: string;
  destination_settlement_token: string;
  treasury_denomination: string | null;
  max_slippage_bps: number;
  quote_ttl_seconds: number;
  route_required: 0 | 1;
  route_status_policy: CommunityMoneyPolicyRow["route_status_policy"];
  route_hop_tolerance: number;
  updated_at: string;
};

export type InsertJobInput = {
  job_id: string;
  job_type: JobRow["job_type"];
  job_scope: JobRow["job_scope"];
  community_id: string | null;
  subject_type: string;
  subject_id: string;
  status: JobRow["status"];
  payload_json: string | null;
  result_ref: string | null;
  error_code: string | null;
  attempt_count: number;
  available_at: string | null;
  created_at: string;
  updated_at: string;
};

export type InsertCommunityRegistryAttemptInput = {
  registry_attempt_id: string;
  actor_user_id: string;
  actor_primary_wallet_snapshot: string | null;
  actor_governance_address_snapshot: string | null;
  namespace_verification_id: string;
  normalized_root_label: string;
  community_id: string | null;
  attempt_status: CommunityRegistryAttemptRow["attempt_status"];
  failure_code: string | null;
  created_at: string;
  updated_at: string;
};

export type UpdateCommunityRegistryAttemptInput = {
  registry_attempt_id: string;
  community_id: string | null;
  attempt_status: CommunityRegistryAttemptRow["attempt_status"];
  failure_code: string | null;
  updated_at: string;
};

export type UpsertCommunityRegistryTableRefInput = {
  community_id: string;
  tableland_chain_id: number;
  attempts_table_name: string;
  club_registry_table_name: string | null;
  club_namespace_table_name: string | null;
  publisher_kind: CommunityRegistryTableRefRow["publisher_kind"];
  last_published_snapshot_hash: string | null;
  last_publish_attempted_at: string | null;
  last_publish_succeeded_at: string | null;
  created_at: string;
  updated_at: string;
};

export type UpdateCommunityRegistryStateInput = {
  community_id: string;
  provisioning_state?: CommunityRow["provisioning_state"];
  registry_publication_state?: CommunityRow["registry_publication_state"];
  registry_attempt_id?: string | null;
  registry_published_at?: string | null;
  registry_publication_job_id?: string | null;
  registry_error_code?: string | null;
  primary_database_binding_id?: string | null;
  updated_at: string;
};

export type InsertCommunityDatabaseBindingInput = {
  community_database_binding_id: string;
  community_id: string;
  binding_role: CommunityDatabaseBindingRow["binding_role"];
  organization_slug: string;
  group_name: string;
  group_id: string | null;
  database_name: string;
  database_id: string | null;
  database_url: string;
  location: string | null;
  status: CommunityDatabaseBindingRow["status"];
  transferred_at: string | null;
  created_at: string;
  updated_at: string;
};

export type UpdateJobStatusInput = {
  job_id: string;
  status: JobRow["status"];
  result_ref: string | null;
  error_code: string | null;
  available_at: string | null;
  updated_at: string;
};

export type InsertCommunityPostProjectionInput = {
  projection_id: string;
  community_id: string;
  source_post_id: string;
  author_user_id: string | null;
  identity_mode: "public" | "anonymous";
  post_type: "text" | "image" | "video" | "link" | "song";
  status: "draft" | "published" | "hidden" | "removed" | "deleted";
  source_created_at: string;
  projected_payload_json: string;
  projection_version: number;
  created_at: string;
  updated_at: string;
};

export type UpsertCommunityMembershipProjectionInput = {
  projection_id: string;
  community_id: string;
  user_id: string;
  membership_state: CommunityMembershipProjectionRow["membership_state"];
  role_summary_json: string | null;
  source_updated_at: string;
  created_at: string;
  updated_at: string;
};

export type InsertCommunityMembershipRequestInput = {
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

export type UpdateCommunityMembershipRequestInput = {
  membership_request_id: string;
  status: CommunityMembershipRequestRow["status"];
  reviewed_by_user_id: string | null;
  review_reason: string | null;
  resolved_at: string | null;
  updated_at: string;
};

export type UpsertCommunityGateRuleInput = {
  gate_rule_id: string;
  community_id: string;
  scope: CommunityGateRuleRow["scope"];
  gate_family: CommunityGateRuleRow["gate_family"];
  gate_type: CommunityGateRuleRow["gate_type"];
  proof_requirements_json: string | null;
  chain_namespace: string | null;
  gate_config_json: string | null;
  status: CommunityGateRuleRow["status"];
  created_at: string;
  updated_at: string;
};

export type InsertAuditLogInput = {
  audit_event_id: string;
  actor_type: "user" | "worker" | "system" | "operator";
  actor_id: string | null;
  action: string;
  target_type: string;
  target_id: string;
  community_id: string | null;
  metadata_json: string | null;
  created_at: string;
};

export interface AuthBootstrapTx {
  findActiveAuthProviderLink(provider: string, providerSubject: string): Promise<AuthProviderLinkRow | null>;
  getUser(userId: string): Promise<UserRow | null>;
  getProfileByUserId(userId: string): Promise<ProfileRow | null>;
  getGlobalHandleById(globalHandleId: string): Promise<GlobalHandleRow | null>;
  listActiveWalletAttachments(userId: string): Promise<WalletAttachmentRow[]>;
  getVerificationSessionById(verificationSessionId: string): Promise<VerificationSessionRow | null>;
  getLatestVerificationSessionForUser(userId: string): Promise<VerificationSessionRow | null>;
  getDeviceSessionById(deviceSessionId: string): Promise<DeviceSessionRow | null>;
  getDeviceSessionByDeviceCode(deviceCode: string): Promise<DeviceSessionRow | null>;
  getLatestRedditVerificationSessionForUser(userId: string): Promise<RedditVerificationSessionRow | null>;
  getLatestRedditVerificationSessionForUserAndUsername(
    userId: string,
    redditUsername: string,
  ): Promise<RedditVerificationSessionRow | null>;
  getExternalReputationSnapshotById(snapshotId: string): Promise<ExternalReputationSnapshotRow | null>;
  getLatestExternalReputationSnapshotForUser(userId: string): Promise<ExternalReputationSnapshotRow | null>;
  getLatestExternalReputationSnapshotForUserAndHandle(
    userId: string,
    sourceAccountHandle: string,
  ): Promise<ExternalReputationSnapshotRow | null>;
  listUserRedditSubredditAffinitiesForSnapshot(snapshotId: string): Promise<UserRedditSubredditAffinityRow[]>;
  listUserInterestTagsForSnapshot(snapshotId: string): Promise<UserInterestTagRow[]>;
  listUserAudienceSegmentsForSnapshot(snapshotId: string): Promise<UserAudienceSegmentRow[]>;
  getLatestJobByTypeAndSubject(jobType: JobRow["job_type"], subjectType: string, subjectId: string): Promise<JobRow | null>;
  insertUser(input: InsertUserInput): Promise<void>;
  updateUserVerification(input: UpdateUserVerificationInput): Promise<void>;
  insertGlobalHandle(input: InsertGlobalHandleInput): Promise<void>;
  insertProfile(input: InsertProfileInput): Promise<void>;
  updateProfile(input: UpdateProfileInput): Promise<void>;
  insertDeviceSession(input: InsertDeviceSessionInput): Promise<void>;
  updateDeviceSession(input: InsertDeviceSessionInput): Promise<void>;
  insertAuthProviderLink(input: InsertAuthProviderLinkInput): Promise<void>;
  insertWalletAttachment(input: InsertWalletAttachmentInput): Promise<void>;
  insertVerificationSession(input: InsertVerificationSessionInput): Promise<void>;
  updateVerificationSession(input: InsertVerificationSessionInput): Promise<void>;
  insertRedditVerificationSession(input: InsertRedditVerificationSessionInput): Promise<void>;
  updateRedditVerificationSession(input: InsertRedditVerificationSessionInput): Promise<void>;
  insertExternalReputationSnapshot(input: InsertExternalReputationSnapshotInput): Promise<void>;
  deleteUserRedditSubredditAffinitiesForSnapshot(snapshotId: string): Promise<void>;
  deleteUserInterestTagsForSnapshot(snapshotId: string): Promise<void>;
  deleteUserAudienceSegmentsForSnapshot(snapshotId: string): Promise<void>;
  deleteUserRedditFeatureProfilesForSnapshot(snapshotId: string): Promise<void>;
  upsertUserRedditSubredditAffinity(input: UpsertUserRedditSubredditAffinityInput): Promise<void>;
  upsertUserInterestTag(input: UpsertUserInterestTagInput): Promise<void>;
  upsertUserAudienceSegment(input: UpsertUserAudienceSegmentInput): Promise<void>;
  upsertUserRedditFeatureProfile(input: UpsertUserRedditFeatureProfileInput): Promise<void>;
  getNamespaceVerificationSessionById(namespaceVerificationSessionId: string): Promise<NamespaceVerificationSessionRow | null>;
  getLatestNamespaceVerificationSessionForUser(userId: string): Promise<NamespaceVerificationSessionRow | null>;
  getLatestNamespaceVerificationForUser(userId: string): Promise<NamespaceVerificationRow | null>;
  getPrimaryWalletAttachmentForUser(userId: string): Promise<WalletAttachmentRow | null>;
  updateUserPrimaryWalletAttachment(input: UpdateUserPrimaryWalletAttachmentInput): Promise<void>;
  insertNamespaceVerificationSession(input: InsertNamespaceVerificationSessionInput): Promise<void>;
  updateNamespaceVerificationSession(input: InsertNamespaceVerificationSessionInput): Promise<void>;
  insertNamespaceVerification(input: InsertNamespaceVerificationInput): Promise<void>;
  getNamespaceVerificationById(namespaceVerificationId: string): Promise<NamespaceVerificationRow | null>;
  getCommunityRegistryAttemptById(registryAttemptId: string): Promise<CommunityRegistryAttemptRow | null>;
  getCommunityRegistryTableRefByCommunityId(communityId: string): Promise<CommunityRegistryTableRefRow | null>;
  getActiveCommunityDatabaseBinding(communityId: string): Promise<CommunityDatabaseBindingRow | null>;
  findCommunityByNamespaceVerificationId(namespaceVerificationId: string): Promise<CommunityRow | null>;
  getCommunityById(communityId: string): Promise<CommunityRow | null>;
  listCommunityGateRules(communityId: string): Promise<CommunityGateRuleRow[]>;
  getCommunityGateRuleById(gateRuleId: string): Promise<CommunityGateRuleRow | null>;
  listActiveCommunityGateRules(
    communityId: string,
    scope: CommunityGateRuleRow["scope"],
  ): Promise<CommunityGateRuleRow[]>;
  getCommunityMembershipProjection(
    communityId: string,
    userId: string,
  ): Promise<CommunityMembershipProjectionRow | null>;
  getPendingCommunityMembershipRequest(
    communityId: string,
    applicantUserId: string,
  ): Promise<CommunityMembershipRequestRow | null>;
  getCommunityMembershipRequestById(
    membershipRequestId: string,
  ): Promise<CommunityMembershipRequestRow | null>;
  listPendingCommunityMembershipRequests(
    communityId: string,
  ): Promise<CommunityMembershipRequestRow[]>;
  getCommunityMoneyPolicyByCommunityId(communityId: string): Promise<CommunityMoneyPolicyRow | null>;
  getJobById(jobId: string): Promise<JobRow | null>;
  findLatestJobBySubject(subjectType: string, subjectId: string): Promise<JobRow | null>;
  claimNextRunnableJob(jobType: JobRow["job_type"], nowIso: string): Promise<JobRow | null>;
  resetRunningJobs(jobType: JobRow["job_type"], updatedBeforeIso: string, resetAtIso: string): Promise<number>;
  insertCommunity(input: InsertCommunityInput): Promise<void>;
  insertCommunityRegistryAttempt(input: InsertCommunityRegistryAttemptInput): Promise<void>;
  updateCommunityRegistryAttempt(input: UpdateCommunityRegistryAttemptInput): Promise<void>;
  upsertCommunityRegistryTableRef(input: UpsertCommunityRegistryTableRefInput): Promise<void>;
  updateCommunityRegistryState(input: UpdateCommunityRegistryStateInput): Promise<void>;
  insertCommunityDatabaseBinding(input: InsertCommunityDatabaseBindingInput): Promise<void>;
  upsertCommunityGateRule(input: UpsertCommunityGateRuleInput): Promise<void>;
  upsertCommunityMembershipProjection(input: UpsertCommunityMembershipProjectionInput): Promise<void>;
  insertCommunityMembershipRequest(input: InsertCommunityMembershipRequestInput): Promise<void>;
  updateCommunityMembershipRequest(input: UpdateCommunityMembershipRequestInput): Promise<void>;
  upsertCommunityMoneyPolicy(input: UpsertCommunityMoneyPolicyInput): Promise<void>;
  insertJob(input: InsertJobInput): Promise<void>;
  updateJobStatus(input: UpdateJobStatusInput): Promise<void>;
  insertCommunityPostProjection(input: InsertCommunityPostProjectionInput): Promise<void>;
  insertAuditLog(input: InsertAuditLogInput): Promise<void>;
}

export interface AuthBootstrapStore {
  withTransaction<T>(fn: (tx: AuthBootstrapTx) => Promise<T>): Promise<T>;
  findActiveAuthProviderLink(provider: string, providerSubject: string): Promise<AuthProviderLinkRow | null>;
  getUser(userId: string): Promise<UserRow | null>;
  getProfileByUserId(userId: string): Promise<ProfileRow | null>;
  getGlobalHandleById(globalHandleId: string): Promise<GlobalHandleRow | null>;
  listActiveWalletAttachments(userId: string): Promise<WalletAttachmentRow[]>;
  getVerificationSessionById(verificationSessionId: string): Promise<VerificationSessionRow | null>;
  getLatestVerificationSessionForUser(userId: string): Promise<VerificationSessionRow | null>;
  getDeviceSessionById(deviceSessionId: string): Promise<DeviceSessionRow | null>;
  getDeviceSessionByDeviceCode(deviceCode: string): Promise<DeviceSessionRow | null>;
  getLatestRedditVerificationSessionForUser(userId: string): Promise<RedditVerificationSessionRow | null>;
  getLatestRedditVerificationSessionForUserAndUsername(
    userId: string,
    redditUsername: string,
  ): Promise<RedditVerificationSessionRow | null>;
  getExternalReputationSnapshotById(snapshotId: string): Promise<ExternalReputationSnapshotRow | null>;
  getLatestExternalReputationSnapshotForUser(userId: string): Promise<ExternalReputationSnapshotRow | null>;
  getLatestExternalReputationSnapshotForUserAndHandle(
    userId: string,
    sourceAccountHandle: string,
  ): Promise<ExternalReputationSnapshotRow | null>;
  listUserRedditSubredditAffinitiesForSnapshot(snapshotId: string): Promise<UserRedditSubredditAffinityRow[]>;
  listUserInterestTagsForSnapshot(snapshotId: string): Promise<UserInterestTagRow[]>;
  listUserAudienceSegmentsForSnapshot(snapshotId: string): Promise<UserAudienceSegmentRow[]>;
  getNamespaceVerificationSessionById(namespaceVerificationSessionId: string): Promise<NamespaceVerificationSessionRow | null>;
  getLatestNamespaceVerificationSessionForUser(userId: string): Promise<NamespaceVerificationSessionRow | null>;
  getLatestNamespaceVerificationForUser(userId: string): Promise<NamespaceVerificationRow | null>;
  getPrimaryWalletAttachmentForUser(userId: string): Promise<WalletAttachmentRow | null>;
  getNamespaceVerificationById(namespaceVerificationId: string): Promise<NamespaceVerificationRow | null>;
  getCommunityRegistryAttemptById(registryAttemptId: string): Promise<CommunityRegistryAttemptRow | null>;
  getCommunityRegistryTableRefByCommunityId(communityId: string): Promise<CommunityRegistryTableRefRow | null>;
  getActiveCommunityDatabaseBinding(communityId: string): Promise<CommunityDatabaseBindingRow | null>;
  findCommunityByNamespaceVerificationId(namespaceVerificationId: string): Promise<CommunityRow | null>;
  getCommunityById(communityId: string): Promise<CommunityRow | null>;
  listCommunityGateRules(communityId: string): Promise<CommunityGateRuleRow[]>;
  getCommunityGateRuleById(gateRuleId: string): Promise<CommunityGateRuleRow | null>;
  listActiveCommunityGateRules(
    communityId: string,
    scope: CommunityGateRuleRow["scope"],
  ): Promise<CommunityGateRuleRow[]>;
  getCommunityMembershipProjection(
    communityId: string,
    userId: string,
  ): Promise<CommunityMembershipProjectionRow | null>;
  getPendingCommunityMembershipRequest(
    communityId: string,
    applicantUserId: string,
  ): Promise<CommunityMembershipRequestRow | null>;
  getCommunityMembershipRequestById(
    membershipRequestId: string,
  ): Promise<CommunityMembershipRequestRow | null>;
  listPendingCommunityMembershipRequests(
    communityId: string,
  ): Promise<CommunityMembershipRequestRow[]>;
  getCommunityMoneyPolicyByCommunityId(communityId: string): Promise<CommunityMoneyPolicyRow | null>;
  getJobById(jobId: string): Promise<JobRow | null>;
  findLatestJobBySubject(subjectType: string, subjectId: string): Promise<JobRow | null>;
  getLatestJobByTypeAndSubject(jobType: JobRow["job_type"], subjectType: string, subjectId: string): Promise<JobRow | null>;
  claimNextRunnableJob(jobType: JobRow["job_type"], nowIso: string): Promise<JobRow | null>;
  resetRunningJobs(jobType: JobRow["job_type"], updatedBeforeIso: string, resetAtIso: string): Promise<number>;
  listCommunitiesRequiringRegistryAttention(): Promise<CommunityRow[]>;
}

export class UniqueConstraintError extends Error {
  public readonly field: string;

  constructor(field: string, message = `Unique constraint failed: ${field}`) {
    super(message);
    this.field = field;
  }
}
