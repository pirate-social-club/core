import { Database } from "bun:sqlite"
import { describe, expect, test } from "bun:test"
import {
  assertCompleteSanitizationRules,
  profileRehearsalDatabase,
  sanitizeRehearsalDatabase,
  type SanitizationRule,
} from "./rehearsal-sanitizer"

function fixture(): Database {
  const db = new Database(":memory:")
  db.exec(`
    CREATE TABLE schema_migrations (
      migration_name TEXT NOT NULL,
      checksum TEXT NOT NULL
    );
    CREATE TABLE posts (
      post_id TEXT PRIMARY KEY,
      body TEXT,
      attachment BLOB
    );
    INSERT INTO schema_migrations VALUES
      ('1050_post_embeds.sql', 'known-drifted-checksum'),
      ('1060_community_gate_policies.sql', 'another-drifted-checksum');
    INSERT INTO posts VALUES
      ('post_000000000001', 'private body', X'01020304'),
      ('post_000000000002', 'longer private body', X'0506070809'),
      ('post_000000000003', NULL, NULL);
  `)
  return db
}

const RULES: SanitizationRule[] = [
  { table: "posts", column: "post_id", mode: "stable_text" },
  { table: "posts", column: "body", mode: "mask_text" },
  { table: "posts", column: "attachment", mode: "stable_blob" },
  { table: "schema_migrations", column: "migration_name", mode: "preserve" },
  { table: "schema_migrations", column: "checksum", mode: "preserve" },
]

describe("rehearsal sanitizer", () => {
  test("requires an explicit decision for every TEXT/BLOB column", () => {
    const db = fixture()
    expect(() => assertCompleteSanitizationRules(db, RULES.slice(1))).toThrow("missing:posts.post_id")
    db.close()
  })

  test("refuses to rewrite the real migration ledger", () => {
    const db = fixture()
    const rules = RULES.map((rule) =>
      rule.table === "schema_migrations" && rule.column === "checksum"
        ? { ...rule, mode: "stable_text" as const }
        : rule
    )
    expect(() => assertCompleteSanitizationRules(db, rules)).toThrow("preserved verbatim")
    db.close()
  })

  test("preserves row counts, byte-length distributions, and drifted ledger bytes", () => {
    const db = fixture()
    const before = profileRehearsalDatabase(db)
    const result = sanitizeRehearsalDatabase(db, RULES, "rehearsal-test-salt-with-more-than-32-characters")
    expect(result.before).toEqual(before)
    expect(result.after).toEqual(before)
    expect(db.query<{ body: string }, []>("SELECT body FROM posts WHERE body IS NOT NULL ORDER BY rowid").all())
      .not.toEqual([{ body: "private body" }, { body: "longer private body" }])
    expect(db.query<{ checksum: string }, []>("SELECT checksum FROM schema_migrations ORDER BY rowid").all())
      .toEqual([{ checksum: "known-drifted-checksum" }, { checksum: "another-drifted-checksum" }])
    db.close()
  })
})
