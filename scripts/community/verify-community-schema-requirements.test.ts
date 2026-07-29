import { describe, expect, test } from "bun:test"

import { resolve } from "node:path"

import {
  buildCanonicalSchemaArtifacts,
  buildProbe,
  CANONICAL_SCHEMA_INVENTORY_SQL,
  databaseTargetsFromWranglerConfig,
  d1QueryBatch,
  probeShard,
  schemaArtifactsFromRows,
  canonicalSchemaRegressions,
  validateCanonicalSchemaBaseline,
  validateCompatibleMissingSchemaArtifacts,
  validateRequirements,
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
    const calls: string[][] = []
    const result = await probeShard(required, expected, false, async (statements) => {
      calls.push(statements)
      if (calls.length === 1) throw new Error("APIError code=7500: internal error")
      return [
        { success: true, results: [{ l0: 1, k0: 1, a0: 2 }] },
        { success: true, results: [{ l0: 1, k0: 0, a0: 3 }] },
      ]
    })

    expect(calls).toHaveLength(2)
    expect(calls[0]).toHaveLength(1)
    expect(calls[1]).toHaveLength(2)
    expect(result).toEqual({
      row: { l0: 1, k0: 1, a0: 2, l1: 1, k1: 0, a1: 3 },
      inventoryRows: [],
    })
  })

  test("does not mask non-7500 combined probe failures", async () => {
    const expected = new Map([["one.sql", {
      checksum: "one",
      artifacts: {
        tables: [], columns: [], indexes: [], absentIndexes: [], altered: [], unrecognized: [],
      },
    }]])
    let calls = 0
    await expect(probeShard(["one.sql"], expected, false, async () => {
      calls += 1
      throw new Error("authentication failed")
    })).rejects.toThrow("authentication failed")
    expect(calls).toBe(1)
  })

  test("carries the canonical inventory in the same healthy request", async () => {
    const expected = new Map([["one.sql", {
      checksum: "one",
      artifacts: {
        tables: [], columns: [], indexes: [], absentIndexes: [], altered: [], unrecognized: [],
      },
    }]])
    const calls: string[][] = []
    const result = await probeShard(["one.sql"], expected, true, async (statements) => {
      calls.push(statements)
      return [
        { success: true, results: [{ l0: 1, k0: 1, a0: 0 }] },
        {
          success: true,
          results: [{ type: "table", name: "posts", sql: "CREATE TABLE posts (post_id TEXT)" }],
        },
      ]
    })

    expect(calls).toHaveLength(1)
    expect(calls[0]).toHaveLength(2)
    expect(calls[0][1]).toBe(CANONICAL_SCHEMA_INVENTORY_SQL)
    expect(result.inventoryRows).toHaveLength(1)
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

describe("D1 REST query batching", () => {
  test("selects database ids from the requested Wrangler environment", () => {
    const config = {
      d1_databases: [
        { binding: "D1_POOL", database_name: "pool-staging", database_id: "pool-staging-id" },
        { binding: "DB_CMTY_0001", database_name: "shard-staging", database_id: "shard-staging-id" },
      ],
      env: {
        production: {
          d1_databases: [
            { binding: "D1_POOL", database_name: "pool-prod", database_id: "pool-prod-id" },
            { binding: "DB_CMTY_0001", database_name: "shard-prod", database_id: "shard-prod-id" },
          ],
        },
      },
    }

    expect(databaseTargetsFromWranglerConfig(config, false).get("DB_CMTY_0001")).toEqual({
      name: "shard-staging",
      id: "shard-staging-id",
    })
    expect(databaseTargetsFromWranglerConfig(config, true).get("D1_POOL")).toEqual({
      name: "pool-prod",
      id: "pool-prod-id",
    })
  })

  test("fails closed when a selected D1 binding has no database id", () => {
    expect(() => databaseTargetsFromWranglerConfig({
      d1_databases: [
        { binding: "D1_POOL", database_name: "pool-staging" },
      ],
    }, false)).toThrow("D1_POOL requires database_name and database_id")
  })

  test("sends multiple read statements in one API request", async () => {
    let requestUrl = ""
    let requestInit: RequestInit | undefined
    const results = await d1QueryBatch({
      accountId: "account-id",
      apiToken: "token",
      fetch: (async (input, init) => {
        requestUrl = String(input)
        requestInit = init
        return Response.json({
          success: true,
          errors: [],
          result: [
            { success: true, results: [{ l0: 1 }] },
            { success: true, results: [{ type: "table", name: "posts", sql: "CREATE TABLE posts (id TEXT)" }] },
          ],
        })
      }) as typeof fetch,
      sleep: async () => {},
    }, {
      name: "community-d1-pool-0001-staging",
      id: "database-id",
    }, ["SELECT 1 AS l0", CANONICAL_SCHEMA_INVENTORY_SQL])

    expect(results).toHaveLength(2)
    expect(requestUrl).toEndWith("/accounts/account-id/d1/database/database-id/query")
    expect(requestInit?.method).toBe("POST")
    expect(JSON.parse(String(requestInit?.body))).toEqual({
      batch: [
        { sql: "SELECT 1 AS l0" },
        { sql: CANONICAL_SCHEMA_INVENTORY_SQL },
      ],
    })
  })

  test("retries API failures with backoff and redacts identifiers", async () => {
    const delays: number[] = []
    let attempts = 0
    const metrics = {
      logical_batches: 0,
      statements_submitted: 0,
      http_attempts: 0,
      retries: 0,
      errors_by_code: {},
      cumulative_http_attempt_duration_ms: 0,
    }
    const promise = d1QueryBatch({
      accountId: "secret-account-id",
      apiToken: "secret-token",
      fetch: (async () => {
        attempts += 1
        return Response.json({
          success: false,
          errors: [{
            code: 7429,
            message: "database secret-database-id in secret-account-id overloaded for secret-token",
          }],
          result: [],
        })
      }) as typeof fetch,
      sleep: async (milliseconds) => {
        delays.push(milliseconds)
      },
      metrics,
    }, {
      name: "community-d1-pool-0562-staging",
      id: "secret-database-id",
    }, ["SELECT 1"])

    await expect(promise).rejects.toThrow(
      "D1 query community-d1-pool-0562-staging failed after 4 attempts: " +
        "APIError code=7429: database (database id redacted) in (account id redacted) overloaded for (token redacted)",
    )
    expect(attempts).toBe(4)
    expect(delays).toEqual([500, 1_000, 2_000])
    expect(metrics).toMatchObject({
      logical_batches: 1,
      statements_submitted: 1,
      http_attempts: 4,
      retries: 3,
      errors_by_code: { 7429: 4 },
    })
  })
})
