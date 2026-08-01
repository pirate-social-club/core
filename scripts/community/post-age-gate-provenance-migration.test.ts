import { describe, expect, test } from "bun:test"
import { Database } from "bun:sqlite"
import { LEDGER_BACKFILL_SQL } from "./apply-post-age-gate-provenance-d1-migration"

const migrationPath = new URL(
  "../../db/community-template/migrations/1148_post_age_gate_provenance.sql",
  import.meta.url,
)

describe("1148 post age-gate provenance migration", () => {
  test("marks existing gates unknown without inventing provenance for ungated posts", async () => {
    const db = new Database(":memory:")
    try {
      db.exec(`
        CREATE TABLE posts (
          post_id TEXT PRIMARY KEY,
          age_gate_policy TEXT NOT NULL CHECK (age_gate_policy IN ('none', '18_plus')),
          updated_at TEXT NOT NULL
        );
        INSERT INTO posts VALUES ('gated', '18_plus', '2026-07-01T00:00:00.000Z');
        INSERT INTO posts VALUES ('open', 'none', '2026-07-02T00:00:00.000Z');
      `)

      db.exec(await Bun.file(migrationPath).text())

      expect(db.query(`
        SELECT post_id, age_gate_source, age_gate_evidence_ref, age_gate_set_at
        FROM posts ORDER BY post_id
      `).all()).toEqual([
        {
          post_id: "gated",
          age_gate_source: "legacy_unknown",
          age_gate_evidence_ref: null,
          age_gate_set_at: "2026-07-01T00:00:00.000Z",
        },
        {
          post_id: "open",
          age_gate_source: null,
          age_gate_evidence_ref: null,
          age_gate_set_at: null,
        },
      ])

      expect(() => db.exec(`UPDATE posts SET age_gate_source = 'classifier_guess' WHERE post_id = 'gated'`)).toThrow()
    } finally {
      db.close()
    }
  })

  test("repeating the backfill preserves genuine provenance", async () => {
    const db = new Database(":memory:")
    try {
      db.exec(`
        CREATE TABLE posts (
          post_id TEXT PRIMARY KEY,
          age_gate_policy TEXT NOT NULL CHECK (age_gate_policy IN ('none', '18_plus')),
          age_gate_source TEXT,
          age_gate_set_at TEXT,
          updated_at TEXT NOT NULL
        );
        INSERT INTO posts VALUES (
          'moderated',
          '18_plus',
          'moderator',
          '2026-07-20T00:00:00.000Z',
          '2026-07-21T00:00:00.000Z'
        );
        INSERT INTO posts VALUES (
          'legacy',
          '18_plus',
          NULL,
          NULL,
          '2026-07-01T00:00:00.000Z'
        );
      `)

      db.exec(LEDGER_BACKFILL_SQL)
      db.exec(LEDGER_BACKFILL_SQL)

      expect(db.query(`
        SELECT post_id, age_gate_source, age_gate_set_at
        FROM posts ORDER BY post_id
      `).all()).toEqual([
        {
          post_id: "legacy",
          age_gate_source: "legacy_unknown",
          age_gate_set_at: "2026-07-01T00:00:00.000Z",
        },
        {
          post_id: "moderated",
          age_gate_source: "moderator",
          age_gate_set_at: "2026-07-20T00:00:00.000Z",
        },
      ])
    } finally {
      db.close()
    }
  })
})
