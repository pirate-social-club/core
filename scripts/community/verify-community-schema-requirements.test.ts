import { describe, expect, test } from "bun:test"

import { resolve } from "node:path"

import {
  buildCanonicalSchemaArtifacts,
  buildProbe,
  CANONICAL_SCHEMA_INVENTORY_SQL,
  probeShard,
  schemaArtifactsFromRows,
  canonicalSchemaRegressions,
  validateCanonicalSchemaBaseline,
  validateCompatibleMissingSchemaArtifacts,
  validateRequirements,
  wranglerFailureDetail,
} from "./verify-community-schema-requirements"

const base = {
  version: 1,
  unconditional: ["1133_multi_namespace_bindings.sql"],
  features: {},
  deferred: {},
}

describe("schema requirements policy validation", () => {
  test("accepts known, disjoint policy classes", () => {
    expect(validateRequirements({ ...base, canonical_schema: true }).unconditional).toEqual(base.unconditional)
  })

  test("rejects a non-boolean canonical schema switch", () => {
    expect(() => validateRequirements({ ...base, canonical_schema: "true" }))
      .toThrow("canonical_schema must be a boolean")
  })

  test("fails closed on unknown top-level policy fields", () => {
    expect(() => validateRequirements({ ...base, defered: {} })).toThrow("unknown top-level key(s): defered")
  })

  test("rejects deferred and unconditional overlap", () => {
    expect(() => validateRequirements({
      ...base,
      deferred: { "1133_multi_namespace_bindings.sql": { rationale: "not live yet" } },
    })).toThrow("overlaps policy classes unconditional and deferred")
  })

  test("rejects overlap between feature classes", () => {
    expect(() => validateRequirements({
      ...base,
      unconditional: [],
      features: {
        one: { flags: ["ONE"], migrations: ["1133_multi_namespace_bindings.sql"] },
        two: { flags: ["TWO"], migrations: ["1133_multi_namespace_bindings.sql"] },
      },
    })).toThrow("overlaps policy classes features.one and features.two")
  })

  test("accepts a complete time-bounded transitional policy", () => {
    const migration = "1143_lyrics_language.sql"
    expect(validateRequirements({
      ...base,
      transitional: {
        [migration]: {
          rationale: "Schema-tolerant runtime projection",
          promotion_condition: "Fleet migration and quarantine closure",
          expires_after: "2099-08-15T13:44:00Z",
          owner: "release-owner",
          tracking_issue: "https://github.com/example/repo/issues/1",
          capability_guard: "hasLyricsLanguageColumns",
          runtime_reference_counts: {
            "src/projection.ts": { lyrics_language: 1 },
          },
          compatibility_tests: [{
            path: "src/projection.test.ts",
            sha256: "a".repeat(64),
          }],
        },
      },
    }).transitional?.[migration]).toBeDefined()
  })

  test("rejects expired or semantically empty transitional policy", () => {
    expect(() => validateRequirements({
      ...base,
      transitional: {
        "1143_lyrics_language.sql": {
          rationale: "temporary",
          promotion_condition: "migrate fleet",
          expires_after: "2000-01-01T00:00:00Z",
          owner: "release-owner",
          tracking_issue: "https://github.com/example/repo/issues/1",
          capability_guard: "hasLyricsLanguageColumns",
          runtime_reference_counts: {},
          compatibility_tests: [],
        },
      },
    })).toThrow("expires_after must be a future timestamp")
  })

  test("rejects transitional overlap with an enforcing class", () => {
    expect(() => validateRequirements({
      ...base,
      transitional: {
        "1133_multi_namespace_bindings.sql": {
          rationale: "temporary",
          promotion_condition: "migrate fleet",
          expires_after: "2099-01-01T00:00:00Z",
          owner: "release-owner",
          tracking_issue: "https://github.com/example/repo/issues/1",
          capability_guard: "hasColumns",
          runtime_reference_counts: { "src/projection.ts": { column: 1 } },
          compatibility_tests: [{
            path: "src/projection.test.ts",
            sha256: "a".repeat(64),
          }],
        },
      },
    })).toThrow("overlaps policy classes unconditional and transitional")
  })
})

describe("canonical schema ratchet", () => {
  test("accepts shrinkage but reports new missing artifacts", () => {
    const baseline = {
      version: 1 as const, fleet: "production" as const,
      profiles: { legacy: ["column:a.x"] }, shards: { DB_CMTY_1: "legacy" },
    }
    expect(canonicalSchemaRegressions(["column:a.x"], "DB_CMTY_1", baseline)).toEqual([])
    expect(canonicalSchemaRegressions(["column:a.x", "table:new_gap"], "DB_CMTY_1", baseline))
      .toEqual(["table:new_gap"])
  })

  test("requires a new shard absent from the baseline to be canonical", () => {
    expect(canonicalSchemaRegressions(["column:a.x"], "DB_CMTY_NEW", {
      version: 1, fleet: "production", profiles: { legacy: ["column:a.x"] }, shards: { DB_CMTY_1: "legacy" },
    })).toEqual(["column:a.x"])
  })

  test("validates fleet identity and unique artifact lists", () => {
    const valid = { version: 1, fleet: "production", profiles: { legacy: ["table:a"] }, shards: { DB_CMTY_1: "legacy" } }
    expect(validateCanonicalSchemaBaseline(valid, "production")).toEqual(valid)
    expect(() => validateCanonicalSchemaBaseline({ ...valid, fleet: "staging" }, "production"))
      .toThrow("fleet must be production")
    expect(() => validateCanonicalSchemaBaseline({ ...valid, profiles: { legacy: ["table:a", "table:a"] } }, "production"))
      .toThrow("contains duplicates")
    expect(() => validateCanonicalSchemaBaseline({ ...valid, shards: { DB_CMTY_1: "missing" } }, "production"))
      .toThrow("must name a declared profile")
  })
})

describe("schema requirements probe", () => {
  test("counts a dropped index as satisfied only when it is absent", () => {
    const migration = "1133_multi_namespace_bindings.sql"
    const probe = buildProbe([migration], new Map([[migration, {
      checksum: "abc",
      artifacts: {
        tables: [],
        columns: [],
        indexes: [],
        absentIndexes: ["idx_namespace_bindings_active_community"],
        altered: [],
        unrecognized: [],
      },
    }]]))
    expect(probe).toContain(
      "SELECT COUNT(*) = 0 FROM sqlite_master WHERE type='index' AND name='idx_namespace_bindings_active_community'",
    )
  })

  test("falls back migration-by-migration only for D1 error 7500 and remaps aliases", async () => {
    const required = ["one.sql", "two.sql"]
    const expected = new Map(required.map((name) => [name, {
      checksum: name,
      artifacts: {
        tables: [], columns: [], indexes: [], absentIndexes: [], altered: [], unrecognized: [],
      },
    }]))
    const calls: string[] = []
    const row = await probeShard(required, expected, async (sql) => {
      calls.push(sql)
      if (calls.length === 1) throw new Error("APIError code=7500: internal error")
      return calls.length === 2 ? { l0: 1, k0: 1, a0: 2 } : { l0: 1, k0: 0, a0: 3 }
    })

    expect(calls).toHaveLength(3)
    expect(row).toEqual({ l0: 1, k0: 1, a0: 2, l1: 1, k1: 0, a1: 3 })
  })

  test("does not mask non-7500 combined probe failures", async () => {
    const expected = new Map([["one.sql", {
      checksum: "one",
      artifacts: {
        tables: [], columns: [], indexes: [], absentIndexes: [], altered: [], unrecognized: [],
      },
    }]])
    let calls = 0
    await expect(probeShard(["one.sql"], expected, async () => {
      calls += 1
      throw new Error("authentication failed")
    })).rejects.toThrow("authentication failed")
    expect(calls).toBe(1)
  })
})

describe("canonical final-schema attestation", () => {
  test("derives the complete final table/index/column set while excluding deferred migrations", async () => {
    const artifacts = await buildCanonicalSchemaArtifacts({
      migrationsDir: resolve(import.meta.dir, "../../db/community-template/migrations"),
      excludedMigrations: new Set(["1139_story_registration_durable_request.sql"]),
    })
    expect(artifacts.has("table:karaoke_attempt")).toBe(true)
    expect(artifacts.has("index:idx_karaoke_attempt_rank")).toBe(true)
    expect(artifacts.has("column:song_engagement_days.activity_timezone")).toBe(true)
    expect(artifacts.has("column:story_registration_effects.durable_request_json")).toBe(false)
  })

  test("uses one complete inventory query and rejects stale drift exceptions", () => {
    expect(CANONICAL_SCHEMA_INVENTORY_SQL).not.toContain("pragma_table_info")
    expect(schemaArtifactsFromRows([
      {
        type: "table",
        name: "posts",
        sql: `CREATE TABLE posts (post_id TEXT PRIMARY KEY, payload TEXT CHECK (payload IN ('a,b')), CONSTRAINT posts_unique UNIQUE (post_id))`,
      },
      { type: "index", name: "idx_posts_payload", sql: "CREATE INDEX idx_posts_payload ON posts(payload)" },
    ])).toEqual(new Set([
      "table:posts",
      "column:posts.post_id",
      "column:posts.payload",
      "index:idx_posts_payload",
    ]))
    const expected = new Set(["table:posts"])
    expect(validateCompatibleMissingSchemaArtifacts([], expected, "policy")).toEqual(new Set())
    expect(() => validateCompatibleMissingSchemaArtifacts([
      { artifact: "table:unknown", reason: "legacy" },
    ], expected, "policy")).toThrow("stale or unknown")
  })
})

describe("wrangler failure diagnostics", () => {
  test("surfaces the stdout JSON error instead of stderr configuration warnings", () => {
    const stdout = JSON.stringify({
      error: {
        text: "request path containing a database id failed",
        notes: [{ text: "internal error; reference = ref_123 [code: 7500]" }],
        name: "APIError",
        code: 7500,
        accountTag: "secret-account-id",
      },
    })
    expect(wranglerFailureDetail(stdout, "very long configuration warning")).toBe(
      "APIError code=7500: internal error; reference = ref_123 [code: 7500]",
    )
  })

  test("bounds an unstructured fallback", () => {
    expect(wranglerFailureDetail("", "x".repeat(3_000))).toBe(`${"x".repeat(2_000)}…`)
  })
})
