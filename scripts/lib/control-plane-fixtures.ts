export type SeedControlPlaneFixtureOptions = {
  databaseUrl: string;
  userId?: string;
  subject?: string;
  providerSubject?: string;
  handle?: string;
  namespaceLabel?: string;
  redditUsername?: string;
  provider?: string;
  issuer?: string;
};

export type SeedControlPlaneFixtureResult = {
  userId: string;
  provider: string;
  issuer: string;
  subject: string;
  providerSubject: string;
  globalHandle: string;
  redditUsername: string;
  namespaceVerificationId: string;
  assertionsJson: string;
  capabilitiesJson: string;
};

type ResolvedOptions = {
  databaseUrl: string;
  userId: string;
  subject: string;
  providerSubject?: string;
  handle: string;
  namespaceLabel: string;
  redditUsername: string;
  provider: string;
  issuer: string;
};

async function namespaceVerificationAssertionsHasFamilyColumn(db: Bun.SQL, databaseUrl: string): Promise<boolean> {
  if (databaseUrl.startsWith("file:")) {
    const rows = await db<{ name: string }[]>`
      SELECT name
      FROM pragma_table_info('namespace_verification_assertions')
      WHERE name = 'family'
    `;
    return rows.length > 0;
  }

  const rows = await db<{ exists: boolean }[]>`
    SELECT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'namespace_verification_assertions'
        AND column_name = 'family'
    ) AS exists
  `;
  return Boolean(rows[0]?.exists);
}

function resolveOptions(input: SeedControlPlaneFixtureOptions): ResolvedOptions {
  return {
    databaseUrl: input.databaseUrl,
    userId: input.userId ?? "usr_demo_01",
    subject: input.subject ?? "demo-subject-01",
    providerSubject: input.providerSubject,
    handle: input.handle ?? "demo",
    namespaceLabel: input.namespaceLabel ?? "demo",
    redditUsername: input.redditUsername ?? "technohippie",
    provider: input.provider ?? "jwt",
    issuer: input.issuer ?? "pirate-dev-upstream",
  };
}

export async function seedControlPlaneFixtures(
  input: SeedControlPlaneFixtureOptions,
): Promise<SeedControlPlaneFixtureResult> {
  const options = resolveOptions(input);
  const now = new Date();
  const nowIso = now.toISOString();
  const expiresAtIso = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString();

  const providerSubject = options.providerSubject ?? `${options.issuer}|${options.subject}`;
  const handleNormalized = options.handle.toLowerCase();
  const handleDisplay = `${handleNormalized}.pirate`;
  const namespaceNormalized = options.namespaceLabel.toLowerCase();

  const authProviderLinkId = `apl_${options.userId}`;
  const verificationSessionId = `ver_${options.userId}_unique_human`;
  const userAttestationId = `att_${options.userId}_unique_human`;
  const globalHandleId = `gh_${options.userId}`;
  const namespaceVerificationSessionId = `nvs_${namespaceNormalized}_${options.userId}`;
  const namespaceVerificationId = `nv_${namespaceNormalized}_${options.userId}`;
  const evidenceBundleId = `nev_${namespaceNormalized}_${options.userId}_accepted`;
  const redditVerificationSessionId = `rvs_${options.userId}_${options.redditUsername}`;
  const externalReputationSnapshotId = `ers_${options.userId}_${options.redditUsername}`;
  const redditImportJobId = `job_${options.userId}_reddit_import`;

  const capabilitiesJson = JSON.stringify({
    unique_human: {
      state: "verified",
      provider: "self",
      proof_type: "unique_human",
      mechanism: "fixture",
      verified_at: nowIso,
    },
    age_over_18: {
      state: "unverified",
      provider: null,
      proof_type: null,
      mechanism: null,
      verified_at: null,
    },
    nationality: {
      state: "unverified",
      provider: null,
      proof_type: null,
      mechanism: null,
      verified_at: null,
      value: null,
    },
    gender: {
      state: "unverified",
      provider: null,
      proof_type: null,
      mechanism: null,
      verified_at: null,
      value: null,
    },
    wallet_score: {
      state: "unverified",
      provider: null,
      proof_type: null,
      mechanism: null,
      verified_at: null,
      score: null,
      score_threshold: null,
      passing_score: null,
      last_score_timestamp: null,
      expiration_timestamp: null,
      stamps: null,
    },
  });

  const requestedCapabilitiesJson = JSON.stringify(["unique_human"]);
  const attestationValueJson = JSON.stringify({ state: "verified", fixture: true });
  const resolverPathJson = JSON.stringify(["fixture"]);
  const rawResponseJson = JSON.stringify({
    fixture: true,
    issuer: options.issuer,
    normalized_root_label: namespaceNormalized,
    root_exists: true,
    root_control_verified: true,
    expiry_horizon_sufficient: true,
    routing_enabled: true,
    pirate_dns_authority_verified: false,
  });
  const assertionsSummaryJson = JSON.stringify({
    root_exists: true,
    root_control_verified: true,
    expiry_horizon_sufficient: true,
    routing_enabled: true,
    pirate_dns_authority_verified: false,
  });
  const capabilitiesShortcutJson = JSON.stringify({
    club_attach_allowed: true,
    pirate_web_routing_allowed: true,
    pirate_subdomain_issuance_allowed: false,
  });
  const redditSnapshotPayloadJson = JSON.stringify({
    account_age_days: 4320,
    post_karma: 18420,
    comment_karma: 25780,
    global_karma: 44200,
    top_subreddits: [
      { subreddit: "electronicmusic", karma: 12400, posts: 84, rank_source: "karma" },
      { subreddit: "ableton", karma: 9100, posts: 61, rank_source: "karma" },
      { subreddit: "synthesizers", karma: 7050, posts: 42, rank_source: "karma" },
      { subreddit: "design", karma: 3810, posts: 28, rank_source: "karma" },
    ],
    moderator_of: ["leftfieldbeats"],
    inferred_interests: ["electronic", "music production", "design"],
    suggested_communities: [
      {
        community_id: "cmt_music_01",
        name: "Electronic Music",
        reason: "Strong activity in electronic music and production subreddits",
      },
      {
        community_id: "cmt_design_01",
        name: "Design",
        reason: "Meaningful design participation overlaps with Pirate design clubs",
      },
    ],
    coverage_note: "Pushpull archival snapshot; local stub fixture for the reference worker.",
  });

  const db = new Bun.SQL(options.databaseUrl);

  try {
    const assertionFamilyColumnPresent = await namespaceVerificationAssertionsHasFamilyColumn(db, options.databaseUrl);

    await db.begin(async (tx) => {
      await tx`
        INSERT INTO users (
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
          ${options.userId},
          NULL,
          'verified',
          'self',
          ${capabilitiesJson},
          ${nowIso},
          NULL,
          NULL,
          ${nowIso},
          ${nowIso}
        )
        ON CONFLICT (user_id) DO UPDATE SET
          verification_state = EXCLUDED.verification_state,
          capability_provider = EXCLUDED.capability_provider,
          verification_capabilities_json = EXCLUDED.verification_capabilities_json,
          verified_at = EXCLUDED.verified_at,
          updated_at = EXCLUDED.updated_at
      `;

      await tx`
        INSERT INTO auth_provider_links (
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
          ${authProviderLinkId},
          ${options.userId},
          ${options.provider},
          ${providerSubject},
          ${options.subject},
          'active',
          ${nowIso},
          NULL,
          ${nowIso},
          ${nowIso}
        )
        ON CONFLICT (auth_provider_link_id) DO UPDATE SET
          provider = EXCLUDED.provider,
          provider_subject = EXCLUDED.provider_subject,
          provider_user_ref = EXCLUDED.provider_user_ref,
          status = EXCLUDED.status,
          updated_at = EXCLUDED.updated_at
      `;

      await tx`
        INSERT INTO verification_sessions (
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
          ${verificationSessionId},
          ${options.userId},
          'self',
          'identity_proof',
          ${requestedCapabilitiesJson},
          'verified',
          'fixture',
          'fixture',
          NULL,
          ${nowIso},
          ${nowIso},
          ${expiresAtIso},
          ${nowIso},
          ${nowIso}
        )
        ON CONFLICT (verification_session_id) DO UPDATE SET
          status = EXCLUDED.status,
          completed_at = EXCLUDED.completed_at,
          expires_at = EXCLUDED.expires_at,
          updated_at = EXCLUDED.updated_at
      `;

      await tx`
        UPDATE users
        SET current_verification_session_id = ${verificationSessionId},
            updated_at = ${nowIso}
        WHERE user_id = ${options.userId}
      `;

      await tx`
        INSERT INTO user_attestations (
          user_attestation_id,
          user_id,
          source_verification_session_id,
          provider,
          attestation_type,
          capability_key,
          status,
          value_json,
          verified_at,
          expires_at,
          revoked_at,
          created_at,
          updated_at
        ) VALUES (
          ${userAttestationId},
          ${options.userId},
          ${verificationSessionId},
          'self',
          'unique_human',
          'unique_human',
          'accepted',
          ${attestationValueJson},
          ${nowIso},
          ${expiresAtIso},
          NULL,
          ${nowIso},
          ${nowIso}
        )
        ON CONFLICT (user_attestation_id) DO UPDATE SET
          status = EXCLUDED.status,
          value_json = EXCLUDED.value_json,
          verified_at = EXCLUDED.verified_at,
          expires_at = EXCLUDED.expires_at,
          updated_at = EXCLUDED.updated_at
      `;

      await tx`
        INSERT INTO global_handles (
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
          ${globalHandleId},
          ${options.userId},
          ${handleNormalized},
          ${handleDisplay},
          'active',
          'generated',
          'generated_signup',
          NULL,
          NULL,
          0,
          ${nowIso},
          NULL,
          ${nowIso},
          ${nowIso}
        )
        ON CONFLICT (global_handle_id) DO UPDATE SET
          label_normalized = EXCLUDED.label_normalized,
          label_display = EXCLUDED.label_display,
          status = EXCLUDED.status,
          updated_at = EXCLUDED.updated_at
      `;

      await tx`
        INSERT INTO profiles (
          user_id,
          display_name,
          bio,
          avatar_ref,
          cover_ref,
          global_handle_id,
          created_at,
          updated_at
        ) VALUES (
          ${options.userId},
          NULL,
          NULL,
          NULL,
          NULL,
          ${globalHandleId},
          ${nowIso},
          ${nowIso}
        )
        ON CONFLICT (user_id) DO UPDATE SET
          display_name = EXCLUDED.display_name,
          global_handle_id = EXCLUDED.global_handle_id,
          updated_at = EXCLUDED.updated_at
      `;

      await tx`
        INSERT INTO namespace_verification_sessions (
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
          ${namespaceVerificationSessionId},
          ${namespaceVerificationId},
          ${options.userId},
          'hns',
          ${options.namespaceLabel},
          ${namespaceNormalized},
          'verified',
          NULL,
          NULL,
          NULL,
          1,
          1,
          1,
          1,
          0,
          1,
          1,
          0,
          'single_holder_root',
          'owner_managed_namespace',
          'fixture',
          ${evidenceBundleId},
          NULL,
          ${nowIso},
          ${expiresAtIso},
          ${nowIso},
          ${nowIso}
        )
        ON CONFLICT (namespace_verification_session_id) DO UPDATE SET
          namespace_verification_id = EXCLUDED.namespace_verification_id,
          status = EXCLUDED.status,
          normalized_root_label = EXCLUDED.normalized_root_label,
          root_exists = EXCLUDED.root_exists,
          root_control_verified = EXCLUDED.root_control_verified,
          expiry_horizon_sufficient = EXCLUDED.expiry_horizon_sufficient,
          routing_enabled = EXCLUDED.routing_enabled,
          pirate_dns_authority_verified = EXCLUDED.pirate_dns_authority_verified,
          club_attach_allowed = EXCLUDED.club_attach_allowed,
          pirate_web_routing_allowed = EXCLUDED.pirate_web_routing_allowed,
          pirate_subdomain_issuance_allowed = EXCLUDED.pirate_subdomain_issuance_allowed,
          evidence_bundle_ref = EXCLUDED.evidence_bundle_ref,
          accepted_at = EXCLUDED.accepted_at,
          expires_at = EXCLUDED.expires_at,
          updated_at = EXCLUDED.updated_at
      `;

      await tx`
        INSERT INTO namespace_verifications (
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
          ${namespaceVerificationId},
          ${namespaceVerificationSessionId},
          ${options.userId},
          'hns',
          ${namespaceNormalized},
          'verified',
          1,
          1,
          1,
          1,
          0,
          1,
          1,
          0,
          'single_holder_root',
          'owner_managed_namespace',
          'fixture',
          ${evidenceBundleId},
          ${nowIso},
          ${expiresAtIso},
          ${nowIso},
          ${nowIso}
        )
        ON CONFLICT (namespace_verification_id) DO UPDATE SET
          status = EXCLUDED.status,
          normalized_root_label = EXCLUDED.normalized_root_label,
          root_exists = EXCLUDED.root_exists,
          root_control_verified = EXCLUDED.root_control_verified,
          expiry_horizon_sufficient = EXCLUDED.expiry_horizon_sufficient,
          routing_enabled = EXCLUDED.routing_enabled,
          pirate_dns_authority_verified = EXCLUDED.pirate_dns_authority_verified,
          club_attach_allowed = EXCLUDED.club_attach_allowed,
          pirate_web_routing_allowed = EXCLUDED.pirate_web_routing_allowed,
          pirate_subdomain_issuance_allowed = EXCLUDED.pirate_subdomain_issuance_allowed,
          evidence_bundle_ref = EXCLUDED.evidence_bundle_ref,
          accepted_at = EXCLUDED.accepted_at,
          expires_at = EXCLUDED.expires_at,
          updated_at = EXCLUDED.updated_at
      `;

      await tx`
        INSERT INTO namespace_verification_evidence_bundles (
          evidence_bundle_id,
          namespace_verification_session_id,
          namespace_verification_id,
          family,
          normalized_root_label,
          evidence_kind,
          provider,
          resolver_path_json,
          raw_response_json,
          evidence_hash,
          observed_at,
          created_at,
          updated_at
        ) VALUES (
          ${evidenceBundleId},
          ${namespaceVerificationSessionId},
          ${namespaceVerificationId},
          'hns',
          ${namespaceNormalized},
          'accepted_snapshot',
          'fixture',
          ${resolverPathJson},
          ${rawResponseJson},
          'fixture',
          ${nowIso},
          ${nowIso},
          ${nowIso}
        )
        ON CONFLICT (evidence_bundle_id) DO UPDATE SET
          namespace_verification_id = EXCLUDED.namespace_verification_id,
          normalized_root_label = EXCLUDED.normalized_root_label,
          raw_response_json = EXCLUDED.raw_response_json,
          observed_at = EXCLUDED.observed_at,
          updated_at = EXCLUDED.updated_at
      `;

      const assertionRows = [
        ["nva_root_exists", "root_exists", 1],
        ["nva_root_control", "root_control_verified", 1],
        ["nva_expiry", "expiry_horizon_sufficient", 1],
        ["nva_routing", "routing_enabled", 1],
        ["nva_pirate_dns", "pirate_dns_authority_verified", 0],
      ] as const;

      for (const [suffix, assertionName, assertionValue] of assertionRows) {
        if (assertionFamilyColumnPresent) {
          await tx`
            INSERT INTO namespace_verification_assertions (
              assertion_record_id,
              namespace_verification_session_id,
              namespace_verification_id,
              family,
              assertion_name,
              assertion_value,
              source_evidence_bundle_id,
              status,
              first_accepted_at,
              last_revalidated_at,
              created_at,
              updated_at
            ) VALUES (
              ${`${suffix}_${namespaceNormalized}_${options.userId}`},
              ${namespaceVerificationSessionId},
              ${namespaceVerificationId},
              'hns',
              ${assertionName},
              ${assertionValue},
              ${evidenceBundleId},
              'accepted',
              ${nowIso},
              ${nowIso},
              ${nowIso},
              ${nowIso}
            )
            ON CONFLICT (assertion_record_id) DO UPDATE SET
              namespace_verification_id = EXCLUDED.namespace_verification_id,
              assertion_value = EXCLUDED.assertion_value,
              status = EXCLUDED.status,
              first_accepted_at = EXCLUDED.first_accepted_at,
              last_revalidated_at = EXCLUDED.last_revalidated_at,
              updated_at = EXCLUDED.updated_at
          `;
          continue;
        }

        await tx`
          INSERT INTO namespace_verification_assertions (
            assertion_record_id,
            namespace_verification_session_id,
            namespace_verification_id,
            assertion_name,
            assertion_value,
            source_evidence_bundle_id,
            status,
            first_accepted_at,
            last_revalidated_at,
            created_at,
            updated_at
          ) VALUES (
            ${`${suffix}_${namespaceNormalized}_${options.userId}`},
            ${namespaceVerificationSessionId},
            ${namespaceVerificationId},
            ${assertionName},
            ${assertionValue},
            ${evidenceBundleId},
            'accepted',
            ${nowIso},
            ${nowIso},
            ${nowIso},
            ${nowIso}
          )
          ON CONFLICT (assertion_record_id) DO UPDATE SET
            namespace_verification_id = EXCLUDED.namespace_verification_id,
            assertion_value = EXCLUDED.assertion_value,
            status = EXCLUDED.status,
            first_accepted_at = EXCLUDED.first_accepted_at,
            last_revalidated_at = EXCLUDED.last_revalidated_at,
            updated_at = EXCLUDED.updated_at
        `;
      }

      await tx`
        INSERT INTO reddit_verification_sessions (
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
          ${redditVerificationSessionId},
          ${options.userId},
          ${options.redditUsername},
          'pirate-fixture',
          'profile',
          'verified',
          'Fixture Reddit verification already satisfied.',
          NULL,
          1,
          ${nowIso},
          ${nowIso},
          ${expiresAtIso},
          ${nowIso},
          ${nowIso}
        )
        ON CONFLICT (reddit_verification_session_id) DO UPDATE SET
          reddit_username = EXCLUDED.reddit_username,
          verification_code = EXCLUDED.verification_code,
          code_placement_surface = EXCLUDED.code_placement_surface,
          status = EXCLUDED.status,
          verification_hint = EXCLUDED.verification_hint,
          failure_code = EXCLUDED.failure_code,
          checked_count = EXCLUDED.checked_count,
          last_checked_at = EXCLUDED.last_checked_at,
          verified_at = EXCLUDED.verified_at,
          expires_at = EXCLUDED.expires_at,
          updated_at = EXCLUDED.updated_at
      `;

      await tx`
        INSERT INTO external_reputation_snapshots (
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
          ${externalReputationSnapshotId},
          ${options.userId},
          'reddit',
          'onboarding',
          ${options.redditUsername},
          'profile_code',
          ${nowIso},
          ${redditSnapshotPayloadJson},
          ${nowIso},
          ${nowIso}
        )
        ON CONFLICT (external_reputation_snapshot_id) DO UPDATE SET
          source_account_handle = EXCLUDED.source_account_handle,
          captured_at = EXCLUDED.captured_at,
          snapshot_payload_json = EXCLUDED.snapshot_payload_json,
          updated_at = EXCLUDED.updated_at
      `;

      await tx`
        INSERT INTO jobs (
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
          ${redditImportJobId},
          'reddit_snapshot_import',
          'platform',
          NULL,
          'user',
          ${options.userId},
          'succeeded',
          ${JSON.stringify({
            reddit_username: options.redditUsername,
            mode: "fixture_seed",
          })},
          ${externalReputationSnapshotId},
          NULL,
          1,
          ${nowIso},
          ${nowIso},
          ${nowIso}
        )
        ON CONFLICT (job_id) DO UPDATE SET
          status = EXCLUDED.status,
          payload_json = EXCLUDED.payload_json,
          result_ref = EXCLUDED.result_ref,
          error_code = EXCLUDED.error_code,
          attempt_count = EXCLUDED.attempt_count,
          available_at = EXCLUDED.available_at,
          updated_at = EXCLUDED.updated_at
      `;
    });
  } finally {
    await db.end();
  }

  return {
    userId: options.userId,
    provider: options.provider,
    issuer: options.issuer,
    subject: options.subject,
    providerSubject,
    globalHandle: options.handle,
    redditUsername: options.redditUsername,
    namespaceVerificationId,
    assertionsJson: assertionsSummaryJson,
    capabilitiesJson: capabilitiesShortcutJson,
  };
}
