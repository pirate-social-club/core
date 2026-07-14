import { describe, expect, test } from "bun:test"

import { expectedArtifacts } from "./community-schema-artifacts"

describe("expectedArtifacts", () => {
  // 1127 — the migration whose absence broke every publish in production.
  test("extracts ADD COLUMN artifacts (1127)", () => {
    const sql = `ALTER TABLE assets ADD COLUMN story_ip_metadata_uri TEXT;
ALTER TABLE assets ADD COLUMN story_ip_metadata_hash TEXT;
ALTER TABLE assets ADD COLUMN story_nft_metadata_uri TEXT;
ALTER TABLE assets ADD COLUMN story_nft_metadata_hash TEXT;`
    const { tables, columns } = expectedArtifacts(sql)
    expect(tables).toEqual([])
    expect(columns).toEqual([
      ["assets", "story_ip_metadata_uri"],
      ["assets", "story_ip_metadata_hash"],
      ["assets", "story_nft_metadata_uri"],
      ["assets", "story_nft_metadata_hash"],
    ])
  })

  // 1126 — feature-conditional (rewards). Pure CREATE TABLE.
  test("extracts CREATE TABLE artifacts (1126-style)", () => {
    const sql = `CREATE TABLE IF NOT EXISTS reward_qualification_outbox (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_reward_qualification_outbox_created ON reward_qualification_outbox (created_at);`
    const { tables, columns } = expectedArtifacts(sql)
    expect(tables).toEqual(["reward_qualification_outbox"])
    expect(columns).toEqual([])
  })

  test("handles a mixed migration", () => {
    const sql = `CREATE TABLE community_jobs (id TEXT PRIMARY KEY);
ALTER TABLE community_jobs ADD COLUMN last_checkpoint TEXT;`
    const { tables, columns } = expectedArtifacts(sql)
    expect(tables).toEqual(["community_jobs"])
    expect(columns).toEqual([["community_jobs", "last_checkpoint"]])
  })

  // A commented-out statement must not become a required artifact, or the gate
  // would demand schema that no migration actually creates and never go green.
  test("ignores commented-out statements", () => {
    const sql = `-- ALTER TABLE assets ADD COLUMN never_created TEXT;
ALTER TABLE assets ADD COLUMN real_column TEXT;`
    const { columns } = expectedArtifacts(sql)
    expect(columns).toEqual([["assets", "real_column"]])
  })

  test("is case-insensitive and tolerates quoting", () => {
    const sql = `create table if not exists "widgets" (id text);
alter table \`widgets\` add column 'label' text;`
    const { tables, columns } = expectedArtifacts(sql)
    expect(tables).toEqual(["widgets"])
    expect(columns).toEqual([["widgets", "label"]])
  })

  test("returns nothing for a migration with no schema artifacts", () => {
    const { tables, columns } = expectedArtifacts("UPDATE assets SET story_ip_metadata_uri = NULL;")
    expect(tables).toEqual([])
    expect(columns).toEqual([])
  })
})
