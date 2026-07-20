import { describe, expect, test } from "bun:test"
import { Database } from "bun:sqlite"

const migrationPath = new URL(
  "../../db/community-template/migrations/1142_song_study_sessions.sql",
  import.meta.url,
)

describe("1142 song-study sessions migration", () => {
  test("executes the real migration and enforces session and presentation bounds", async () => {
    const db = new Database(":memory:")
    try {
      db.exec(`
        CREATE TABLE posts (post_id TEXT PRIMARY KEY);
        CREATE TABLE communities (community_id TEXT PRIMARY KEY);
        CREATE TABLE song_study_attempt (
          id TEXT PRIMARY KEY, user_id TEXT NOT NULL, exercise_id TEXT NOT NULL
        );
      `)
      db.exec(await Bun.file(migrationPath).text())

      const insertSession = db.prepare(`
        INSERT INTO song_study_session (
          id, user_id, post_id, community_id, target_language, status,
          exercise_count, required_correct_count, max_presentations,
          created_at, expires_at, updated_at
        ) VALUES (?, 'usr_1', 'pst_1', 'cmt_1', 'en', 'active', ?, ?, ?, 'now', 'later', 'now')
      `)
      expect(() => insertSession.run("sts_too_many", 11, 8, 20)).toThrow()
      insertSession.run("sts_1", 10, 7, 20)

      const insertExercise = db.prepare(`
        INSERT INTO song_study_session_exercise (
          session_id, exercise_id, ordinal, presentation_count, created_at, updated_at
        ) VALUES ('sts_1', ?, ?, ?, 'now', 'now')
      `)
      expect(() => insertExercise.run("ex_bad", 0, 4)).toThrow()
      insertExercise.run("ex_1", 0, 0)

      db.prepare(`
        INSERT INTO song_study_attempt (
          id, user_id, exercise_id, study_session_id, presentation_number
        ) VALUES (?, 'usr_1', 'ex_1', 'sts_1', 1)
      `).run("sta_1")
      expect(() => db.prepare(`
        INSERT INTO song_study_attempt (
          id, user_id, exercise_id, study_session_id, presentation_number
        ) VALUES ('sta_2', 'usr_1', 'ex_1', 'sts_1', 1)
      `).run()).toThrow()
    } finally {
      db.close()
    }
  })
})
