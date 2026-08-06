import { describe, expect, test } from "bun:test"
import { Database } from "bun:sqlite"

const sessionsMigrationPath = new URL(
  "../../db/community-template/migrations/1142_song_study_sessions.sql",
  import.meta.url,
)
const orchestrationMigrationPath = new URL(
  "../../db/community-template/migrations/1151_song_study_orchestration_v2.sql",
  import.meta.url,
)

describe("1151 Song Study orchestration v2 migration", () => {
  test("preserves an active mid-lesson session and backfills additive state", async () => {
    const db = new Database(":memory:")
    try {
      db.exec("PRAGMA foreign_keys = ON")
      db.exec(`
        CREATE TABLE posts (post_id TEXT PRIMARY KEY);
        CREATE TABLE communities (community_id TEXT PRIMARY KEY);
        CREATE TABLE song_study_attempt (
          id TEXT PRIMARY KEY, user_id TEXT NOT NULL, exercise_id TEXT NOT NULL
        );
        INSERT INTO posts VALUES ('pst_1');
        INSERT INTO communities VALUES ('cmt_1');
      `)
      db.exec(await Bun.file(sessionsMigrationPath).text())
      db.exec(`
        INSERT INTO song_study_session (
          id, user_id, post_id, community_id, target_language, status,
          exercise_count, required_correct_count, max_presentations,
          presentation_count, completed_exercise_count,
          first_pass_correct_count, mastered_exercise_count,
          created_at, expires_at, updated_at
        ) VALUES (
          'sts_active', 'usr_1', 'pst_1', 'cmt_1', 'ru', 'active',
          2, 2, 6, 1, 1, 1, 1, 'before', 'later', 'before'
        );
        INSERT INTO song_study_session_exercise (
          session_id, exercise_id, ordinal, presentation_count,
          first_outcome, last_outcome, mastered, created_at, updated_at
        ) VALUES
          ('sts_active', 'ex_mastered', 0, 1, 'correct', 'correct', 1, 'before', 'before'),
          ('sts_active', 'ex_current', 1, 0, NULL, NULL, 0, 'before', 'before');
      `)

      db.exec(await Bun.file(orchestrationMigrationPath).text())

      expect(db.query(`
        SELECT status, presentation_count, completed_exercise_count,
               mastered_exercise_count, session_revision, current_exercise_id,
               completion_reason
        FROM song_study_session WHERE id = 'sts_active'
      `).get()).toEqual({
        status: "active",
        presentation_count: 1,
        completed_exercise_count: 1,
        mastered_exercise_count: 1,
        session_revision: 0,
        current_exercise_id: null,
        completion_reason: null,
      })
      expect(db.query(`
        SELECT exercise_id, presentation_count, mastered,
               appearance_ordinal, appearance_attempt_count, lesson_resolved,
               last_served_index, qualifies_for_reward
        FROM song_study_session_exercise
        WHERE session_id = 'sts_active'
        ORDER BY ordinal
      `).all()).toEqual([
        {
          exercise_id: "ex_mastered",
          presentation_count: 1,
          mastered: 1,
          appearance_ordinal: 0,
          appearance_attempt_count: 0,
          lesson_resolved: 1,
          last_served_index: 1,
          qualifies_for_reward: 1,
        },
        {
          exercise_id: "ex_current",
          presentation_count: 0,
          mastered: 0,
          appearance_ordinal: 0,
          appearance_attempt_count: 0,
          lesson_resolved: 0,
          last_served_index: 0,
          qualifies_for_reward: 1,
        },
      ])

      db.exec(`
        UPDATE song_study_session SET session_revision = 1 WHERE id = 'sts_active';
        UPDATE song_study_session_exercise
          SET appearance_ordinal = 1, appearance_attempt_count = 1,
              last_served_index = 2, qualifies_for_reward = 0
          WHERE session_id = 'sts_active' AND exercise_id = 'ex_current';
        INSERT INTO song_study_ungradable_receipt (
          session_id, exercise_id, appearance_ordinal, user_id,
          idempotency_key, created_at
        ) VALUES ('sts_active', 'ex_current', 1, 'usr_1', 'idem_free_1', 'after');
        INSERT INTO song_study_attempt_response (
          user_id, idempotency_key, session_id, exercise_id,
          request_fingerprint, response_json, http_status, result_kind, created_at
        ) VALUES (
          'usr_1', 'idem_free_1', 'sts_active', 'ex_current',
          'sha256:request', '{"outcome":"ungradable","session_revision":1}',
          200, 'ungradable', 'after'
        );
      `)

      expect(db.query(`
        SELECT result_kind, response_json
        FROM song_study_attempt_response
        WHERE user_id = 'usr_1' AND idempotency_key = 'idem_free_1'
      `).get()).toEqual({
        result_kind: "ungradable",
        response_json: '{"outcome":"ungradable","session_revision":1}',
      })

      expect(() => db.prepare(`
        INSERT INTO song_study_ungradable_receipt (
          session_id, exercise_id, appearance_ordinal, user_id,
          idempotency_key, created_at
        ) VALUES ('sts_active', 'ex_current', 1, 'usr_1', 'idem_free_2', 'after')
      `).run()).toThrow(/UNIQUE constraint failed/)
      expect(() => db.prepare(`
        INSERT INTO song_study_attempt_response (
          user_id, idempotency_key, session_id, exercise_id,
          request_fingerprint, response_json, http_status, result_kind, created_at
        ) VALUES (
          'usr_1', 'idem_free_1', 'sts_active', 'ex_current',
          'different', '{}', 200, 'ungradable', 'after'
        )
      `).run()).toThrow(/UNIQUE constraint failed/)
    } finally {
      db.close()
    }
  })

  test("enforces revision, appearance, qualification, and snapshot bounds", async () => {
    const db = new Database(":memory:")
    try {
      db.exec(`
        CREATE TABLE posts (post_id TEXT PRIMARY KEY);
        CREATE TABLE communities (community_id TEXT PRIMARY KEY);
        CREATE TABLE song_study_attempt (
          id TEXT PRIMARY KEY, user_id TEXT NOT NULL, exercise_id TEXT NOT NULL
        );
      `)
      db.exec(await Bun.file(sessionsMigrationPath).text())
      db.exec(await Bun.file(orchestrationMigrationPath).text())
      db.exec(`
        INSERT INTO song_study_session (
          id, user_id, post_id, community_id, target_language, status,
          exercise_count, required_correct_count, max_presentations,
          created_at, expires_at, updated_at
        ) VALUES ('sts_1', 'usr_1', 'pst_1', 'cmt_1', 'en', 'active', 1, 1, 3,
                  'now', 'later', 'now');
        INSERT INTO song_study_session_exercise (
          session_id, exercise_id, ordinal, created_at, updated_at
        ) VALUES ('sts_1', 'ex_1', 0, 'now', 'now');
      `)

      expect(() => db.prepare("UPDATE song_study_session SET session_revision = -1").run()).toThrow(/CHECK/)
      expect(() => db.prepare("UPDATE song_study_session_exercise SET appearance_ordinal = -1").run()).toThrow(/CHECK/)
      expect(() => db.prepare("UPDATE song_study_session_exercise SET appearance_attempt_count = 3").run()).toThrow(/CHECK/)
      expect(() => db.prepare("UPDATE song_study_session_exercise SET lesson_resolved = 2").run()).toThrow(/CHECK/)
      expect(() => db.prepare("UPDATE song_study_session_exercise SET last_served_index = -1").run()).toThrow(/CHECK/)
      expect(() => db.prepare("UPDATE song_study_session_exercise SET qualifies_for_reward = 2").run()).toThrow(/CHECK/)
      expect(() => db.prepare("UPDATE song_study_session SET completion_reason = 'client_done'").run()).toThrow(/CHECK/)
      expect(() => db.prepare(`
        INSERT INTO song_study_attempt_response (
          user_id, idempotency_key, session_id, exercise_id,
          request_fingerprint, response_json, http_status, result_kind, created_at
        ) VALUES ('usr_1', 'idem_1', 'sts_1', 'ex_1', 'hash', '{}', 99, 'graded', 'now')
      `).run()).toThrow(/CHECK/)
    } finally {
      db.close()
    }
  })
})
