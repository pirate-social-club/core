import { Database } from "bun:sqlite";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { checksForSongStudyGaSchema } from "./verify-song-study-ga-schema";

const MIGRATIONS_DIR = join(import.meta.dir, "../../db/community-template/migrations");

function migrationFilesThrough(prefix: string): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith(".sql") && file <= prefix)
    .sort();
}

function applyMigrations(db: Database, files: string[]): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      migration_name TEXT PRIMARY KEY,
      migration_label TEXT NOT NULL,
      checksum TEXT NOT NULL,
      applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  for (const file of files) {
    db.exec(readFileSync(join(MIGRATIONS_DIR, file), "utf8"));
    db.query(`
      INSERT OR IGNORE INTO schema_migrations (migration_name, migration_label, checksum)
      VALUES (?1, 'community-template', ?2)
    `).run(file, `test-checksum-${file}`);
  }
}

function checkMap(db: Database): Map<string, boolean> {
  return new Map(checksForSongStudyGaSchema(db).map((check) => [check.name, check.ok]));
}

describe("verify song study GA schema", () => {
  test("rejects the pre-1121 attempt identity shape", () => {
    const db = new Database(":memory:");
    applyMigrations(db, migrationFilesThrough("1119_song_streaks.sql"));

    const checks = checkMap(db);
    expect(checks.get("migration:1121_song_study_attempt_identity.sql")).toBe(false);
    expect(checks.get("song_study_attempt.review_session_id")).toBe(false);
    expect(checks.get("song_study_attempt.old_attempt_number_unique")).toBe(false);

    db.close();
  });

  test("accepts the final due-review and streak GA schema", () => {
    const db = new Database(":memory:");
    applyMigrations(db, migrationFilesThrough("1121_song_study_attempt_identity.sql"));

    const checks = checksForSongStudyGaSchema(db);
    expect(checks.every((check) => check.ok)).toBe(true);

    db.close();
  });
});
