import { Database } from "bun:sqlite";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";

const MIGRATIONS_DIR = join(import.meta.dir, "../../db/community-template/migrations");

function migrationFilesThrough(prefix: string): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith(".sql") && file <= prefix)
    .sort();
}

function applyMigrations(db: Database, files: string[]): void {
  for (const file of files) {
    db.exec(readFileSync(join(MIGRATIONS_DIR, file), "utf8"));
  }
}

describe("song study attempt identity migration", () => {
  test("1121 preserves attempt rows and removes review-session identity", () => {
    const db = new Database(":memory:");
    applyMigrations(db, migrationFilesThrough("1118_song_study_review_sessions.sql"));

    db.exec("PRAGMA foreign_keys = OFF;");
    db.query(`
      INSERT INTO song_study_attempt (
        id, user_id, post_id, exercise_id, review_session_id, line_id,
        exercise_type, target_language, study_pack_version, attempt_number,
        idempotency_key, selected_option_id, transcript, outcome, feedback_json,
        fsrs_rating, created_at
      )
      VALUES (
        'sta_preserve', 'user_1', 'post_1', 'exercise_1', 'review:line_001:translation_choice:es:2026-07-01T00:00:00.000Z',
        'line_001', 'translation_choice', 'es', 1, 1, 'idem_preserve',
        'option_1', NULL, 'correct', '{"ok":true}', 'good', '2026-07-01T00:00:00.000Z'
      )
    `).run();

    applyMigrations(db, ["1121_song_study_attempt_identity.sql"]);
    db.exec("PRAGMA foreign_keys = OFF;");

    const columns = db
      .query<{ name: string }, []>("PRAGMA table_info(song_study_attempt)")
      .all()
      .map((row) => row.name);
    expect(columns).not.toContain("review_session_id");

    const row = db
      .query<{ id: string; idempotency_key: string; outcome: string; fsrs_rating: string | null }, []>(
        "SELECT id, idempotency_key, outcome, fsrs_rating FROM song_study_attempt WHERE id = 'sta_preserve'",
      )
      .get();
    expect(row).toEqual({
      id: "sta_preserve",
      idempotency_key: "idem_preserve",
      outcome: "correct",
      fsrs_rating: "good",
    });

    expect(() => {
      db.query(`
        INSERT INTO song_study_attempt (
          id, user_id, post_id, exercise_id, line_id, exercise_type,
          target_language, study_pack_version, attempt_number, idempotency_key,
          selected_option_id, transcript, outcome, feedback_json, fsrs_rating, created_at
        )
        VALUES (
          'sta_duplicate_idem', 'user_1', 'post_1', 'exercise_2', 'line_002',
          'translation_choice', 'es', 1, 1, 'idem_preserve',
          'option_1', NULL, 'correct', NULL, 'good', '2026-07-01T00:00:01.000Z'
        )
      `).run();
    }).toThrow();

    expect(() => {
      db.query(`
        INSERT INTO song_study_attempt (
          id, user_id, post_id, exercise_id, line_id, exercise_type,
          target_language, study_pack_version, attempt_number, idempotency_key,
          selected_option_id, transcript, outcome, feedback_json, fsrs_rating, created_at
        )
        VALUES (
          'sta_duplicate_exercise_attempt', 'user_1', 'post_1', 'exercise_1', 'line_001',
          'translation_choice', 'es', 1, 1, 'idem_second_review',
          'option_1', NULL, 'correct', NULL, 'good', '2026-07-02T00:00:00.000Z'
        )
      `).run();
    }).not.toThrow();

    db.close();
  });
});
