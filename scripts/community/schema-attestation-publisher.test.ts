import { Database } from "bun:sqlite"
import { describe, expect, test } from "bun:test"

import type { D1QueryStatement } from "./lib/d1-rest-types"
import {
  PROPOSED_AGGREGATE_SQL,
  PROPOSED_LEDGER_DDL,
  digest,
  type PolicyVerdictRow,
} from "./lib/schema-attestation-proof"
import {
  invalidatePoolAttestations,
  publishPoolAttestations,
} from "./lib/schema-attestation-publisher"

function setup() {
  const db = new Database(":memory:")
  db.exec("PRAGMA foreign_keys = ON")
  db.exec(`CREATE TABLE d1_pool (
    binding_name TEXT PRIMARY KEY,
    community_id TEXT UNIQUE,
    last_loaded_at TEXT,
    version INTEGER NOT NULL
  )`)
  db.exec(PROPOSED_LEDGER_DDL)
  const run = async (statements: D1QueryStatement[]) => statements.map((statement) => ({
    success: true,
    results: db.query<Record<string, unknown>, unknown[]>(statement.sql).all(...(statement.params ?? [])),
  }))
  return { db, run }
}

function row(input: {
  binding: string
  community: string
  version: number
  schema?: string
  status?: PolicyVerdictRow["verdict_status"]
  runId?: string
}): PolicyVerdictRow {
  const status = input.status ?? "satisfied"
  const satisfied = status === "satisfied"
  const runId = input.runId ?? "run-1"
  return {
    shard_worker_id: "community-d1-shard-staging",
    binding_name: input.binding,
    community_id: input.community,
    pool_version: input.version,
    attestation_epoch: runId,
    state: satisfied ? "verified" : "invalid",
    verdict_status: status,
    effective_policy_digest: digest("policy"),
    schema_fingerprint: digest(input.schema ?? input.binding),
    migration_ledger_digest: digest(`ledger:${input.binding}`),
    canonical_inventory_digest: digest(`canonical:${input.binding}`),
    verified_at: satisfied ? "2026-08-04T00:00:00.000Z" : null,
    writer_kind: "full_scan",
    writer_run_id: runId,
    last_error_code: satisfied ? null : status,
    last_error_detail: satisfied ? null : "probe failed",
  }
}

describe("schema attestation publisher", () => {
  test("invalidates the complete loaded roster before scanning", async () => {
    const { db, run } = setup()
    try {
      db.exec(`INSERT INTO d1_pool VALUES
        ('DB_CMTY_0001', 'cmt_1', '2026-08-04T00:00:00.000Z', 4),
        ('DB_CMTY_0002', 'cmt_2', '2026-08-04T00:00:00.000Z', 9)`)
      await invalidatePoolAttestations({
        shardWorkerId: "community-d1-shard-staging",
        writerRunId: "run-1",
        policyDigest: digest("policy"),
        unavailableDigest: digest("unavailable"),
        expectedRoster: [
          { binding_name: "DB_CMTY_0001", community_id: "cmt_1", version: 4 },
          { binding_name: "DB_CMTY_0002", community_id: "cmt_2", version: 9 },
        ],
        run,
      })
      expect(db.query("SELECT binding_name, state FROM d1_pool_schema_attestations ORDER BY binding_name").all())
        .toEqual([
          { binding_name: "DB_CMTY_0001", state: "invalid" },
          { binding_name: "DB_CMTY_0002", state: "invalid" },
        ])
    } finally {
      db.close()
    }
  })

  test("publishes distinct fingerprints for heterogeneous schema profiles", async () => {
    const { db, run } = setup()
    try {
      db.exec(`INSERT INTO d1_pool VALUES
        ('DB_CMTY_0016', 'cmt_16', '2026-08-04T00:00:00.000Z', 2),
        ('DB_CMTY_0020', 'cmt_20', '2026-08-04T00:00:00.000Z', 3)`)
      await invalidatePoolAttestations({
        shardWorkerId: "community-d1-shard-staging",
        writerRunId: "run-1",
        policyDigest: digest("policy"),
        unavailableDigest: digest("unavailable"),
        expectedRoster: [
          { binding_name: "DB_CMTY_0016", community_id: "cmt_16", version: 2 },
          { binding_name: "DB_CMTY_0020", community_id: "cmt_20", version: 3 },
        ],
        run,
      })
      await publishPoolAttestations({
        rows: [
          row({ binding: "DB_CMTY_0016", community: "cmt_16", version: 2, schema: "profile-80" }),
          row({ binding: "DB_CMTY_0020", community: "cmt_20", version: 3, schema: "profile-87" }),
        ],
        run,
      })
      const fingerprints = db.query<{ schema_fingerprint: string }, []>(
        "SELECT schema_fingerprint FROM d1_pool_schema_attestations ORDER BY binding_name",
      ).all()
      expect(new Set(fingerprints.map((entry) => entry.schema_fingerprint)).size).toBe(2)
    } finally {
      db.close()
    }
  })

  test("rejects an older scan after a newer writer epoch invalidates the roster", async () => {
    const { db, run } = setup()
    try {
      const generation = { binding_name: "DB_CMTY_0001", community_id: "cmt_1", version: 4 }
      db.exec("INSERT INTO d1_pool VALUES ('DB_CMTY_0001', 'cmt_1', '2026-08-04T00:00:00.000Z', 4)")
      await invalidatePoolAttestations({
        shardWorkerId: "community-d1-shard-staging",
        writerRunId: "run-1",
        policyDigest: digest("policy"),
        unavailableDigest: digest("unavailable"),
        expectedRoster: [generation],
        run,
      })
      await invalidatePoolAttestations({
        shardWorkerId: "community-d1-shard-staging",
        writerRunId: "run-2",
        policyDigest: digest("policy"),
        unavailableDigest: digest("unavailable"),
        expectedRoster: [generation],
        run,
      })

      await expect(publishPoolAttestations({
        rows: [row({ binding: "DB_CMTY_0001", community: "cmt_1", version: 4, runId: "run-1" })],
        run,
      })).rejects.toThrow("generation fence rejected")
      expect(db.query("SELECT state, writer_run_id FROM d1_pool_schema_attestations").get()).toEqual({
        state: "invalid",
        writer_run_id: "run-2",
      })
    } finally {
      db.close()
    }
  })

  test("rejects a released-and-reallocated generation and leaves no usable stale proof", async () => {
    const { db, run } = setup()
    try {
      db.exec("INSERT INTO d1_pool VALUES ('DB_CMTY_0001', 'cmt_old', '2026-08-04T00:00:00.000Z', 4)")
      await invalidatePoolAttestations({
        shardWorkerId: "community-d1-shard-staging",
        writerRunId: "run-1",
        policyDigest: digest("policy"),
        unavailableDigest: digest("unavailable"),
        expectedRoster: [{ binding_name: "DB_CMTY_0001", community_id: "cmt_old", version: 4 }],
        run,
      })
      db.exec("UPDATE d1_pool SET community_id = 'cmt_new', version = 6 WHERE binding_name = 'DB_CMTY_0001'")
      await expect(publishPoolAttestations({
        rows: [row({ binding: "DB_CMTY_0001", community: "cmt_old", version: 4 })],
        run,
      })).rejects.toThrow("generation fence rejected")

      const aggregate = db.query<Record<string, unknown>, [string, string, string]>(PROPOSED_AGGREGATE_SQL)
        .get("community-d1-shard-staging", digest("policy"), "[]")!
      expect(aggregate.live_count).toBe(1)
      expect(aggregate.missing_count).toBe(1)
      expect(aggregate.verified_count).toBe(0)
    } finally {
      db.close()
    }
  })

  test("fails closed when the invalidation roster changed after discovery", async () => {
    const { db, run } = setup()
    try {
      db.exec("INSERT INTO d1_pool VALUES ('DB_CMTY_0001', 'cmt_new', '2026-08-04T00:00:00.000Z', 6)")
      await expect(invalidatePoolAttestations({
        shardWorkerId: "community-d1-shard-staging",
        writerRunId: "run-1",
        policyDigest: digest("policy"),
        unavailableDigest: digest("unavailable"),
        expectedRoster: [{ binding_name: "DB_CMTY_0001", community_id: "cmt_old", version: 4 }],
        run,
      })).rejects.toThrow("generation fence rejected")
    } finally {
      db.close()
    }
  })
})
