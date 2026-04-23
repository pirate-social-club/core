export type ConversionOverview = {
  page_views: number
  unique_visitors: number
  auth_started: number
  users_created: number
  human_verification_started: number
  human_verification_succeeded: number
  human_verification_failed: number
  reddit_import_started: number
  reddit_import_succeeded: number
  reddit_import_failed: number
  onboarding_completed: number
  visitor_to_user_rate: number
  human_verification_success_rate: number
  human_verification_failure_rate: number
  onboarding_completion_rate: number
}

export type FunnelStep = {
  step_order: number
  step_name: string
  users: number
  rate_from_start: number
}

export type VerificationFailure = {
  event_time: string
  source: string
  app_surface: string
  session_id: string
  anonymous_id: string
  user_id_hash: string
  request_id: string
  provider: string
  failure_code: string
  provider_error_code: string
  attempt_number: number
  latency_ms: number
}

export type CommunityImportHealth = {
  day: string
  tld: string
  community_create_started: number
  community_create_submitted: number
  namespace_verification_started: number
  namespace_verification_succeeded: number
  namespace_verification_failed: number
  provisioning_requested: number
  provisioning_succeeded: number
  provisioning_failed: number
  registry_publication_succeeded: number
  registry_publication_failed: number
  reddit_import_started: number
  reddit_import_succeeded: number
  reddit_import_failed: number
  provisioning_failure_rate: number
  reddit_import_failure_rate: number
}

export type EventQuality = {
  hour: string
  environment: string
  source: string
  received_events: number
  unique_event_ids: number
  duplicate_event_ids: number
  missing_event_id: number
  missing_event_name: number
  missing_identity: number
  invalid_environment: number
  invalid_source: number
}

export type DashboardData = {
  actor: string
  generatedAt: string
  filters: {
    environment: string
    start_time: string
    end_time: string
  }
  conversion: ConversionOverview
  onboarding: FunnelStep[]
  verificationFailures: VerificationFailure[]
  communityImportHealth: CommunityImportHealth[]
  eventQuality: EventQuality[]
}
