/**
 * Operator spec for applying community-template migration
 * 1143_lyrics_language.sql across the allocated+loaded D1 fleet.
 *
 * Stage 1 of the posts.source_language split: gives the lyrics/song language its own
 * column so translation provenance can later be corrected without silently redefining
 * Study semantics.
 *
 * Additive and inert. The API classifies 1143 as transitional/deferred and does not
 * read or write these columns yet; Stage 1b lands the runtime projection only after
 * this migration is applied fleet-wide and promoted to required.
 */

import { runFleetMigration, type MigrationSpec } from "./lib/fleet-d1-migration"

export const SPEC: MigrationSpec = {
  migration: "1143_lyrics_language.sql",
  label: "community-template",
  requiredTables: ["posts"],
  creates: {
    kind: "schema_objects",
    columns: [
      { table: "posts", column: "lyrics_language" },
      { table: "posts", column: "lyrics_language_confidence" },
      { table: "posts", column: "lyrics_language_reliable" },
      { table: "posts", column: "lyrics_language_detector" },
      { table: "posts", column: "lyrics_language_detected_at" },
      { table: "posts", column: "lyrics_language_source_hash" },
    ],
    indexes: [],
  },
  // ALTER TABLE ... ADD COLUMN is not idempotent in SQLite: a re-run against an
  // already-migrated shard errors rather than no-opping.
  replayableDdl: false,
  description: "Lyrics/song language plus its detection provenance, separated from source_language.",
}

if (import.meta.main) {
  await runFleetMigration(
    SPEC,
    "scripts/community/apply-lyrics-language-d1-migration.ts",
  )
}
