import { describe, expect, test } from "bun:test"
import { Database } from "bun:sqlite"

const migrationPaths = [
  "../../db/community-template/migrations/1145_dance_attempts.sql",
  "../../db/community-template/migrations/1146_dance_attempt_reason_contract.sql",
  "../../db/community-template/migrations/1147_dance_attempt_upload_invalid_reason.sql",
].map((path) => new URL(path, import.meta.url))
const hex = (character: string) => character.repeat(64)

describe("1145 dance attempts migration", () => {
  test("keeps evidence bounded and forbids reward eligibility under provisional calibration", async () => {
    const db = new Database(":memory:")
    try {
      db.exec(`
        CREATE TABLE posts (post_id TEXT PRIMARY KEY);
        CREATE TABLE communities (community_id TEXT PRIMARY KEY);
        INSERT INTO posts VALUES ('post_song');
        INSERT INTO communities VALUES ('cmty_test');
      `)
      for (const migrationPath of migrationPaths.slice(0, 2)) {
        db.exec(await Bun.file(migrationPath).text())
      }

      const insert = db.prepare(`
        INSERT INTO dance_attempt (
          dance_attempt_id, dance_attempt_session_id, user_id, community_id,
          post_id, song_artifact_bundle_id, dance_choreography_revision_id,
          activity_date, activity_timezone, status, score_bps, rank_eligible,
          quality_outcome, integrity_outcome, coverage_bps, pose_detection_bps,
          duration_ratio_bps, selected_mirror, temporal_offset_ms,
          temporal_warp_bps, unmatched_coverage_bps, reference_content_sha256,
          reference_feature_sha256, pose_model_version, pose_model_sha256,
          feature_schema_version, scorer_version, calibration_version,
          calibration_checksum, calibration_admitted, fingerprint_policy_version,
          integrity_policy_version, whole_attempt_fingerprint_hmac,
          segment_fingerprint_hmac_json, grader_result_digest, completed_at, created_at
        ) VALUES (
          ?, ?, 'usr_1', 'cmty_test', 'post_song', 'sab_song', 'dcr_1',
          '2026-07-30', 'UTC', 'passed', 5112, ?,
          'passed', 'passed', 9636, 10000, 9900, 'mirrored', 209,
          929, 838, ?, ?, 'pose_v1', ?, 'features_v1', 'scorer_v1',
          'provisional_v1', ?, 0, 'fingerprint_v1', 'integrity_v1',
          ?, '[]', ?, '2026-07-30T12:00:00Z', '2026-07-30T12:00:00Z'
        )
      `)

      expect(() => insert.run(
        "dat_reward_forbidden",
        "dse_reward_forbidden",
        1,
        hex("1"),
        hex("2"),
        hex("3"),
        hex("4"),
        hex("5"),
        hex("6"),
      )).toThrow()

      insert.run(
        "dat_coaching",
        "dse_coaching",
        0,
        hex("1"),
        hex("2"),
        hex("3"),
        hex("4"),
        hex("5"),
        hex("6"),
      )

      db.exec(await Bun.file(migrationPaths[2]!).text())

      expect(db.query(`
        SELECT score_bps, rank_eligible, calibration_admitted
        FROM dance_attempt WHERE dance_attempt_id = 'dat_coaching'
      `).get()).toEqual({
        score_bps: 5112,
        rank_eligible: 0,
        calibration_admitted: 0,
      })

      expect(() => db.exec(`
        UPDATE dance_attempt
        SET segment_fingerprint_hmac_json = '["not-a-hash"]'
        WHERE dance_attempt_id = 'dat_coaching'
      `)).toThrow()

      expect(() => db.exec(`
        UPDATE dance_attempt
        SET status = 'rejected',
            rank_eligible = 0,
            reason_code = 'insufficient_alignment'
        WHERE dance_attempt_id = 'dat_coaching'
      `)).not.toThrow()

      expect(() => db.exec(`
        UPDATE dance_attempt
        SET reason_code = 'upload_invalid'
        WHERE dance_attempt_id = 'dat_coaching'
      `)).not.toThrow()
    } finally {
      db.close()
    }
  })
})
