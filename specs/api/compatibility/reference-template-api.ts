// GENERATED FILE. Edit specs/api/src/** and run `rtk bun specs/api/scripts/generate-reference-template-types.ts`.

export type VerificationCapabilityState = {
  state: "unverified" | "pending" | "verified" | "expired";
  provider?: "self" | "very" | null;
  proof_type?: "unique_human" | null;
  mechanism?: string | null;
  verified_at?: string | null;
};

export type VerifiedCapabilityState = {
  state: "unverified" | "verified" | "expired";
  provider?: "self" | null;
  proof_type?: "age_over_18" | "minimum_age" | "nationality" | "gender" | null;
  mechanism?: string | null;
  verified_at?: string | null;
};

export type SanctionsClearCapabilityState = {
  state: "unverified" | "verified" | "expired";
  provider?: "passport" | null;
  proof_type?: "sanctions_clear" | null;
  mechanism?: "CleanHands" | null;
  verified_at?: string | null;
};

export type WalletScoreCapabilityState = {
  state: "unverified" | "verified" | "expired";
  provider?: "passport" | null;
  proof_type?: "wallet_score" | null;
  mechanism?: "stamps-api-v2" | null;
  verified_at?: string | null;
  score?: number | null;
  score_threshold?: number | null;
  passing_score?: boolean | null;
  last_score_timestamp?: string | null;
  expiration_timestamp?: string | null;
  stamps?: Array<{
    stamp_name?: string;
    stamp_score?: number;
  }> | null;
};

export type VerificationCapabilities = {
  unique_human: VerificationCapabilityState;
  age_over_18: (VerifiedCapabilityState & {
    proof_type?: "age_over_18" | null;
  });
  minimum_age: (VerifiedCapabilityState & {
    proof_type?: "minimum_age" | null;
    value?: number | null;
  });
  nationality: (VerifiedCapabilityState & {
    proof_type?: "nationality" | null;
    value?: string | null;
  });
  gender: (VerifiedCapabilityState & {
    value?: "M" | "F" | null;
    proof_type?: "gender" | null;
  });
  sanctions_clear: SanctionsClearCapabilityState;
  wallet_score: WalletScoreCapabilityState;
};

export type User = {
  user_id: string;
  community_posting_state?: ({
    community_ref?: string;
    community_id?: string;
    has_created_text_post?: boolean;
  }) | null;
  primary_wallet_attachment_id?: string | null;
  verification_state: "unverified" | "pending" | "verified" | "reverification_required";
  capability_provider?: "self" | "very" | null;
  verification_capabilities: VerificationCapabilities;
  verified_at?: string | null;
  created_at: string;
  updated_at: string;
};

export type GlobalHandle = {
  global_handle_id: string;
  label: string;
  tier: "generated" | "standard" | "premium";
  status: "active" | "redirect" | "retired";
  issuance_source: "generated_signup" | "free_cleanup_rename" | "reddit_verified_claim" | "paid_upgrade" | "admin_grant";
  redirect_target_global_handle_id?: string | null;
  price_paid_usd?: number | null;
  free_rename_consumed?: boolean;
  issued_at: string;
  replaced_at?: string | null;
};

export type Profile = {
  user_id: string;
  display_name?: string | null;
  avatar_ref?: string | null;
  cover_ref?: string | null;
  bio?: string | null;
  preferred_locale?: string | null;
  linked_handles?: Array<LinkedHandle> | null;
  primary_public_handle?: LinkedHandle | null;
  primary_wallet_address?: string | null;
  verification_capabilities?: VerificationCapabilities | null;
  global_handle: GlobalHandle;
  created_at: string;
  updated_at: string;
};

export type RedditVerification = {
  reddit_username: string;
  status: "pending" | "verified" | "failed" | "expired";
  verification_hint?: string | null;
  code_placement_surface?: "profile" | "bio" | "about" | null;
  last_checked_at?: string | null;
  failure_code?: "code_not_found" | "username_not_found" | "rate_limited" | "source_error" | null;
};

export type RedditImportSummary = {
  reddit_username: string;
  imported_at: string;
  account_age_days?: number | null;
  global_karma?: number | null;
  top_subreddits: Array<{
    subreddit: string;
    karma?: number | null;
    posts?: number | null;
    rank_source?: "karma" | "posts" | "source_order" | null;
  }>;
  moderator_of: Array<string>;
  inferred_interests: Array<string>;
  suggested_communities: Array<{
    community_id: string;
    name: string;
    reason: string;
  }>;
  coverage_note?: string | null;
};

export type OnboardingStatus = {
  generated_handle_assigned: boolean;
  cleanup_rename_available: boolean;
  unique_human_verification_status: "not_started" | "pending" | "verified" | "expired" | "failed";
  namespace_verification_status: "not_started" | "pending" | "verified" | "stale" | "expired" | "disputed" | "failed";
  community_creation_ready: boolean;
  missing_requirements: Array<string>;
  reddit_verification_status: "not_started" | "pending" | "verified" | "failed";
  reddit_import_status: "not_started" | "queued" | "running" | "succeeded" | "failed";
  suggested_community_ids?: Array<string>;
};

export type WalletAttachmentSummary = {
  wallet_attachment_id: string;
  chain_namespace: string;
  wallet_address: string;
  is_primary: boolean;
};

export type SessionExchangeResponse = {
  access_token: string;
  user: User;
  profile: Profile;
  onboarding: OnboardingStatus;
  wallet_attachments: Array<WalletAttachmentSummary>;
};

export type Community = {
  community_id: string;
  display_name: string;
  description?: string | null;
  avatar_ref?: string | null;
  banner_ref?: string | null;
  namespace_verification_id?: string | null;
  route_slug?: string | null;
  pending_namespace_verification_session_id?: string | null;
  status: "draft" | "active" | "frozen" | "archived" | "deleted";
  provisioning_state: "requested" | "provisioning" | "active" | "rotation_required" | "error";
  artist_identity_id?: string | null;
  community_agent_user_id?: string | null;
  membership_mode: "open" | "request" | "gated";
  allow_anonymous_identity: boolean;
  anonymous_identity_scope?: "community_stable" | "thread_stable" | "post_ephemeral" | null;
  human_verification_lane: HumanVerificationLane;
  human_verification_lane_origin: CommunityAgentResolutionOrigin;
  allowed_disclosed_qualifiers?: Array<string> | null;
  allow_qualifiers_on_anonymous_posts?: boolean | null;
  root_post_min_trust_tier?: "new" | "established" | "trusted" | "high_trust" | null;
  reply_min_trust_tier?: "new" | "established" | "trusted" | "high_trust" | null;
  anonymous_posting_min_trust_tier?: "new" | "established" | "trusted" | "high_trust" | null;
  root_post_quota_by_trust_tier?: RootPostQuotaByTrustTier | null;
  reply_quota_by_trust_tier?: ReplyQuotaByTrustTier | null;
  probation_window_days?: number | null;
  link_post_policy?: "allow" | "require_established" | null;
  default_age_gate_policy?: "none" | "18_plus";
  agent_posting_policy: "disallow" | "review" | "allow_with_disclosure" | "allow";
  agent_posting_scope: "replies_only" | "top_level_and_replies";
  agent_daily_post_cap?: number | null;
  agent_daily_reply_cap?: number | null;
  agent_min_owner_trust_tier?: "new" | "established" | "trusted" | "high_trust" | null;
  agent_owner_active_limit?: number | null;
  accepted_agent_ownership_providers: Array<AgentOwnershipProvider>;
  accepted_agent_ownership_providers_origin: CommunityAgentResolutionOrigin;
  civic_scale_tier?: "club" | "village" | "town" | "city" | "state";
  donation_policy_mode: "none" | "optional_creator_sidecar";
  donation_partner_status: "unconfigured" | "active" | "paused";
  donation_partner_id?: string | null;
  donation_partner?: DonationPartnerSummary | null;
  money_policy: CommunityMoneyPolicy;
  content_authenticity_policy: CommunityContentAuthenticityPolicy;
  content_authenticity_detection_policy: CommunityContentAuthenticityDetectionPolicy;
  market_context_policy: CommunityMarketContextPolicy;
  source_policy: CommunitySourcePolicy;
  capture_edit_policy: CommunityCaptureEditPolicy;
  adult_content_policy: CommunityAdultContentPolicy;
  graphic_content_policy: CommunityGraphicContentPolicy;
  motion_media_policy: CommunityMotionMediaPolicy;
  language_policy: CommunityLanguagePolicy;
  civility_policy: CommunityCivilityPolicy;
  openai_moderation_settings?: ({
    scan_titles?: boolean;
    scan_post_bodies?: boolean;
    scan_captions?: boolean;
    scan_link_preview_text?: boolean;
    scan_images?: boolean;
  }) | null;
  provenance_policy: CommunityProvenancePolicy;
  promotion_policy: CommunityPromotionPolicy;
  label_policy?: CommunityLabelPolicy | null;
  community_profile?: CommunityProfile | null;
  reference_links?: Array<CommunityReferenceLinkPublic> | null;
  community_stage?: "initial";
  member_count?: number | null;
  qualified_member_count?: number | null;
  stage_entered_at?: string | null;
  governance_mode: "centralized" | "multisig" | "majeur";
  governance_backend?: CommunityGovernanceBackend | null;
  gate_rules?: Array<GateRule> | null;
  created_by_user_id: string;
  created_at: string;
  updated_at: string;
};

export type CommunityMoneyPolicy = {
  community_id: string;
  policy_origin: CommunityPolicyOrigin;
  funding_preference: string;
  accepted_funding_assets: Array<CommunityMoneyAssetRef>;
  accepted_source_chains: Array<CommunityMoneyChainRef>;
  approved_route_providers?: Array<string> | null;
  destination_settlement_chain: CommunityMoneyChainRef;
  destination_settlement_token: string;
  treasury_denomination?: string | null;
  max_slippage_bps: number;
  quote_ttl_seconds: number;
  route_required: boolean;
  route_status_policy: CommunityFundingRouteStatusPolicy;
  route_hop_tolerance: number;
  updated_at: string;
};

export type CommunityPricingPolicy = {
  community_id: string;
  policy_origin: CommunityPolicyOrigin;
  pricing_policy_version: string;
  regional_pricing_enabled: boolean;
  verification_provider_requirement?: CommunityPricingVerificationProvider | null;
  default_tier_key?: string | null;
  tiers: Array<CommunityPricingTier>;
  country_assignments: Array<CommunityPricingCountryAssignment>;
  source_template_id?: string | null;
  source_template_version?: string | null;
  updated_at: string;
};

export type CommunityListing = {
  listing_id: string;
  community_id: string;
  asset_id?: string | null;
  live_room_id?: string | null;
  listing_mode: "fixed_price";
  status: "draft" | "active" | "paused" | "archived";
  price_usd: number;
  regional_pricing_enabled: boolean;
  donation_partner_id?: string | null;
  donation_share_pct?: number | null;
  created_by_user_id: string;
  created_at: string;
  updated_at: string;
};

export type CreateCommunityListingRequest = {
  asset_id?: string | null;
  live_room_id?: string | null;
  price_usd: number;
  regional_pricing_enabled: boolean;
  donation_partner_id?: string | null;
  donation_share_pct?: number | null;
  status: "draft" | "active" | "paused" | "archived";
};

export type UpdateCommunityListingRequest = {
  price_usd?: number;
  regional_pricing_enabled?: boolean;
  donation_partner_id?: string | null;
  donation_share_pct?: number | null;
  status?: "draft" | "active" | "paused" | "archived";
};

export type CommunityListingListResponse = {
  items: Array<CommunityListing>;
};

export type CommunityPurchase = {
  purchase_id: string;
  community_id: string;
  listing_id: string;
  asset_id?: string | null;
  live_room_id?: string | null;
  buyer_user_id: string;
  settlement_wallet_attachment_id: string;
  purchase_price_usd: number;
  pricing_tier?: string | null;
  settlement_mode: CommunityPurchaseSettlementMode;
  settlement_chain: CommunityMoneyChainRef;
  settlement_token: string;
  settlement_tx_ref: string;
  allocations: Array<CommunitySaleAllocationLeg>;
  donation_partner_id?: string | null;
  donation_share_pct?: number | null;
  donation_amount_usd?: number | null;
  purchase_entitlement_id: string;
  entitlement_kind: "asset_access" | "live_room_access" | "replay_access" | "license";
  entitlement_target_ref: string;
  created_at: string;
};

export type CommunityPurchaseListResponse = {
  items: Array<CommunityPurchase>;
};

export type CommunityPurchaseQuotePreflightRequest = {
  funding_asset?: CommunityMoneyAssetRef | null;
  source_chain?: CommunityMoneyChainRef | null;
  route_provider?: string | null;
  client_estimated_slippage_bps: number;
  client_estimated_hop_count: number;
  client_route_valid_for_seconds?: number | null;
};

export type CommunityPurchaseQuotePreflight = {
  community_id: string;
  eligible: boolean;
  funding_mode: CommunityPurchaseFundingMode;
  policy_origin: CommunityPolicyOrigin;
  funding_preference: string;
  funding_asset?: CommunityMoneyAssetRef | null;
  source_chain?: CommunityMoneyChainRef | null;
  route_provider?: string | null;
  destination_settlement_chain: CommunityMoneyChainRef;
  destination_settlement_token: string;
  treasury_denomination?: string | null;
  max_slippage_bps: number;
  quote_ttl_seconds: number;
  route_required: boolean;
  route_status_policy: CommunityFundingRouteStatusPolicy;
  route_hop_tolerance: number;
  quoted_at: string;
  expires_at: string;
};

export type CommunityPurchaseQuoteRequest = {
  listing_id: string;
  funding_asset?: CommunityMoneyAssetRef | null;
  source_chain?: CommunityMoneyChainRef | null;
  route_provider?: string | null;
  client_estimated_slippage_bps: number;
  client_estimated_hop_count: number;
  client_route_valid_for_seconds?: number | null;
};

export type CommunityPurchaseQuote = {
  quote_id: string;
  community_id: string;
  listing_id: string;
  buyer_user_id: string;
  asset_id?: string | null;
  live_room_id?: string | null;
  base_price_usd: number;
  pricing_tier?: string | null;
  final_price_usd: number;
  settlement_mode: CommunityPurchaseSettlementMode;
  allocation_snapshot: Array<CommunitySaleAllocationSnapshot>;
  funding_mode: CommunityPurchaseFundingMode;
  funding_asset?: CommunityMoneyAssetRef | null;
  source_chain?: CommunityMoneyChainRef | null;
  route_provider?: string | null;
  route_policy_compliant: boolean;
  route_live_available?: boolean | null;
  policy_origin: CommunityPolicyOrigin;
  destination_settlement_chain: CommunityMoneyChainRef;
  destination_settlement_token: string;
  destination_settlement_amount_atomic?: string | null;
  destination_settlement_decimals?: number | null;
  funding_destination_address?: string | null;
  treasury_denomination?: string | null;
  quote_ttl_seconds: number;
  route_required: boolean;
  route_status_policy: CommunityFundingRouteStatusPolicy;
  route_hop_tolerance: number;
  verification_snapshot_ref?: string | null;
  pricing_policy_version?: string | null;
  quoted_at: string;
  expires_at: string;
};

export type CommunityPurchaseSettlementRequest = {
  quote_id: string;
  settlement_wallet_attachment_id: string;
  funding_tx_ref: string;
  settlement_tx_ref: string;
};

export type CommunityPurchaseSettlement = {
  purchase_id: string;
  quote_id: string;
  community_id: string;
  listing_id: string;
  buyer_user_id: string;
  asset_id?: string | null;
  live_room_id?: string | null;
  settlement_wallet_attachment_id: string;
  purchase_price_usd: number;
  pricing_tier?: string | null;
  settlement_mode: CommunityPurchaseSettlementMode;
  settlement_chain: CommunityMoneyChainRef;
  settlement_chain_ref: string;
  settlement_token: string;
  settlement_tx_ref: string;
  allocations: Array<CommunitySaleAllocationLeg>;
  donation_partner_id?: string | null;
  donation_share_pct?: number | null;
  donation_amount_usd?: number | null;
  entitlement_kind: "asset_access" | "live_room_access";
  entitlement_target_ref: string;
  purchase_entitlement_id: string;
  settled_at: string;
};

export type CommunityPurchaseSettlementFailureRequest = {
  quote_id: string;
};

export type CommunityPurchaseSettlementFailure = {
  quote_id: string;
  community_id: string;
  status: "failed" | "expired";
  failed_at?: string | null;
  expires_at: string;
};

export type UpdateCommunityMoneyPolicyRequest = {
  funding_preference: string;
  accepted_funding_assets: Array<CommunityMoneyAssetRef>;
  accepted_source_chains: Array<CommunityMoneyChainRef>;
  approved_route_providers?: Array<string> | null;
  destination_settlement_chain: CommunityMoneyChainRef;
  destination_settlement_token: string;
  treasury_denomination?: string | null;
  max_slippage_bps: number;
  quote_ttl_seconds: number;
  route_required: boolean;
  route_status_policy: CommunityFundingRouteStatusPolicy;
  route_hop_tolerance: number;
};

export type UpdateCommunityPricingPolicyRequest = {
  regional_pricing_enabled: boolean;
  verification_provider_requirement?: CommunityPricingVerificationProvider | null;
  default_tier_key?: string | null;
  tiers: Array<CommunityPricingTier>;
  country_assignments: Array<CommunityPricingCountryAssignment>;
  source_template_id?: string | null;
  source_template_version?: string | null;
};

export type Job = {
  job_id: string;
  job_type: "community_provisioning" | "reddit_snapshot_import" | "club_threads_export" | "media_analysis" | "story_publication" | "purchase_settlement_confirmation" | "entitlement_grant" | "artist_metadata_enrichment" | "track_reconciliation" | "catalog_track_preregistration" | "stem_separation" | "forced_alignment" | "karaoke_package_assembly";
  status: "queued" | "running" | "succeeded" | "failed";
  subject_type: string;
  subject_id: string;
  result_ref?: string | null;
  error_code?: string | null;
  created_at: string;
  updated_at: string;
};

export type JobAcceptedResponse = {
  job: Job;
};

export type CommunityCreateAcceptedResponse = {
  community: Community;
  job: Job;
};

export type ErrorShape = {
  code: "bad_request" | "auth_error" | "payment_required" | "verification_required" | "eligibility_failed" | "gate_failed" | "posting_trust_tier_too_low" | "posting_quota_exhausted" | "analysis_blocked" | "analysis_review_required" | "label_required" | "invalid_label_selection" | "label_required_but_none_applicable" | "conflict" | "not_found" | "rate_limited" | "payment_failed" | "settlement_pending" | "provider_unavailable" | "internal_error";
  message: string;
  retryable?: boolean;
  details?: (Record<string, unknown>) | null;
};

export type ModerationCase = {
  moderation_case_id: string;
  community_id: string;
  post_id: string | null;
  comment_id: string | null;
  status: ModerationCaseStatus;
  queue_scope: ModerationQueueScope;
  priority: ModerationSignalSeverity;
  opened_by: ModerationCaseOpenedBy;
  created_at: string;
  updated_at: string;
  resolved_at?: string | null;
};

export type ModerationCaseDetail = {
  case: ModerationCase;
  post: Post | null;
  comment: Comment | null;
  signals: Array<ModerationSignal>;
  reports: Array<UserReport>;
  actions: Array<ModerationAction>;
};

export type ModerationCaseListResponse = {
  items: Array<ModerationCase>;
};

export type ModerationSignal = {
  moderation_signal_id: string;
  community_id: string;
  post_id: string | null;
  comment_id: string | null;
  analysis_result_ref: string | null;
  source: "platform_analysis";
  signal_type: string;
  severity: ModerationSignalSeverity;
  provider: string;
  provider_label: string;
  evidence_ref?: string | null;
  created_at: string;
};

export type UserReport = {
  user_report_id: string;
  community_id: string;
  post_id: string | null;
  comment_id: string | null;
  reporter_user_id: string;
  reason_code: UserReportReasonCode;
  note?: string | null;
  created_at: string;
};

export type ModerationAction = {
  moderation_action_id: string;
  moderation_case_id: string;
  community_id: string;
  post_id: string | null;
  comment_id: string | null;
  actor_user_id: string;
  action_type: ModerationActionType;
  note?: string | null;
  created_at: string;
};

export type CreateUserReportRequest = {
  reason_code: UserReportReasonCode;
  note?: string | null;
};

export type CreateModerationActionRequest = {
  action_type: ModerationActionType;
  note?: string | null;
};

type AgentOwnershipProvider = "self_agent_id" | "clawkey";

type CentralizedGovernanceBackend = {
  governance_mode: "centralized";
  governance_verification_state: GovernanceVerificationState;
  governance_display_label?: string | null;
};

type Comment = {
  comment_id: string;
  community_id: string;
  thread_root_post_id: string;
  parent_comment_id: string | null;
  author_user_id: string | null;
  authorship_mode: "human_direct" | "user_agent";
  agent_id?: string | null;
  agent_ownership_record_id?: string | null;
  identity_mode: "public" | "anonymous";
  anonymous_scope: "community_stable" | "thread_stable" | null;
  anonymous_label: string | null;
  agent_handle_snapshot?: string | null;
  agent_display_name_snapshot?: string | null;
  agent_owner_handle_snapshot?: string | null;
  agent_ownership_provider_snapshot?: AgentOwnershipProvider | null;
  body: string | null;
  status: "published" | "hidden" | "removed" | "deleted";
  depth: number;
  direct_reply_count: number;
  descendant_count: number;
  upvote_count: number;
  downvote_count: number;
  score: number;
  last_reply_at: string | null;
  content_hash: string | null;
  swarm_body_ref: string | null;
  created_at: string;
  updated_at: string;
};

type CommunityAdultContentPolicy = {
  community_id: string;
  policy_origin: CommunityPolicyOrigin;
  suggestive: CommunityModerationDecisionLevel;
  artistic_nudity: CommunityModerationDecisionLevel;
  explicit_nudity: CommunityModerationDecisionLevel;
  explicit_sexual_content: CommunityModerationDecisionLevel;
  fetish_content: CommunityModerationDecisionLevel;
  updated_at: string;
};

type CommunityAgentResolutionOrigin = "derived" | "explicit";

type CommunityAuthenticityDetectionProfileStatus = "active" | "archived";

type CommunityAuthenticityDetectionProfileSummary = {
  authenticity_detection_profile_id: string;
  profile_key: string;
  provider_key: string;
  supported_capabilities: Array<"image_authenticity" | "video_authenticity" | "audio_authenticity" | "deepfake_detection">;
  status: CommunityAuthenticityDetectionProfileStatus;
};

type CommunityCaptureEditPolicy = {
  community_id: string;
  policy_origin: CommunityPolicyOrigin;
  basic_adjustments: CommunityDisclosureDecisionLevel;
  retouching: CommunityDisclosureDecisionLevel;
  compositing: CommunityDisclosureDecisionLevel;
  documentary_editing: CommunityDisclosureDecisionLevel;
  require_edit_disclosure: boolean;
  updated_at: string;
};

type CommunityCivilityPolicy = {
  community_id: string;
  policy_origin: CommunityPolicyOrigin;
  group_directed_demeaning_language: CommunityModerationDecisionLevel;
  targeted_insults: CommunityModerationDecisionLevel;
  targeted_harassment: CommunityModerationDecisionLevel;
  threatening_language: CommunityEscalationDecisionLevel;
  updated_at: string;
};

type CommunityContentAuthenticityDetectionPolicy = {
  community_id: string;
  policy_origin: CommunityPolicyOrigin;
  selection_mode: CommunityContentAuthenticityDetectionSelectionMode;
  resolved_profile: CommunityAuthenticityDetectionProfileSummary;
  updated_at: string;
};

type CommunityContentAuthenticityDetectionSelectionMode = "platform_default" | "approved_profile";

type CommunityContentAuthenticityPolicy = {
  community_id: string;
  policy_origin: CommunityPolicyOrigin;
  authenticity_stance: CommunityContentAuthenticityStance;
  text_policy: CommunityTextAuthenticityPolicySettings;
  image_policy: CommunityImageAuthenticityPolicySettings;
  video_policy: CommunityVideoAuthenticityPolicySettings;
  song_policy: CommunitySongAuthenticityPolicySettings;
  updated_at: string;
};

type CommunityContentAuthenticityStance = "human_only" | "human_first" | "ai_allowed_with_disclosure" | "ai_allowed";

type CommunityCreatorRelation = "captured" | "created" | "subject" | "authorized_repost" | "fan_work" | "found";

type CommunityDisclosureDecisionLevel = "allow" | "require_disclosure" | "disallow";

type CommunityEscalationDecisionLevel = "review" | "disallow";

type CommunityFalseClaimConsequence = "warning" | "post_removed" | "temporary_ban" | "permanent_ban";

type CommunityFundingRouteStatusPolicy = "fail" | "fallback_display" | "queue";

type CommunityGovernanceBackend = (CentralizedGovernanceBackend | MultisigGovernanceBackend | MajeurGovernanceBackend);

type CommunityGraphicContentPolicy = {
  community_id: string;
  policy_origin: CommunityPolicyOrigin;
  injury_medical: CommunityModerationDecisionLevel;
  gore: CommunityModerationDecisionLevel;
  extreme_gore: CommunityModerationDecisionLevel;
  body_horror_disturbing: CommunityModerationDecisionLevel;
  animal_harm: CommunityModerationDecisionLevel;
  updated_at: string;
};

type CommunityIdentifiedPersonMediaScope = "subject_only" | "subject_or_authorized" | "public_source_allowed";

type CommunityImageAuthenticityPolicySettings = {
  allow_ai_upscale: boolean;
  allow_ai_restoration: boolean;
  allow_generative_editing: boolean;
  allow_ai_generated: boolean;
};

type CommunityLabelDefinition = {
  label_id: string;
  label: string;
  description?: string | null;
  color_token?: string | null;
  status: "active" | "archived";
  position: number;
  allowed_post_types?: Array<"text" | "image" | "video" | "song"> | null;
};

type CommunityLabelPolicy = {
  label_enabled: boolean;
  require_label_on_top_level_posts: boolean;
  definitions: Array<CommunityLabelDefinition>;
};

type CommunityLanguagePolicy = {
  community_id: string;
  policy_origin: CommunityPolicyOrigin;
  profanity: CommunityModerationDecisionLevel;
  slurs: CommunityModerationDecisionLevel;
  updated_at: string;
};

type CommunityMarketContextMode = "off" | "on";

type CommunityMarketContextPolicy = {
  community_id: string;
  policy_origin: CommunityPolicyOrigin;
  mode: CommunityMarketContextMode;
  enabled_post_types: Array<"link" | "image" | "video">;
  max_markets_per_post: number;
  provider_set: CommunityMarketContextProviderSet;
  resolved_profile: MarketContextProfileSummary;
  updated_at: string;
};

type CommunityMarketContextProviderSet = "platform_default" | "approved_profile";

type CommunityModerationDecisionLevel = "allow" | "review" | "disallow";

type CommunityMoneyAssetRef = {
  asset_symbol: string;
  chain_namespace?: string | null;
  chain_id?: number | null;
  display_name?: string | null;
};

type CommunityMoneyChainRef = {
  chain_namespace: string;
  chain_id?: number | null;
  display_name?: string | null;
};

type CommunityMotionMediaPolicy = {
  community_id: string;
  policy_origin: CommunityPolicyOrigin;
  allow_animated_images: boolean;
  allow_silent_looping_video: boolean;
  allow_audio_video: boolean;
  max_video_duration_seconds?: number | null;
  require_video_transcription: boolean;
  updated_at: string;
};

type CommunityPolicyOrigin = "default" | "explicit";

type CommunityPricingAdjustmentType = "multiplier";

type CommunityPricingCountryAssignment = {
  country_code: string;
  tier_key: string;
};

type CommunityPricingTier = {
  tier_key: string;
  display_name?: string | null;
  adjustment_type: CommunityPricingAdjustmentType;
  adjustment_value: number;
};

type CommunityPricingVerificationProvider = "self";

type CommunityProfile = {
  rules: Array<CommunityRule>;
  resource_links: Array<CommunityResourceLink>;
};

type CommunityPromotionPolicy = {
  community_id: string;
  policy_origin: CommunityPolicyOrigin;
  self_promotion_mode: CommunitySelfPromotionMode;
  require_affiliation_disclosure: boolean;
  max_promotional_posts_per_week?: number | null;
  promotional_participation_ratio?: number | null;
  require_minimum_membership_days?: number | null;
  updated_at: string;
};

type CommunityProvenancePolicy = {
  community_id: string;
  policy_origin: CommunityPolicyOrigin;
  allowed_creator_relations: Array<CommunityCreatorRelation>;
  require_creator_relation: boolean;
  false_claim_consequence: CommunityFalseClaimConsequence;
  allow_oc_claim: boolean;
  require_proof_for_original: boolean;
  updated_at: string;
};

type CommunityPurchaseFundingMode = "direct" | "routed";

type CommunityPurchaseSettlementMode = "delivery_only_story_settlement" | "royalty_native_story_payment";

type CommunityReferenceLinkMetadata = {
  display_name?: string | null;
  image_url?: string | null;
};

type CommunityReferenceLinkPlatform = "musicbrainz" | "genius" | "spotify" | "apple_music" | "wikipedia" | "instagram" | "tiktok" | "x" | "official_website" | "youtube" | "bandcamp" | "soundcloud" | "other";

type CommunityReferenceLinkPublic = {
  community_reference_link_id: string;
  platform: CommunityReferenceLinkPlatform;
  url: string;
  external_id?: string | null;
  label?: string | null;
  link_status: CommunityReferenceLinkStatus;
  verified: boolean;
  verified_at?: string | null;
  metadata: CommunityReferenceLinkMetadata;
  position: number;
};

type CommunityReferenceLinkStatus = "active" | "archived";

type CommunityResourceLink = {
  resource_link_id: string;
  label: string;
  url: string;
  resource_kind: "link" | "playlist" | "document" | "discord" | "website" | "other";
  position: number;
  status: "active" | "archived";
};

type CommunityRule = {
  rule_id: string;
  title: string;
  body: string;
  report_reason: string;
  position: number;
  status: "active" | "archived";
};

type CommunitySaleAllocationLeg = (CommunitySaleAllocationSnapshot & {
  status: CommunitySaleAllocationStatus;
  settlement_ref?: string | null;
  failure_reason?: string | null;
});

type CommunitySaleAllocationRecipientType = "creator" | "charity" | "community_treasury";

type CommunitySaleAllocationSettlementStrategy = "story_payout" | "provider_payout" | "treasury_payout";

type CommunitySaleAllocationSnapshot = {
  recipient_type: CommunitySaleAllocationRecipientType;
  recipient_ref?: string | null;
  waterfall_position: number;
  share_bps: number;
  amount_usd: number;
  settlement_strategy: CommunitySaleAllocationSettlementStrategy;
};

type CommunitySaleAllocationStatus = "quoted" | "pending" | "confirmed" | "failed";

type CommunitySelfPromotionMode = "disallow" | "limited_with_disclosure" | "allowed_with_participation" | "creator_friendly";

type CommunitySongAuthenticityPolicySettings = {
  allow_ai_assisted_mastering: boolean;
  allow_ai_stem_separation: boolean;
  allow_ai_generated_instrumentals: boolean;
  allow_ai_generated_lyrics: boolean;
  allow_ai_generated_vocals: boolean;
};

type CommunitySourcePolicy = {
  community_id: string;
  policy_origin: CommunityPolicyOrigin;
  identified_person_media_scope: CommunityIdentifiedPersonMediaScope;
  require_source_url_for_reposts: boolean;
  allow_human_made_fan_art_of_real_people: boolean;
  require_fan_art_disclosure: boolean;
  updated_at: string;
};

type CommunityTextAuthenticityPolicySettings = {
  allow_ai_assisted_editing: boolean;
  allow_ai_generated: boolean;
};

type CommunityVideoAuthenticityPolicySettings = {
  allow_ai_upscale: boolean;
  allow_ai_restoration: boolean;
  allow_ai_frame_interpolation: boolean;
  allow_generative_editing: boolean;
  allow_ai_generated: boolean;
};

type DisclosedQualifierSnapshot = {
  qualifier_template_id: string;
  rendered_label: string;
  qualifier_kind: "verification_capability" | "provider_attestation";
  qualifier_source: string;
  sensitivity_level?: "low" | "high" | null;
  redundancy_key?: string | null;
};

type DonationPartnerSummary = {
  donation_partner_id: string;
  display_name: string;
  provider: "endaoment";
  provider_partner_ref?: string | null;
  image_url?: string | null;
  review_status: "pending" | "approved" | "rejected";
  status: "active" | "paused" | "retired";
};

type GateRule = {
  gate_rule_id: string;
  community_id: string;
  scope: "membership" | "viewer" | "posting";
  gate_family: "token_holding" | "identity_proof";
  gate_type: "unique_human" | "age_over_18" | "minimum_age" | "nationality" | "gender" | "sanctions_clear" | "wallet_score" | "erc721_holding";
  proof_requirements?: Array<ProofRequirement> | null;
  chain_namespace?: string | null;
  gate_config?: (Record<string, unknown>) | null;
  status: "active" | "disabled";
  created_at: string;
  updated_at: string;
};

type GovernanceVerificationState = "not_required" | "pending" | "verified" | "broken";

type HumanVerificationLane = "very" | "self";

type LinkedHandle = {
  linked_handle_id: string;
  label: string;
  kind: "pirate" | "ens";
  verification_state: "verified" | "unverified" | "stale";
};

type MajeurGovernanceBackend = {
  governance_mode: "majeur";
  governance_chain_id: number;
  governance_contract_address: string;
  governance_treasury_address?: string | null;
  governance_verification_state: GovernanceVerificationState;
  governance_display_label?: string | null;
  governance_attached_at?: string | null;
  governance_last_verified_at?: string | null;
  governance_metadata: MajeurGovernanceMetadata;
};

type MajeurGovernanceMetadata = {
  shares_address: string;
  loot_address: string;
  badges_address: string;
  renderer_address?: string | null;
  ragequittable: boolean;
  proposal_threshold: string;
  proposal_ttl_seconds: number;
  timelock_delay_seconds?: number | null;
  quorum_bps?: number | null;
  quorum_absolute?: string | null;
  min_yes_votes_absolute?: string | null;
  shares_locked: boolean;
  loot_locked: boolean;
  auto_futarchy_param?: string | null;
  auto_futarchy_cap?: string | null;
  futarchy_reward_token?: string | null;
  config_version: number;
};

type MarketContextProfileStatus = "active" | "archived";

type MarketContextProfileSummary = {
  market_context_profile_id: string;
  profile_key: string;
  provider_keys: Array<string>;
  status: MarketContextProfileStatus;
};

type MediaDescriptor = {
  storage_ref: string;
  mime_type?: string | null;
  size_bytes?: number | null;
  content_hash?: string | null;
  duration_ms?: number | null;
};

type ModerationActionType = "dismiss" | "hide" | "remove" | "restore" | "age_gate";

type ModerationCaseOpenedBy = "platform_analysis" | "user_report" | "mixed";

type ModerationCaseStatus = "open" | "resolved";

type ModerationQueueScope = "community" | "platform";

type ModerationSignalSeverity = "low" | "medium" | "high";

type MultisigGovernanceBackend = {
  governance_mode: "multisig";
  governance_chain_id: number;
  governance_contract_address: string;
  governance_treasury_address?: string | null;
  governance_verification_state: GovernanceVerificationState;
  governance_display_label?: string | null;
  governance_attached_at?: string | null;
  governance_last_verified_at?: string | null;
  governance_metadata: MultisigGovernanceMetadata;
};

type MultisigGovernanceMetadata = {
  owners: Array<string>;
  threshold: number;
  is_safe_compatible: boolean;
  version_label?: string | null;
  master_copy_address?: string | null;
};

type Post = {
  post_id: string;
  community_id: string;
  author_user_id?: string | null;
  authorship_mode: "human_direct" | "user_agent";
  agent_id?: string | null;
  agent_ownership_record_id?: string | null;
  identity_mode: "public" | "anonymous";
  anonymous_scope?: "community_stable" | "thread_stable" | "post_ephemeral" | null;
  anonymous_label?: string | null;
  agent_handle_snapshot?: string | null;
  agent_display_name_snapshot?: string | null;
  agent_owner_handle_snapshot?: string | null;
  agent_ownership_provider_snapshot?: string | null;
  disclosed_qualifiers_json?: Array<DisclosedQualifierSnapshot> | null;
  label_id?: string | null;
  post_type: "text" | "image" | "video" | "link" | "song";
  status: "draft" | "published" | "hidden" | "removed" | "deleted";
  visibility: "public" | "members_only";
  title?: string | null;
  body?: string | null;
  caption?: string | null;
  link_url?: string | null;
  link_og_image_url?: string | null;
  link_og_title?: string | null;
  media_refs?: Array<MediaDescriptor>;
  creator_relation?: PostCreatorRelation | null;
  promotion_disclosure?: PromotionDisclosure | null;
  source_language?: string | null;
  translation_policy?: "none" | "machine_allowed" | "human_only" | "hybrid" | null;
  access_mode?: "public" | "locked" | null;
  asset_id?: string | null;
  song_artifact_bundle_id?: string | null;
  parent_post_id?: string | null;
  song_mode?: "original" | "remix" | null;
  rights_basis?: "none" | "original" | "derivative" | "attribution_only" | null;
  upstream_asset_refs?: Array<string> | null;
  analysis_state: "pending" | "allow" | "allow_with_required_reference" | "review_required" | "blocked";
  analysis_result_ref?: string | null;
  content_safety_state: "pending" | "safe" | "sensitive" | "adult";
  age_gate_policy: "none" | "18_plus";
  created_at: string;
  updated_at: string;
};

type PostCreatorRelation = "captured" | "created" | "subject" | "authorized_repost" | "fan_work" | "found";

type PromotionAffiliationKind = "self" | "brand" | "client" | "partner" | "employer" | "other";

type PromotionDisclosure = {
  is_promotional: boolean;
  affiliation_kind: PromotionAffiliationKind;
};

type ProofRequirement = {
  proof_type: "unique_human" | "biometric_liveness" | "wallet_score" | "gov_id" | "age_over_18" | "minimum_age" | "nationality" | "gender" | "sanctions_clear" | "phone";
  accepted_providers?: Array<"self" | "very" | "passport"> | null;
  accepted_mechanisms?: Array<string> | null;
  config?: (Record<string, unknown>) | null;
};

type ReplyQuotaByTrustTier = {
  new?: ReplyQuotaRule;
  established?: ReplyQuotaRule;
  trusted?: ReplyQuotaRule;
  high_trust?: ReplyQuotaRule;
};

type ReplyQuotaRule = {
  window_hours: number;
  max_replies: number;
  burst_window_minutes: number;
  max_replies_per_burst: number;
};

type RootPostQuotaByTrustTier = {
  new?: RootPostQuotaRule;
  established?: RootPostQuotaRule;
  trusted?: RootPostQuotaRule;
  high_trust?: RootPostQuotaRule;
};

type RootPostQuotaRule = {
  window_hours: number;
  max_root_posts: number;
  max_song_posts: number;
  max_video_posts: number;
};

type UserReportReasonCode = "spam" | "harassment" | "hate" | "sexual_content" | "graphic_content" | "misleading" | "other";
