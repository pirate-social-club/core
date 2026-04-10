export type UserRow = {
  user_id: string;
  primary_wallet_attachment_id: string | null;
  verification_state: "unverified" | "pending" | "verified" | "reverification_required";
  capability_provider: "self" | "very" | "passport" | "zkpass" | null;
  verification_capabilities_json: string;
  verified_at: string | null;
  nationality: string | null;
  current_verification_session_id: string | null;
  created_at: string;
  updated_at: string;
};

export type GlobalHandleRow = {
  global_handle_id: string;
  user_id: string;
  label_normalized: string;
  label_display: string;
  status: "active" | "redirect" | "retired";
  tier: "generated" | "standard" | "premium";
  issuance_source:
    | "generated_signup"
    | "free_cleanup_rename"
    | "reddit_verified_claim"
    | "paid_upgrade"
    | "admin_grant";
  redirect_target_global_handle_id: string | null;
  price_paid_usd: number | null;
  free_rename_consumed: 0 | 1;
  issued_at: string;
  replaced_at: string | null;
  created_at: string;
  updated_at: string;
};

export type ProfileRow = {
  user_id: string;
  display_name: string | null;
  bio: string | null;
  avatar_ref: string | null;
  cover_ref: string | null;
  global_handle_id: string;
  created_at: string;
  updated_at: string;
};

export type AuthProviderLinkRow = {
  auth_provider_link_id: string;
  user_id: string;
  provider: string;
  provider_subject: string;
  provider_user_ref: string | null;
  status: "active" | "revoked";
  linked_at: string;
  revoked_at: string | null;
  created_at: string;
  updated_at: string;
};

export type WalletAttachmentRow = {
  wallet_attachment_id: string;
  user_id: string;
  chain_namespace: string;
  wallet_address_normalized: string;
  wallet_address_display: string;
  source_provider: string | null;
  source_subject: string | null;
  attachment_kind: "embedded" | "external" | "delegated";
  is_primary: 0 | 1;
  status: "active" | "detached" | "revoked";
  attached_at: string;
  detached_at: string | null;
  created_at: string;
  updated_at: string;
};

export type NamespaceVerificationRow = {
  namespace_verification_id: string;
  source_namespace_verification_session_id: string;
  user_id: string;
  family: "hns";
  normalized_root_label: string;
  status: "verified" | "stale" | "expired" | "disputed";
  root_exists: 0 | 1;
  root_control_verified: 0 | 1;
  expiry_horizon_sufficient: 0 | 1;
  routing_enabled: 0 | 1;
  pirate_dns_authority_verified: 0 | 1;
  club_attach_allowed: 0 | 1;
  pirate_web_routing_allowed: 0 | 1;
  pirate_subdomain_issuance_allowed: 0 | 1;
  control_class:
    | "single_holder_root"
    | "multisig_controlled_root"
    | "dao_controlled_root"
    | "burned_or_immutable_root"
    | null;
  operation_class:
    | "owner_managed_namespace"
    | "routing_only_namespace"
    | "pirate_delegated_namespace"
    | null;
  observation_provider: string | null;
  evidence_bundle_ref: string | null;
  accepted_at: string;
  expires_at: string;
  created_at: string;
  updated_at: string;
};

export type VerificationSessionRow = {
  verification_session_id: string;
  user_id: string;
  provider: "self" | "very";
  session_kind: string;
  requested_capabilities_json: string;
  status: "pending" | "verified" | "failed" | "expired" | "canceled";
  upstream_session_ref: string | null;
  result_ref: string | null;
  failure_code: string | null;
  started_at: string;
  completed_at: string | null;
  expires_at: string | null;
  created_at: string;
  updated_at: string;
};

export type RedditVerificationSessionRow = {
  reddit_verification_session_id: string;
  user_id: string;
  reddit_username: string;
  verification_code: string;
  code_placement_surface: "profile" | "bio" | "about";
  status: "pending" | "verified" | "failed" | "expired";
  verification_hint: string | null;
  failure_code: "code_not_found" | "username_not_found" | "rate_limited" | "source_error" | null;
  checked_count: number;
  last_checked_at: string | null;
  verified_at: string | null;
  expires_at: string;
  created_at: string;
  updated_at: string;
};

export type ExternalReputationSnapshotRow = {
  external_reputation_snapshot_id: string;
  user_id: string;
  source_platform: "reddit";
  snapshot_type: "onboarding";
  source_account_handle: string;
  proof_method: "profile_code";
  captured_at: string;
  snapshot_payload_json: string;
  created_at: string;
  updated_at: string;
};

export type UserRedditSubredditAffinityRow = {
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

export type UserInterestTagRow = {
  interest_tag_id: string;
  user_id: string;
  source_snapshot_id: string;
  tag: string;
  source: "taxonomy" | "llm";
  confidence: number;
  weight: number;
  evidence_json: string | null;
  feature_version: string;
  derived_at: string;
  created_at: string;
  updated_at: string;
};

export type UserAudienceSegmentRow = {
  audience_segment_id: string;
  user_id: string;
  source_snapshot_id: string;
  segment_key: string;
  source: "deterministic" | "llm" | "hybrid";
  confidence: number;
  eligibility_state: "eligible" | "ineligible" | "suppressed";
  evidence_json: string | null;
  derivation_version: string;
  derived_at: string;
  expires_at: string | null;
  created_at: string;
  updated_at: string;
};

export type UserRedditFeatureProfileRow = {
  feature_profile_id: string;
  user_id: string;
  source_snapshot_id: string;
  source: "llm";
  profile_json: string;
  confidence: number;
  feature_version: string;
  derived_at: string;
  created_at: string;
  updated_at: string;
};

export type NamespaceVerificationSessionRow = {
  namespace_verification_session_id: string;
  namespace_verification_id: string | null;
  user_id: string;
  family: "hns";
  submitted_root_label: string;
  normalized_root_label: string | null;
  status:
    | "draft"
    | "inspecting"
    | "dns_setup_required"
    | "challenge_required"
    | "challenge_pending"
    | "verifying"
    | "verified"
    | "failed"
    | "expired"
    | "disputed";
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
  control_class:
    | "single_holder_root"
    | "multisig_controlled_root"
    | "dao_controlled_root"
    | "burned_or_immutable_root"
    | null;
  operation_class:
    | "owner_managed_namespace"
    | "routing_only_namespace"
    | "pirate_delegated_namespace"
    | null;
  observation_provider: string | null;
  evidence_bundle_ref: string | null;
  failure_reason: string | null;
  accepted_at: string | null;
  expires_at: string;
  created_at: string;
  updated_at: string;
};

export type DeviceSessionRow = {
  device_session_id: string;
  device_code: string;
  user_code: string;
  authorized_user_id: string | null;
  status: "pending" | "authorized" | "completed" | "expired";
  client_name: string | null;
  created_at: string;
  updated_at: string;
  expires_at: string;
  authorized_at: string | null;
  completed_at: string | null;
};

export type CommunityRow = {
  community_id: string;
  creator_user_id: string;
  display_name: string;
  membership_mode: "open" | "request" | "gated";
  status: "draft" | "active" | "frozen" | "archived" | "deleted" | "suspended";
  provisioning_state: "requested" | "provisioning" | "active" | "rotation_required" | "error";
  transfer_state: "none" | "pending" | "transferred" | "federated";
  registry_publication_state:
    | "not_started"
    | "pending_create"
    | "pending_seed"
    | "published"
    | "stale"
    | "publication_error";
  registry_attempt_id: string | null;
  registry_published_at: string | null;
  registry_publication_job_id: string | null;
  registry_error_code: string | null;
  route_slug: string | null;
  namespace_verification_id: string | null;
  primary_database_binding_id: string | null;
  created_at: string;
  updated_at: string;
};

export type CommunityGateRuleRow = {
  gate_rule_id: string;
  community_id: string;
  scope: "membership" | "viewer" | "posting";
  gate_family: "token_holding" | "identity_proof";
  gate_type:
    | "erc721_holding"
    | "erc1155_holding"
    | "erc20_balance"
    | "solana_nft_holding"
    | "unique_human"
    | "age_over_18"
    | "nationality"
    | "gender"
    | "sanctions_clear"
    | "wallet_score";
  proof_requirements_json: string | null;
  chain_namespace: string | null;
  gate_config_json: string | null;
  status: "active" | "disabled";
  created_at: string;
  updated_at: string;
};

export type CommunityMembershipProjectionRow = {
  projection_id: string;
  community_id: string;
  user_id: string;
  membership_state: "not_member" | "pending_request" | "member" | "banned";
  role_summary_json: string | null;
  source_updated_at: string;
  created_at: string;
  updated_at: string;
};

export type CommunityMembershipRequestRow = {
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

export type CommunityRegistryAttemptRow = {
  registry_attempt_id: string;
  actor_user_id: string;
  actor_primary_wallet_snapshot: string | null;
  actor_governance_address_snapshot: string | null;
  namespace_verification_id: string;
  normalized_root_label: string;
  community_id: string | null;
  attempt_status: "in_progress" | "succeeded" | "failed";
  failure_code: string | null;
  created_at: string;
  updated_at: string;
};

export type CommunityRegistryTableRefRow = {
  community_id: string;
  tableland_chain_id: number;
  attempts_table_name: string;
  club_registry_table_name: string | null;
  club_namespace_table_name: string | null;
  publisher_kind: "direct_key";
  last_published_snapshot_hash: string | null;
  last_publish_attempted_at: string | null;
  last_publish_succeeded_at: string | null;
  created_at: string;
  updated_at: string;
};

export type CommunityDatabaseBindingRow = {
  community_database_binding_id: string;
  community_id: string;
  binding_role: "primary" | "read_replica" | "archive";
  organization_slug: string;
  group_name: string;
  group_id: string | null;
  database_name: string;
  database_id: string | null;
  database_url: string;
  location: string | null;
  status: "active" | "inactive" | "pending_transfer" | "superseded" | "error";
  transferred_at: string | null;
  created_at: string;
  updated_at: string;
};

export type CommunityMoneyPolicyRow = {
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
  route_status_policy: "fail" | "fallback_display" | "queue";
  route_hop_tolerance: number;
  updated_at: string;
};

export type JobRow = {
  job_id: string;
  job_type:
    | "community_provisioning"
    | "community_registry_publication"
    | "reddit_snapshot_import"
    | "reddit_feature_derivation"
    | "club_threads_export"
    | "media_analysis"
    | "story_publication"
    | "purchase_settlement_confirmation"
    | "entitlement_grant"
    | "artist_metadata_enrichment"
    | "track_reconciliation"
    | "catalog_track_preregistration"
    | "stem_separation"
    | "forced_alignment"
    | "karaoke_package_assembly";
  job_scope: "platform" | "community";
  community_id: string | null;
  subject_type: string;
  subject_id: string;
  status: "queued" | "running" | "succeeded" | "failed";
  payload_json: string | null;
  result_ref: string | null;
  error_code: string | null;
  attempt_count: number;
  available_at: string | null;
  created_at: string;
  updated_at: string;
};
