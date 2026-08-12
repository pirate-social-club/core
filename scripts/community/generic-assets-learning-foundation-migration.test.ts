import { describe, expect, test } from "bun:test"
import { Database } from "bun:sqlite"
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"

const MIGRATIONS_DIR = join(import.meta.dir, "../../db/community-template/migrations")
const MIGRATION = "1157_generic_assets_learning_foundation.sql"

function migrationFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith(".sql"))
    .sort()
}

function apply(db: Database, files: string[]): void {
  for (const file of files) {
    db.exec(readFileSync(join(MIGRATIONS_DIR, file), "utf8"))
  }
}

function freshDatabase(): Database {
  const db = new Database(":memory:")
  apply(db, migrationFiles())
  return db
}

function columns(db: Database, table: string): string[] {
  return db
    .query<{ name: string }, []>(`PRAGMA table_info(${table})`)
    .all()
    .map((row) => row.name)
}

function insertPost(db: Database, postId: string, postType: "file" | "deck"): void {
  db.query(`
    INSERT INTO posts (
      post_id, community_id, identity_mode, post_type, status,
      analysis_state, content_safety_state, age_gate_policy, created_at, updated_at
    ) VALUES (?1, 'community', 'public', ?2, 'processing',
              'pending', 'pending', 'none', 'now', 'now')
  `).run(postId, postType)
}

function insertAsset(
  db: Database,
  input: {
    assetId: string
    postId: string
    kind: "song_audio" | "video_file" | "download_file" | "learning_deck"
    primaryContentRef: string | null
  },
): void {
  db.query(`
    INSERT INTO assets (
      asset_id, community_id, source_post_id, creator_user_id, asset_kind,
      rights_basis, access_mode, primary_content_ref, publication_status,
      story_status, locked_delivery_status, created_at, updated_at
    ) VALUES (?1, 'community', ?2, 'creator', ?3,
              'original', 'locked', ?4, 'draft', 'none', 'none', 'now', 'now')
  `).run(input.assetId, input.postId, input.kind, input.primaryContentRef)
}

describe("1157 generic assets and learning foundation migration", () => {
  test("applies with the full history, retains canonical FKs, and installs every dormant table", () => {
    const db = freshDatabase()
    try {
      const expectedTables = [
        "asset_payloads",
        "asset_enforcement",
        "learning_decks",
        "learning_deck_versions",
        "learning_cards",
        "learning_card_versions",
        "learning_review_items",
        "learning_review_events",
        "learning_review_state",
        "learning_sessions",
        "learning_session_items",
      ]
      const installed = db
        .query<{ name: string }, []>(
          "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
        )
        .all()
        .map((row) => row.name)
      for (const table of expectedTables) expect(installed).toContain(table)

      expect(columns(db, "posts")).toContain("age_gate_source")
      expect(columns(db, "posts")).toContain("lyrics_language_source_hash")
      expect(columns(db, "assets")).toContain("story_ip_metadata_uri")
      expect(columns(db, "assets")).toContain("royalty_allocation_projection_synced")
      expect(columns(db, "moderation_actions")).toEqual(
        expect.arrayContaining([
          "asset_id",
          "previous_asset_enforcement_state",
          "next_asset_enforcement_state",
        ]),
      )

      expect(db.query("PRAGMA foreign_key_check").all()).toEqual([])
      const royaltyAssetFk = db
        .query<{ table: string }, []>("PRAGMA foreign_key_list(initial_royalty_allocations)")
        .all()
      expect(royaltyAssetFk.some((fk) => fk.table === "assets")).toBe(true)
    } finally {
      db.close()
    }
  })

  test("preserves existing song/video, post-publish, and moderation rows byte-for-byte", () => {
    const db = new Database(":memory:")
    try {
      const files = migrationFiles()
      const migrationIndex = files.indexOf(MIGRATION)
      expect(migrationIndex).toBeGreaterThan(0)
      apply(db, files.slice(0, migrationIndex))
      const previousColumns = {
        posts: columns(db, "posts"),
        assets: columns(db, "assets"),
        postPublishRequests: columns(db, "post_publish_requests"),
        moderationActions: columns(db, "moderation_actions"),
      }
      db.exec("PRAGMA foreign_keys = OFF")
      db.exec(`
        INSERT INTO posts (
          post_id, community_id, author_user_id, identity_mode, post_type, status,
          title, analysis_state, content_safety_state, age_gate_policy,
          created_at, updated_at, idempotency_key, lyrics_language,
          lyrics_language_reliable, age_gate_source, age_gate_evidence_ref, age_gate_set_at
        ) VALUES (
          'post_existing', 'community', 'creator', 'public', 'song', 'published',
          'existing title', 'allow', 'safe', '18_plus',
          'created', 'updated', 'idem_existing', 'en', 1,
          'moderator', 'evidence://age', 'age-set'
        );
        INSERT INTO assets (
          asset_id, community_id, source_post_id, creator_user_id, asset_kind,
          rights_basis, access_mode, primary_content_ref, primary_content_hash,
          publication_status, story_status, locked_delivery_status,
          created_at, updated_at, display_title, story_ip_metadata_uri,
          royalty_allocation_projection_synced
        ) VALUES (
          'asset_existing', 'community', 'post_existing', 'creator', 'song_audio',
          'original', 'locked', 'song_artifact:upload', 'sha256:existing',
          'story_published', 'published', 'ready',
          'created', 'updated', 'existing asset', 'ipfs://metadata', 1
        );
        INSERT INTO post_publish_requests (
          post_publish_request_id, community_id, post_id, publish_mode,
          request_body_hash, status, created_at, updated_at
        ) VALUES (
          'publish_existing', 'community', 'post_existing', 'async',
          'sha256:request', 'succeeded', 'created', 'updated'
        );
        INSERT INTO moderation_actions (
          moderation_action_id, moderation_case_id, community_id, post_id,
          actor_user_id, action_type, note, created_at,
          previous_post_status, next_post_status
        ) VALUES (
          'action_existing', 'case_existing', 'community', 'post_existing',
          'moderator', 'hide', 'existing note', 'created', 'published', 'hidden'
        );
      `)

      apply(db, [MIGRATION])

      expect(columns(db, "posts")).toEqual(previousColumns.posts)
      expect(columns(db, "assets")).toEqual(previousColumns.assets)
      expect(columns(db, "post_publish_requests")).toEqual(previousColumns.postPublishRequests)
      expect(columns(db, "moderation_actions")).toEqual([
        ...previousColumns.moderationActions,
        "asset_id",
        "previous_asset_enforcement_state",
        "next_asset_enforcement_state",
      ])

      expect(db.query(`
        SELECT post_id, post_type, title, lyrics_language, lyrics_language_reliable,
               age_gate_source, age_gate_evidence_ref, age_gate_set_at
        FROM posts WHERE post_id = 'post_existing'
      `).get()).toEqual({
        post_id: "post_existing",
        post_type: "song",
        title: "existing title",
        lyrics_language: "en",
        lyrics_language_reliable: 1,
        age_gate_source: "moderator",
        age_gate_evidence_ref: "evidence://age",
        age_gate_set_at: "age-set",
      })
      expect(db.query(`
        SELECT asset_kind, primary_content_ref, primary_content_hash, display_title,
               story_ip_metadata_uri, royalty_allocation_projection_synced
        FROM assets WHERE asset_id = 'asset_existing'
      `).get()).toEqual({
        asset_kind: "song_audio",
        primary_content_ref: "song_artifact:upload",
        primary_content_hash: "sha256:existing",
        display_title: "existing asset",
        story_ip_metadata_uri: "ipfs://metadata",
        royalty_allocation_projection_synced: 1,
      })
      expect(db.query(`
        SELECT status, request_body_hash FROM post_publish_requests
        WHERE post_publish_request_id = 'publish_existing'
      `).get()).toEqual({ status: "succeeded", request_body_hash: "sha256:request" })
      expect(db.query(`
        SELECT action_type, note, asset_id, previous_asset_enforcement_state,
               next_asset_enforcement_state
        FROM moderation_actions WHERE moderation_action_id = 'action_existing'
      `).get()).toEqual({
        action_type: "hide",
        note: "existing note",
        asset_id: null,
        previous_asset_enforcement_state: null,
        next_asset_enforcement_state: null,
      })
    } finally {
      db.close()
    }
  })

  test("enforces generic payload identity and linked moderation authority", () => {
    const db = freshDatabase()
    try {
      db.exec("PRAGMA foreign_keys = OFF")
      insertPost(db, "post_file", "file")
      insertAsset(db, {
        assetId: "asset_file",
        postId: "post_file",
        kind: "download_file",
        primaryContentRef: null,
      })

      expect(() => insertAsset(db, {
        assetId: "asset_bad_legacy",
        postId: "post_file",
        kind: "song_audio",
        primaryContentRef: null,
      })).toThrow()
      expect(() => insertAsset(db, {
        assetId: "asset_bad_generic",
        postId: "post_file",
        kind: "learning_deck",
        primaryContentRef: "content_blob:cbl_bad",
      })).toThrow()

      db.exec(`
        INSERT INTO asset_payloads (
          asset_payload_id, asset_id, role, payload_version, status,
          content_blob_ref, payload_format, delivery_behavior, display_filename,
          mime_type, size_bytes, content_hash, created_at, updated_at
        ) VALUES (
          'payload_primary', 'asset_file', 'primary', 1, 'active',
          'content_blob:cbl_file', 'opaque_file_v1', 'download', 'data.csv',
          'text/csv', 12, 'sha256:file', 'now', 'now'
        );
        INSERT INTO asset_enforcement (
          asset_id, enforcement_state, authority_kind, authority_ref, decided_at, updated_at
        ) VALUES ('asset_file', 'active', 'asset_create', 'asset_file', 'now', 'now');
      `)

      expect(() => db.exec(`
        INSERT INTO asset_payloads (
          asset_payload_id, asset_id, role, payload_version, status,
          content_blob_ref, payload_format, delivery_behavior,
          mime_type, size_bytes, content_hash, created_at, updated_at
        ) VALUES (
          'payload_no_name', 'asset_file', 'supplementary', 1, 'active',
          'content_blob:cbl_other', 'opaque_file_v1', 'download',
          'text/plain', 1, 'sha256:other', 'now', 'now'
        )
      `)).toThrow()
      expect(() => db.exec(`
        INSERT INTO asset_payloads (
          asset_payload_id, asset_id, role, payload_version, status,
          content_blob_ref, payload_format, delivery_behavior, display_filename,
          mime_type, size_bytes, content_hash, created_at, updated_at
        ) VALUES (
          'payload_second_primary', 'asset_file', 'primary', 2, 'active',
          'content_blob:cbl_second', 'opaque_file_v1', 'download', 'second.csv',
          'text/csv', 2, 'sha256:second', 'now', 'now'
        )
      `)).toThrow()

      expect(() => db.exec(`
        INSERT INTO asset_enforcement (
          asset_id, enforcement_state, reason_code, authority_kind,
          authority_ref, decided_at, updated_at
        ) VALUES (
          'asset_other', 'blocked', 'malware', 'moderation_action',
          'action_missing', 'now', 'now'
        )
      `)).toThrow()

      expect(() => db.exec(`
        INSERT INTO moderation_actions (
          moderation_action_id, moderation_case_id, community_id, asset_id,
          actor_user_id, action_type, created_at,
          previous_asset_enforcement_state, next_asset_enforcement_state, evidence_ref
        ) VALUES (
          'asset_only', 'case', 'community', 'asset_file',
          'moderator', 'block_asset', 'now', 'active', 'blocked', 'evidence://block'
        )
      `)).toThrow()

      db.exec(`
        INSERT INTO moderation_actions (
          moderation_action_id, moderation_case_id, community_id, post_id, asset_id,
          actor_user_id, action_type, created_at, previous_post_status, next_post_status,
          previous_asset_enforcement_state, next_asset_enforcement_state, evidence_ref
        ) VALUES (
          'action_block', 'case', 'community', 'post_file', 'asset_file',
          'moderator', 'block_asset', 'now', 'published', 'removed',
          'active', 'blocked', 'evidence://block'
        )
      `)
      expect(db.query(`
        SELECT post_id, asset_id, next_asset_enforcement_state
        FROM moderation_actions WHERE moderation_action_id = 'action_block'
      `).get()).toEqual({
        post_id: "post_file",
        asset_id: "asset_file",
        next_asset_enforcement_state: "blocked",
      })
    } finally {
      db.close()
    }
  })

  test("pins immutable published deck snapshots and review/session concurrency guards", () => {
    const db = freshDatabase()
    try {
      db.exec("PRAGMA foreign_keys = OFF")
      insertPost(db, "post_deck", "deck")
      insertAsset(db, {
        assetId: "asset_deck",
        postId: "post_deck",
        kind: "learning_deck",
        primaryContentRef: null,
      })
      db.exec(`
        INSERT INTO learning_decks (
          learning_deck_id, community_id, creator_user_id, source_post_id, asset_id,
          title, status, active_draft_version, published_version, created_at, updated_at
        ) VALUES (
          'deck', 'community', 'creator', 'post_deck', 'asset_deck',
          'Deck', 'published', 2, 1, 'now', 'now'
        );
        INSERT INTO learning_deck_versions (
          learning_deck_version_id, learning_deck_id, version, schema_version,
          status, content_hash, card_count, canonical_blob_ref,
          created_at, updated_at, published_at
        ) VALUES (
          'deck_version', 'deck', 1, 1, 'ready', 'sha256:deck', 1,
          'content_blob:cbl_deck', 'now', 'now', 'now'
        );
        INSERT INTO learning_cards (
          learning_card_id, learning_deck_id, created_at
        ) VALUES ('card', 'deck', 'now');
        INSERT INTO learning_card_versions (
          learning_deck_version_id, learning_card_id, ordinal, card_type,
          prompt_json, answer_json, content_hash, created_at
        ) VALUES (
          'deck_version', 'card', 0, 'basic',
          '{"text":"prompt"}', '{"text":"answer"}', 'sha256:card', 'now'
        );
        UPDATE learning_deck_versions SET status = 'published' WHERE learning_deck_version_id = 'deck_version';
      `)

      expect(() => db.exec(`
        UPDATE learning_deck_versions SET content_hash = 'sha256:changed'
        WHERE learning_deck_version_id = 'deck_version'
      `)).toThrow(/immutable/)
      expect(() => db.exec(`
        UPDATE learning_card_versions SET answer_json = '{"text":"changed"}'
        WHERE learning_deck_version_id = 'deck_version' AND learning_card_id = 'card'
      `)).toThrow(/immutable/)
      expect(() => db.exec(`
        INSERT INTO learning_card_versions (
          learning_deck_version_id, learning_card_id, ordinal, card_type,
          prompt_json, answer_json, content_hash, created_at
        ) VALUES (
          'deck_version', 'card_late', 1, 'basic', '{}', '{}', 'sha256:late', 'later'
        )
      `)).toThrow(/immutable/)
      expect(() => db.exec("DELETE FROM learning_cards WHERE learning_card_id = 'card'"))
        .toThrow(/cannot be deleted/)

      db.exec(`
        INSERT INTO learning_review_items (
          review_item_id, item_kind, subject_ref, content_version, status, created_at, updated_at
        ) VALUES ('review_item', 'deck_card', 'card', 1, 'active', 'now', 'now');
        INSERT INTO learning_review_events (
          learning_review_event_id, user_id, review_item_id, learning_deck_id,
          learning_deck_version_id, idempotency_key, item_event_sequence, rating,
          reviewed_at, algorithm, parameters_version, content_version,
          resulting_state_json, created_at
        ) VALUES (
          'event_1', 'learner', 'review_item', 'deck', 'deck_version',
          'idempotency_1', 1, 'good', 'now', 'fsrs_6_v1', 1, 1,
          '{"revision":1}', 'now'
        );
        INSERT INTO learning_review_state (
          user_id, review_item_id, algorithm, parameters_version, phase,
          stability, difficulty, scheduled_interval_days, due_at, last_reviewed_at,
          reps, lapses, revision, last_review_event_id, updated_at
        ) VALUES (
          'learner', 'review_item', 'fsrs_6_v1', 1, 'review',
          1.0, 5.0, 1.0, 'later', 'now', 1, 0, 1, 'event_1', 'now'
        );
      `)

      expect(() => db.exec(`
        INSERT INTO learning_review_events (
          learning_review_event_id, user_id, review_item_id, idempotency_key,
          item_event_sequence, rating, reviewed_at, algorithm, parameters_version,
          content_version, resulting_state_json, created_at
        ) VALUES (
          'event_duplicate_sequence', 'learner', 'review_item', 'idempotency_2',
          1, 'easy', 'later', 'fsrs_6_v1', 1, 1, '{}', 'later'
        )
      `)).toThrow()
      expect(() => db.exec(`
        INSERT INTO learning_review_state (
          user_id, review_item_id, algorithm, parameters_version, phase,
          stability, difficulty, scheduled_interval_days, due_at,
          reps, lapses, revision, last_review_event_id, updated_at
        ) VALUES (
          'other', 'review_item', 'fsrs_6_v1', 1, 'new',
          0, 5, 0, 'now', 0, 0, 0, 'event_1', 'now'
        )
      `)).toThrow()
    } finally {
      db.close()
    }
  })
})
