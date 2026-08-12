import { SQL } from "bun"
import { afterAll, beforeAll, describe, expect, test } from "bun:test"

const ADMIN_URL =
  process.env.CONTROL_PLANE_MIGRATION_TEST_ADMIN_URL
  ?? process.env.BOOKINGS_MIGRATION_TEST_ADMIN_URL
const RUN = Boolean(ADMIN_URL)
const TEST_DB = "dance_choreography_migration_test"
const MIGRATION_FILES = [
  "db/control-plane/migrations/0168_control_plane_dance_choreographies.sql",
  "db/control-plane/migrations/0169_control_plane_dance_reference_dispatch.sql",
  "db/control-plane/migrations/0170_control_plane_dance_attempt_sessions.sql",
  "db/control-plane/migrations/0171_control_plane_dance_attempt_reason_contract.sql",
  "db/control-plane/migrations/0201_control_plane_dance_attempt_cancellation.sql",
  "db/control-plane/migrations/0203_control_plane_dance_placeholder_expiry_cleanup.sql",
  "db/control-plane/migrations/0204_control_plane_dance_placeholder_cleanup_backfill.sql",
  "db/control-plane/migrations/0206_control_plane_dance_consent_receipts.sql",
  "db/control-plane/migrations/0210_control_plane_dance_consent_contract_tightening.sql",
  "db/control-plane/migrations/0211_control_plane_dance_start_cues.sql",
  "db/control-plane/migrations/0212_control_plane_dance_start_cue_backfill.sql",
  "db/control-plane/migrations/0215_control_plane_dance_one_active_session.sql",
]
const OVERLONG_SEGMENT_FINGERPRINT_JSON = JSON.stringify(
  Array.from({ length: 33 }, () => "8".repeat(64)),
)

function connect(db = "postgres"): SQL {
  const url = new URL(ADMIN_URL as string)
  url.pathname = `/${db}`
  if (!url.searchParams.get("sslmode")) url.searchParams.set("sslmode", "disable")
  return new SQL({ url: url.toString(), tls: false, max: 1, connectionTimeout: 5 })
}

async function expectSqlState(
  sql: SQL,
  statement: string,
  expected: string,
): Promise<void> {
  let caught: { errno?: string } | undefined
  try {
    await sql.unsafe(statement)
  } catch (error) {
    caught = error as { errno?: string }
  }
  expect(caught, `expected SQLSTATE ${expected}, got success`).toBeDefined()
  expect(caught?.errno).toBe(expected)
}

describe.skipIf(!RUN)("dance migrations 0168-0171 and 0201-0216 (real Postgres)", () => {
  beforeAll(async () => {
    const root = connect()
    await root.unsafe(`DROP DATABASE IF EXISTS ${TEST_DB} WITH (FORCE)`)
    await root.unsafe(`CREATE DATABASE ${TEST_DB}`)
    await root.end()

    const db = connect(TEST_DB)
    await db.unsafe(`
      CREATE TABLE users (user_id TEXT PRIMARY KEY);
      CREATE TABLE communities (community_id TEXT PRIMARY KEY);
      CREATE TABLE song_artifact_bundles (
        song_artifact_bundle_id TEXT PRIMARY KEY
      );
      INSERT INTO users VALUES ('usr_creator');
      INSERT INTO users VALUES ('usr_other');
      INSERT INTO communities VALUES ('cmty_test');
      INSERT INTO song_artifact_bundles VALUES ('sab_song');
    `)
    for (const migrationFile of MIGRATION_FILES) {
      await db.unsafe(await Bun.file(migrationFile).text())
    }
    await db.end()
  })

  afterAll(async () => {
    if (!RUN) return
    const root = connect()
    await root.unsafe(`DROP DATABASE IF EXISTS ${TEST_DB} WITH (FORCE)`).catch(() => {})
    await root.end()
  })

  test("ready revisions require complete artifact bindings", async () => {
    const db = connect(TEST_DB)
    await db.unsafe(`
      INSERT INTO dance_choreographies (
        dance_choreography_id, community_id, host_post_id, referenced_song_post_id,
        song_artifact_bundle_id, creator_user_id, status
      ) VALUES (
        'dch_primary', 'cmty_test', 'post_dance', 'post_song',
        'sab_song', 'usr_creator', 'processing'
      )
    `)
    await expectSqlState(db, `
      INSERT INTO dance_choreography_revisions (
        dance_choreography_revision_id, dance_choreography_id, revision_number,
        reference_storage_ref, reference_content_sha256, reference_mime_type,
        reference_size_bytes, status, ready_at
      ) VALUES (
        'dcr_incomplete', 'dch_primary', 1,
        'r2://references/incomplete.mp4', '${"a".repeat(64)}',
        'video/mp4', 1024, 'ready', NOW()
      )
    `, "23514")
    await db.end()
  })

  test("ready facts are immutable, retirement is terminal, and activation is scoped", async () => {
    const db = connect(TEST_DB)
    await db.unsafe(`
      INSERT INTO dance_choreography_revisions (
        dance_choreography_revision_id, dance_choreography_id, revision_number,
        reference_storage_ref, reference_content_sha256, reference_mime_type,
        reference_size_bytes, status, reference_next_dispatch_at
      ) VALUES (
        'dcr_ready', 'dch_primary', 1,
        'r2://references/ref.mp4', '${"b".repeat(64)}',
        'video/mp4', 1024, 'processing', NOW()
      );
      UPDATE dance_choreography_revisions SET
        reference_duration_ms = 10000,
        reference_width = 576,
        reference_height = 1024,
        reference_fps_millihertz = 30000,
        reference_feature_ref = 'r2://features/ref.json',
        reference_feature_sha256 = '${"c".repeat(64)}',
        reference_feature_size_bytes = 2048,
        pose_model_version = 'pose_v1',
        pose_model_sha256 = '${"d".repeat(64)}',
        pose_runtime_version = '0.10.35',
        feature_schema_version = 'features_v1',
        scorer_version = 'scorer_v1',
        artifact_version = 'artifact_v1',
        reference_next_dispatch_at = NULL,
        status = 'ready',
        ready_at = NOW()
      WHERE dance_choreography_revision_id = 'dcr_ready';
      UPDATE dance_choreographies SET
        status = 'ready',
        active_revision_id = 'dcr_ready'
      WHERE dance_choreography_id = 'dch_primary';
    `)

    await expectSqlState(db, `
      UPDATE dance_choreography_revisions
      SET mirror_policy = 'strict'
      WHERE dance_choreography_revision_id = 'dcr_ready'
    `, "P0001")

    await db.unsafe(`
      UPDATE dance_choreography_revisions
      SET status = 'retired', retired_at = NOW()
      WHERE dance_choreography_revision_id = 'dcr_ready'
    `)
    await expectSqlState(db, `
      UPDATE dance_choreography_revisions
      SET status = 'ready', retired_at = NULL
      WHERE dance_choreography_revision_id = 'dcr_ready'
    `, "P0001")

    await db.unsafe(`
      INSERT INTO dance_choreographies (
        dance_choreography_id, community_id, host_post_id, referenced_song_post_id,
        song_artifact_bundle_id, creator_user_id, status
      ) VALUES (
        'dch_other', 'cmty_test', 'post_other_dance', 'post_song',
        'sab_song', 'usr_creator', 'processing'
      )
    `)
    await expectSqlState(db, `
      UPDATE dance_choreographies
      SET active_revision_id = 'dcr_ready'
      WHERE dance_choreography_id = 'dch_other'
    `, "23503")
    await db.end()
  })

  test("dispatch claims are paired, bounded, and cleared before terminal state", async () => {
    const db = connect(TEST_DB)
    await db.unsafe(`
      INSERT INTO dance_choreographies (
        dance_choreography_id, community_id, host_post_id, referenced_song_post_id,
        song_artifact_bundle_id, creator_user_id, status
      ) VALUES (
        'dch_dispatch', 'cmty_test', 'post_dispatch', 'post_song',
        'sab_song', 'usr_creator', 'processing'
      );
      INSERT INTO dance_choreography_revisions (
        dance_choreography_revision_id, dance_choreography_id, revision_number,
        reference_storage_ref, reference_content_sha256, reference_mime_type,
        reference_size_bytes, status, reference_next_dispatch_at
      ) VALUES (
        'dcr_dispatch', 'dch_dispatch', 1,
        'r2://references/dispatch.mp4', '${"e".repeat(64)}',
        'video/mp4', 1024, 'processing', NOW()
      );
    `)

    await expectSqlState(db, `
      UPDATE dance_choreography_revisions
      SET reference_dispatch_claim_token = 'claim_unpaired'
      WHERE dance_choreography_revision_id = 'dcr_dispatch'
    `, "23514")
    await expectSqlState(db, `
      UPDATE dance_choreography_revisions
      SET reference_dispatch_attempt_count = 6
      WHERE dance_choreography_revision_id = 'dcr_dispatch'
    `, "23514")
    await expectSqlState(db, `
      UPDATE dance_choreography_revisions
      SET status = 'failed', failure_code = 'video_invalid'
      WHERE dance_choreography_revision_id = 'dcr_dispatch'
    `, "23514")

    await db.unsafe(`
      UPDATE dance_choreography_revisions
      SET status = 'failed',
          failure_code = 'video_invalid',
          reference_next_dispatch_at = NULL
      WHERE dance_choreography_revision_id = 'dcr_dispatch'
    `)
    await db.end()
  })

  test("attempt sessions bind uploads, dispatch state, terminal facts, and cleanup", async () => {
    const db = connect(TEST_DB)
    await db.unsafe(`
      INSERT INTO dance_choreographies (
        dance_choreography_id, community_id, host_post_id, referenced_song_post_id,
        song_artifact_bundle_id, creator_user_id, status
      ) VALUES (
        'dch_attempt', 'cmty_test', 'post_attempt_dance', 'post_song',
        'sab_song', 'usr_creator', 'processing'
      );
      INSERT INTO dance_choreography_revisions (
        dance_choreography_revision_id, dance_choreography_id, revision_number,
        reference_storage_ref, reference_content_sha256, reference_mime_type,
        reference_size_bytes, status, reference_next_dispatch_at
      ) VALUES (
        'dcr_attempt', 'dch_attempt', 1,
        'r2://references/attempt.mp4', '${"1".repeat(64)}',
        'video/mp4', 1024, 'processing', NOW()
      );
      UPDATE dance_choreography_revisions SET
        reference_duration_ms = 10000,
        reference_width = 576,
        reference_height = 1024,
        reference_fps_millihertz = 30000,
        reference_feature_ref = 'r2://features/attempt.json',
        reference_feature_sha256 = '${"2".repeat(64)}',
        reference_feature_size_bytes = 2048,
        pose_model_version = 'pose_v1',
        pose_model_sha256 = '${"3".repeat(64)}',
        pose_runtime_version = '0.10.35',
        feature_schema_version = 'features_v1',
        scorer_version = 'scorer_v1',
        artifact_version = 'artifact_v1',
        reference_next_dispatch_at = NULL,
        status = 'ready',
        ready_at = NOW()
      WHERE dance_choreography_revision_id = 'dcr_attempt';
      UPDATE dance_choreographies SET
        status = 'ready',
        active_revision_id = 'dcr_attempt'
      WHERE dance_choreography_id = 'dch_attempt';

      INSERT INTO dance_attempt_sessions (
        dance_attempt_session_id, dance_attempt_id, subject_user_id, community_id,
        host_post_id, referenced_song_post_id, song_artifact_bundle_id,
        dance_choreography_id, dance_choreography_revision_id,
        reference_content_sha256, reference_feature_ref, reference_feature_sha256,
        reference_feature_size_bytes, pose_model_version, pose_model_sha256,
        feature_schema_version, scorer_version, artifact_version,
        required_calibration_version, required_calibration_checksum,
        required_fingerprint_policy_version, required_integrity_policy_version,
        mirror_policy,
        status, activity_date, activity_timezone, creation_idempotency_key,
        upload_object_key, expected_mime_type, maximum_bytes, expires_at,
        consent_policy_version, consented_at, consent_source
      ) VALUES (
        'dse_attempt', 'dat_attempt', 'usr_creator', 'cmty_test',
        'post_attempt_dance', 'post_song', 'sab_song',
        'dch_attempt', 'dcr_attempt',
        '${"1".repeat(64)}', 'r2://features/attempt.json', '${"2".repeat(64)}',
        2048, 'pose_v1', '${"3".repeat(64)}',
        'features_v1', 'scorer_v1', 'artifact_v1',
        'provisional_v1', '${"5".repeat(64)}', 'fingerprint_v1', 'integrity_v1',
        'allowed',
        'initialized', CURRENT_DATE, 'UTC', 'idem_attempt',
        'dance-attempts/random/attempt.mp4', 'video/mp4', 19000000,
        NOW() + INTERVAL '15 minutes',
        'dance_recording_v1', NOW(), 'api'
      );
    `)

    await expectSqlState(db, `
      UPDATE dance_attempt_sessions
      SET grading_dispatch_claim_token = 'unpaired'
      WHERE dance_attempt_session_id = 'dse_attempt'
    `, "23514")

    await db.unsafe(`
      UPDATE dance_attempt_sessions SET
        status = 'submitted',
        observed_size_bytes = 4096,
        observed_etag = 'etag',
        observed_content_sha256 = '${"4".repeat(64)}',
        capture_mode = 'in_app_camera',
        submitted_at = NOW(),
        grading_next_dispatch_at = NOW(),
        cleanup_status = 'pending',
        cleanup_next_attempt_at = NOW() + INTERVAL '15 minutes'
      WHERE dance_attempt_session_id = 'dse_attempt'
    `)

    await expectSqlState(db, `
      UPDATE dance_attempt_sessions SET
        status = 'finalized',
        terminal_outcome = 'scored',
        score_bps = 5112,
        calibration_version = 'provisional_v1',
        calibration_checksum = '${"5".repeat(64)}',
        calibration_admitted = 0,
        grader_result_digest = '${"6".repeat(64)}',
        finalized_at = NOW()
      WHERE dance_attempt_session_id = 'dse_attempt'
    `, "23514")

    await db.unsafe(`
      UPDATE dance_attempt_sessions SET
        status = 'finalized',
        terminal_outcome = 'scored',
        score_bps = 5112,
        calibration_version = 'provisional_v1',
        calibration_checksum = '${"5".repeat(64)}',
        calibration_admitted = 0,
        grader_result_digest = '${"6".repeat(64)}',
        finalized_at = NOW(),
        grading_next_dispatch_at = NULL
      WHERE dance_attempt_session_id = 'dse_attempt'
    `)

    const [row] = await db`
      SELECT status, score_bps, calibration_admitted, cleanup_status
      FROM dance_attempt_sessions
      WHERE dance_attempt_session_id = 'dse_attempt'
    `
    expect(row).toMatchObject({
      status: "finalized",
      score_bps: 5112,
      calibration_admitted: 0,
      cleanup_status: "pending",
    })

    await expectSqlState(db, `
      INSERT INTO dance_attempt_fingerprints (
        dance_attempt_id, dance_attempt_session_id, subject_user_id,
        dance_choreography_revision_id, fingerprint_policy_version,
        whole_attempt_hmac_sha256, segment_hmac_sha256_json,
        terminal_integrity_outcome, expires_at
      ) VALUES (
        'dat_attempt', 'dse_attempt', 'usr_creator', 'dcr_attempt',
        'fingerprint_v1', '${"7".repeat(64)}', '${OVERLONG_SEGMENT_FINGERPRINT_JSON}',
        'passed', NOW() + INTERVAL '90 days'
      )
    `, "23514")

    await db.unsafe(`
      INSERT INTO dance_attempt_fingerprints (
        dance_attempt_id, dance_attempt_session_id, subject_user_id,
        dance_choreography_revision_id, fingerprint_policy_version,
        whole_attempt_hmac_sha256, segment_hmac_sha256_json,
        terminal_integrity_outcome, expires_at
      ) VALUES (
        'dat_attempt', 'dse_attempt', 'usr_creator', 'dcr_attempt',
        'fingerprint_v1', '${"7".repeat(64)}', '["${"8".repeat(64)}"]',
        'passed', NOW() + INTERVAL '90 days'
      )
    `)

    await expectSqlState(db, `
      UPDATE dance_attempt_sessions SET
        status = 'rejected',
        terminal_outcome = 'rejected',
        terminal_reason = 'insufficient_motion',
        score_bps = NULL,
        grader_result_digest = '${"9".repeat(64)}'
      WHERE dance_attempt_session_id = 'dse_attempt'
    `, "P0001")
    await db.end()
  })

  test("user cancellation is terminal and distinct from expiry", async () => {
    const db = connect(TEST_DB)
    await db.unsafe(`
      INSERT INTO dance_attempt_sessions (
        dance_attempt_session_id, dance_attempt_id, subject_user_id, community_id,
        host_post_id, referenced_song_post_id, song_artifact_bundle_id,
        dance_choreography_id, dance_choreography_revision_id,
        reference_content_sha256, reference_feature_ref, reference_feature_sha256,
        reference_feature_size_bytes, pose_model_version, pose_model_sha256,
        feature_schema_version, scorer_version, artifact_version,
        required_calibration_version, required_calibration_checksum,
        required_fingerprint_policy_version, required_integrity_policy_version,
        mirror_policy, status, activity_date, activity_timezone,
        creation_idempotency_key, upload_object_key, expected_mime_type,
        maximum_bytes, expires_at
      ) VALUES (
        'dse_cancelled', 'dat_cancelled', 'usr_creator', 'cmty_test',
        'post_attempt_dance', 'post_song', 'sab_song',
        'dch_attempt', 'dcr_attempt',
        '${"1".repeat(64)}', 'r2://features/attempt.json', '${"2".repeat(64)}',
        2048, 'pose_v1', '${"3".repeat(64)}',
        'features_v1', 'scorer_v1', 'artifact_v1',
        'provisional_v1', '${"5".repeat(64)}', 'fingerprint_v1', 'integrity_v1',
        'allowed', 'initialized', CURRENT_DATE, 'UTC',
        'idem_cancelled', 'dance/attempt-media/dse_cancelled/pending.mp4',
        'video/mp4', 19000000, NOW() + INTERVAL '15 minutes'
      );
      UPDATE dance_attempt_sessions SET
        status = 'cancelled', terminal_reason = 'cancelled', finalized_at = NOW()
      WHERE dance_attempt_session_id = 'dse_cancelled';
    `)

    const [row] = await db`
      SELECT status, terminal_reason, cleanup_status
      FROM dance_attempt_sessions
      WHERE dance_attempt_session_id = 'dse_cancelled'
    `
    expect(row).toMatchObject({
      status: "cancelled",
      terminal_reason: "cancelled",
      cleanup_status: "not_required",
    })
    await expectSqlState(db, `
      UPDATE dance_attempt_sessions
      SET status = 'expired', terminal_reason = 'session_expired'
      WHERE dance_attempt_session_id = 'dse_cancelled'
    `, "P0001")
    await db.end()
  })

  test("recording consent receipts are complete, versioned, source-bounded, and immutable", async () => {
    const db = connect(TEST_DB)
    await expectSqlState(db, `
      UPDATE dance_attempt_sessions
      SET consent_policy_version = NULL,
          consented_at = NULL,
          consent_source = NULL
      WHERE dance_attempt_session_id = 'dse_attempt'
    `, "P0001")
    await expectSqlState(db, `
      UPDATE dance_attempt_sessions
      SET consent_policy_version = 'dance_recording_v1',
          consented_at = NOW(),
          consent_source = 'telegram'
      WHERE dance_attempt_session_id = 'dse_attempt'
    `, "P0001")
    const [row] = await db`
      SELECT consent_policy_version, consented_at, consent_source
      FROM dance_attempt_sessions
      WHERE dance_attempt_session_id = 'dse_attempt'
    `
    expect(row).toMatchObject({
      consent_policy_version: "dance_recording_v1",
      consent_source: "api",
    })
    expect(row.consented_at).toBeInstanceOf(Date)
    await db.end()
  })

  test("expired placeholder sessions do not require object cleanup", async () => {
    const db = connect(TEST_DB)
    await db.unsafe(`
      INSERT INTO dance_attempt_sessions (
        dance_attempt_session_id, dance_attempt_id, subject_user_id, community_id,
        host_post_id, referenced_song_post_id, song_artifact_bundle_id,
        dance_choreography_id, dance_choreography_revision_id,
        reference_content_sha256, reference_feature_ref, reference_feature_sha256,
        reference_feature_size_bytes, pose_model_version, pose_model_sha256,
        feature_schema_version, scorer_version, artifact_version,
        required_calibration_version, required_calibration_checksum,
        required_fingerprint_policy_version, required_integrity_policy_version,
        mirror_policy, status, activity_date, activity_timezone,
        creation_idempotency_key, upload_object_key, expected_mime_type,
        maximum_bytes, expires_at
      ) VALUES (
        'dse_expired_placeholder', 'dat_expired_placeholder', 'usr_creator', 'cmty_test',
        'post_attempt_dance', 'post_song', 'sab_song',
        'dch_attempt', 'dcr_attempt',
        '${"1".repeat(64)}', 'r2://features/attempt.json', '${"2".repeat(64)}',
        2048, 'pose_v1', '${"3".repeat(64)}',
        'features_v1', 'scorer_v1', 'artifact_v1',
        'provisional_v1', '${"5".repeat(64)}', 'fingerprint_v1', 'integrity_v1',
        'allowed', 'initialized', CURRENT_DATE, 'UTC',
        'idem_expired_placeholder',
        'dance/attempt-media/dse_expired_placeholder/pending.mp4',
        'video/mp4', 19000000, NOW() - INTERVAL '1 minute'
      );
      UPDATE dance_attempt_sessions SET
        status = 'expired', terminal_reason = 'session_expired',
        finalized_at = NOW(), cleanup_status = 'not_required'
      WHERE dance_attempt_session_id = 'dse_expired_placeholder';
    `)

    const [row] = await db`
      SELECT status, cleanup_status
      FROM dance_attempt_sessions
      WHERE dance_attempt_session_id = 'dse_expired_placeholder'
    `
    expect(row).toMatchObject({ status: "expired", cleanup_status: "not_required" })
    await db.end()
  })

  test("backfills queued cleanup for expired placeholder sessions", async () => {
    const db = connect(TEST_DB)
    await db.unsafe(`
      INSERT INTO dance_attempt_sessions (
        dance_attempt_session_id, dance_attempt_id, subject_user_id, community_id,
        host_post_id, referenced_song_post_id, song_artifact_bundle_id,
        dance_choreography_id, dance_choreography_revision_id,
        reference_content_sha256, reference_feature_ref, reference_feature_sha256,
        reference_feature_size_bytes, pose_model_version, pose_model_sha256,
        feature_schema_version, scorer_version, artifact_version,
        required_calibration_version, required_calibration_checksum,
        required_fingerprint_policy_version, required_integrity_policy_version,
        mirror_policy, status, activity_date, activity_timezone,
        creation_idempotency_key, upload_object_key, expected_mime_type,
        maximum_bytes, expires_at, finalized_at, terminal_reason,
        cleanup_status, cleanup_next_attempt_at
      ) VALUES (
        'dse_backfill_placeholder', 'dat_backfill_placeholder', 'usr_creator', 'cmty_test',
        'post_attempt_dance', 'post_song', 'sab_song',
        'dch_attempt', 'dcr_attempt',
        '${"1".repeat(64)}', 'r2://features/attempt.json', '${"2".repeat(64)}',
        2048, 'pose_v1', '${"3".repeat(64)}',
        'features_v1', 'scorer_v1', 'artifact_v1',
        'provisional_v1', '${"5".repeat(64)}', 'fingerprint_v1', 'integrity_v1',
        'allowed', 'expired', CURRENT_DATE, 'UTC',
        'idem_backfill_placeholder',
        'dance/attempt-media/dse_backfill_placeholder/pending.mp4',
        'video/mp4', 19000000, NOW() - INTERVAL '2 minutes', NOW(),
        'session_expired', 'pending', NOW()
      );
    `)
    await db.unsafe(await Bun.file(
      "db/control-plane/migrations/0204_control_plane_dance_placeholder_cleanup_backfill.sql",
    ).text())

    const [row] = await db`
      SELECT cleanup_status, cleanup_attempt_count, cleanup_next_attempt_at
      FROM dance_attempt_sessions
      WHERE dance_attempt_session_id = 'dse_backfill_placeholder'
    `
    expect(row).toMatchObject({
      cleanup_status: "not_required",
      cleanup_attempt_count: 0,
      cleanup_next_attempt_at: null,
    })
    await db.end()
  })

  test("expires pre-cue sessions without retaining predictable assignments", async () => {
    const db = connect(TEST_DB)
    await db.unsafe(`
      INSERT INTO dance_attempt_sessions (
        dance_attempt_session_id, dance_attempt_id, subject_user_id, community_id,
        host_post_id, referenced_song_post_id, song_artifact_bundle_id,
        dance_choreography_id, dance_choreography_revision_id,
        reference_content_sha256, reference_feature_ref, reference_feature_sha256,
        reference_feature_size_bytes, pose_model_version, pose_model_sha256,
        feature_schema_version, scorer_version, artifact_version,
        required_calibration_version, required_calibration_checksum,
        required_fingerprint_policy_version, required_integrity_policy_version,
        mirror_policy, status, activity_date, activity_timezone,
        creation_idempotency_key, upload_object_key, expected_mime_type,
        maximum_bytes, expires_at, start_cue_policy_version, start_cue_kind,
        start_cue_minimum_hold_ms, start_cue_observation_window_ms,
        observed_size_bytes, observed_etag, observed_content_sha256,
        capture_mode, submitted_at, cleanup_status, cleanup_next_attempt_at
      ) VALUES
      (
        'dse_legacy_placeholder', 'dat_legacy_placeholder', 'usr_creator', 'cmty_test',
        'post_attempt_dance', 'post_song', 'sab_song', 'dch_attempt', 'dcr_attempt',
        '${"1".repeat(64)}', 'r2://features/attempt.json', '${"2".repeat(64)}',
        2048, 'pose_v1', '${"3".repeat(64)}', 'features_v1', 'scorer_v1', 'artifact_v1',
        'provisional_v1', '${"5".repeat(64)}', 'fingerprint_v1', 'integrity_v1',
        'allowed', 'initialized', CURRENT_DATE, 'UTC', 'idem_legacy_placeholder',
        'dance/attempt-media/dse_legacy_placeholder/pending.mp4', 'video/mp4',
        19000000, NOW() + INTERVAL '15 minutes', 'dance_start_cue_gross_body_v1',
        'arms_t', 500, 2500, NULL, NULL, NULL, NULL, NULL, 'not_required', NULL
      ),
      (
        'dse_legacy_uploaded', 'dat_legacy_uploaded', 'usr_other', 'cmty_test',
        'post_attempt_dance', 'post_song', 'sab_song', 'dch_attempt', 'dcr_attempt',
        '${"1".repeat(64)}', 'r2://features/attempt.json', '${"2".repeat(64)}',
        2048, 'pose_v1', '${"3".repeat(64)}', 'features_v1', 'scorer_v1', 'artifact_v1',
        'provisional_v1', '${"5".repeat(64)}', 'fingerprint_v1', 'integrity_v1',
        'allowed', 'submitted', CURRENT_DATE, 'UTC', 'idem_legacy_uploaded',
        'dance-attempts/legacy/upload.mp4', 'video/mp4', 19000000,
        NOW() + INTERVAL '15 minutes', 'dance_start_cue_gross_body_v1',
        'hands_on_head', 500, 2500,
        4096, 'etag', '${"4".repeat(64)}', 'in_app_camera', NOW(), 'pending', NOW()
      )
    `)
    await db.unsafe(await Bun.file(
      "db/control-plane/migrations/0216_control_plane_dance_expire_legacy_cue_sessions.sql",
    ).text())

    const rows = await db`
      SELECT dance_attempt_session_id, status, terminal_reason, finalized_at,
             grading_dispatch_claim_token, grading_dispatch_claim_expires_at,
             grading_next_dispatch_at, cleanup_status, cleanup_attempt_count,
             cleanup_next_attempt_at
      FROM dance_attempt_sessions
      WHERE dance_attempt_session_id IN ('dse_legacy_placeholder', 'dse_legacy_uploaded')
      ORDER BY dance_attempt_session_id
    `
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({
      dance_attempt_session_id: "dse_legacy_placeholder",
      status: "expired",
      terminal_reason: "session_expired",
      grading_dispatch_claim_token: null,
      grading_dispatch_claim_expires_at: null,
      grading_next_dispatch_at: null,
      cleanup_status: "not_required",
      cleanup_attempt_count: 0,
      cleanup_next_attempt_at: null,
    })
    expect(rows[1]).toMatchObject({
      dance_attempt_session_id: "dse_legacy_uploaded",
      status: "expired",
      terminal_reason: "session_expired",
      grading_dispatch_claim_token: null,
      grading_dispatch_claim_expires_at: null,
      grading_next_dispatch_at: null,
      cleanup_status: "pending",
      cleanup_attempt_count: 0,
    })
    expect(rows[0].finalized_at).toBeInstanceOf(Date)
    expect(rows[1].finalized_at).toBeInstanceOf(Date)
    expect(rows[1].cleanup_next_attempt_at).toBeInstanceOf(Date)
    await db.end()
  })
})
