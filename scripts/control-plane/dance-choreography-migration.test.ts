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
]

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

describe.skipIf(!RUN)("dance choreography migrations 0168-0169 (real Postgres)", () => {
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
})
