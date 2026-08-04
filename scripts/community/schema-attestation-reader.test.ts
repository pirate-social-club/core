import { describe, expect, test } from "bun:test"
import { Database } from "bun:sqlite"

import {
  compareAttestationShadow,
  readPoolAttestationAggregate,
} from "./lib/schema-attestation-reader"

const POLICY = "a".repeat(64)

function setup() {
  const db = new Database(":memory:")
  db.exec(`
    CREATE TABLE d1_pool (
      binding_name TEXT PRIMARY KEY,
      community_id TEXT,
      last_loaded_at TEXT,
      version INTEGER NOT NULL
    );
    CREATE TABLE d1_pool_schema_attestations (
      shard_worker_id TEXT NOT NULL,
      binding_name TEXT NOT NULL,
      community_id TEXT NOT NULL,
      pool_version INTEGER NOT NULL,
      state TEXT NOT NULL,
      effective_policy_digest TEXT NOT NULL,
      verified_at TEXT,
      PRIMARY KEY (shard_worker_id, binding_name)
    );
  `)
  const run = async (statements: Array<{ sql: string; params?: unknown[] }>) => statements.map((statement) => ({
    results: db.query(statement.sql).all(...(statement.params ?? [])),
    success: true,
  }))
  return { db, run }
}

describe("schema attestation shadow reader", () => {
  test("excludes quarantined invalid rows while requiring every eligible generation to verify", async () => {
    const { db, run } = setup()
    try {
      db.exec(`INSERT INTO d1_pool VALUES
        ('DB_CMTY_OK', 'cmt_ok', '2026-08-04T00:00:00Z', 3),
        ('DB_CMTY_QUARANTINED', 'cmt_q', '2026-08-04T00:00:00Z', 8)`)
      db.exec(`INSERT INTO d1_pool_schema_attestations VALUES
        ('shard-staging', 'DB_CMTY_OK', 'cmt_ok', 3, 'verified', '${POLICY}', '2026-08-04T00:00:00Z'),
        ('shard-staging', 'DB_CMTY_QUARANTINED', 'cmt_q', 8, 'invalid', '${POLICY}', NULL)`)
      const aggregate = await readPoolAttestationAggregate({
        shardWorkerId: "shard-staging",
        policyDigest: POLICY,
        quarantinedBindings: ["DB_CMTY_QUARANTINED"],
        run,
      })
      expect(aggregate).toMatchObject({
        live_count: 1,
        verified_count: 1,
        missing_count: 0,
        invalid_count: 0,
        policy_mismatch_count: 0,
      })
      expect(compareAttestationShadow({
        aggregate,
        expectedLiveCount: 1,
        authoritativePass: true,
      })).toMatchObject({ would_fast_path_fire: true, authoritative_match: true })
    } finally {
      db.close()
    }
  })

  test("reports a false shadow match when the reader abstains despite an authoritative pass", async () => {
    const { db, run } = setup()
    try {
      db.exec("INSERT INTO d1_pool VALUES ('DB_CMTY_MISSING', 'cmt_missing', '2026-08-04T00:00:00Z', 3)")
      const aggregate = await readPoolAttestationAggregate({
        shardWorkerId: "shard-staging",
        policyDigest: POLICY,
        quarantinedBindings: [],
        run,
      })
      expect(compareAttestationShadow({
        aggregate,
        expectedLiveCount: 1,
        authoritativePass: true,
      })).toMatchObject({
        missing_count: 1,
        would_fast_path_fire: false,
        authoritative_match: false,
      })
    } finally {
      db.close()
    }
  })

  test("fails closed on a policy digest mismatch", async () => {
    const { db, run } = setup()
    try {
      db.exec("INSERT INTO d1_pool VALUES ('DB_CMTY_OLD', 'cmt_old', '2026-08-04T00:00:00Z', 3)")
      db.exec(`INSERT INTO d1_pool_schema_attestations VALUES
        ('shard-staging', 'DB_CMTY_OLD', 'cmt_old', 3, 'verified', '${"b".repeat(64)}', '2026-08-04T00:00:00Z')`)
      const aggregate = await readPoolAttestationAggregate({
        shardWorkerId: "shard-staging",
        policyDigest: POLICY,
        quarantinedBindings: [],
        run,
      })
      expect(compareAttestationShadow({
        aggregate,
        expectedLiveCount: 1,
        authoritativePass: false,
      })).toMatchObject({
        policy_mismatch_count: 1,
        would_fast_path_fire: false,
        authoritative_match: true,
      })
    } finally {
      db.close()
    }
  })
})
