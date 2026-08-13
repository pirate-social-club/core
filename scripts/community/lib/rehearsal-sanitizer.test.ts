import { Database } from "bun:sqlite"
import { describe, expect, test } from "bun:test"
import {
  assertCompleteSanitizationRules,
  deriveSanitizationRules,
  profileRehearsalDatabase,
  sanitizationInventory,
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
      attachment BLOB,
      status TEXT NOT NULL CHECK (status IN ('draft', 'published')),
      author_id TEXT UNIQUE
    );
    INSERT INTO schema_migrations VALUES
      ('1050_post_embeds.sql', 'known-drifted-checksum'),
      ('1060_community_gate_policies.sql', 'another-drifted-checksum');
    INSERT INTO posts VALUES
      ('post_000000000001', 'private body', X'01020304', 'draft', 'user_0001'),
      ('post_000000000002', 'longer private body', X'0506070809', 'published', 'user_0002'),
      ('post_000000000003', NULL, NULL, 'draft', 'user_0003');
  `)
  return db
}

const RULES: SanitizationRule[] = [
  { table: "posts", column: "post_id", mode: "stable_text" },
  { table: "posts", column: "body", mode: "mask_text" },
  { table: "posts", column: "attachment", mode: "stable_blob" },
  { table: "posts", column: "status", mode: "preserve" },
  { table: "posts", column: "author_id", mode: "preserve" },
  { table: "schema_migrations", column: "migration_name", mode: "preserve" },
  { table: "schema_migrations", column: "checksum", mode: "preserve" },
]

describe("rehearsal sanitizer", () => {
  test("requires an explicit decision for every TEXT/BLOB column", () => {
    const db = fixture()
    expect(() => assertCompleteSanitizationRules(db, RULES.slice(1))).toThrow("missing:posts.post_id")
    db.close()
  })

  test("inventories aggregate shape without exposing values", () => {
    const db = fixture()
    const inventory = sanitizationInventory(db)
    expect(inventory.find(({ table, column }) => table === "posts" && column === "body")).toEqual({
      table: "posts",
      column: "body",
      declaredType: "TEXT",
      rowCount: 3,
      nullCount: 1,
      distinctCount: 2,
      minimumByteLength: 12,
      maximumByteLength: 19,
      mode: "mask_text",
      reason: "length_preserving_content",
    })
    expect(inventory.filter(({ table }) => table === "schema_migrations").every(({ mode }) => mode === "preserve"))
      .toBe(true)
    db.close()
  })

  test("derives relational and rebuilt-table constraints mechanically", () => {
    const db = fixture()
    const rules = new Map(deriveSanitizationRules(db).map((rule) => [`${rule.table}.${rule.column}`, rule]))
    expect(rules.get("posts.post_id")?.mode).toBe("preserve")
    expect(rules.get("posts.author_id")?.mode).toBe("preserve")
    expect(rules.get("posts.status")?.mode).toBe("preserve")
    expect(rules.get("posts.body")?.mode).toBe("mask_text")
    expect(rules.get("posts.attachment")?.mode).toBe("stable_blob")
    expect(rules.get("schema_migrations.checksum")?.reason).toBe("migration_ledger_verbatim")
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
