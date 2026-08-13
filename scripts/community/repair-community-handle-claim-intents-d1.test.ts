import { describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"
import { parseMigrationStatements, planRepair, probeFromRow, probeSql } from "./repair-community-handle-claim-intents-d1"
import { SPEC } from "./apply-community-handle-claim-intents-d1-migration"

const MIGRATION = "db/community-template/migrations/1157_community_handle_claim_intents.sql"

async function fixtures() {
  const sql = await readFile(new URL(`../../${MIGRATION}`, import.meta.url), "utf8")
  return { sql, checksum: createHash("sha256").update(sql).digest("hex"), statements: parseMigrationStatements(sql) }
}

function row(overrides: Record<string, unknown> = {}) {
  return {
    has_ledger: 1,
    ledger_checksum: "",
    req_community_handle_claim_quotes: 1,
    req_community_handle_label_reservations: 1,
    req_community_handles: 1,
    col_community_handle_claim_quotes__handle_claim_intent_id: 0,
    col_community_handle_label_reservations__handle_claim_intent_id: 0,
    col_community_handles__handle_claim_intent_id: 0,
    idx_idx_community_handle_claim_quotes_intent: 0,
    idx_idx_community_handle_label_reservations_active_intent: 0,
    idx_idx_community_handles_claim_intent_once: 0,
    ...overrides,
  }
}

describe("community 1157 partial-state repair", () => {
  test("probes each owned column and index separately", () => {
    const sql = probeSql(SPEC)
    expect(sql).toContain("pragma_table_info('community_handle_claim_quotes')")
    expect(sql).toContain("name='idx_community_handles_claim_intent_once'")
  })

  test("validates the canonical migration statement shapes", async () => {
    const { statements } = await fixtures()
    expect(Object.keys(statements.columns)).toHaveLength(3)
    expect(Object.keys(statements.indexes)).toHaveLength(3)
  })

  test("refuses a pristine shard so the normal runner owns first application", async () => {
    const { checksum, statements } = await fixtures()
    expect(planRepair(probeFromRow(row()), checksum, statements)).toEqual({
      kind: "refuse",
      reason: "no objects are present; use the normal migration runner",
    })
  })

  test("keeps pristine shards out of an explicit partial-only repair plan", async () => {
    const { checksum, statements } = await fixtures()
    const plan = planRepair(probeFromRow(row()), checksum, statements)
    expect(plan.kind).toBe("refuse")
    // The CLI converts this exact refusal to a skip only when --partial-only
    // is explicitly supplied; the pure planner remains fail-closed by default.
    expect(plan).toMatchObject({ reason: "no objects are present; use the normal migration runner" })
  })

  test("plans only missing columns and indexes, then the ledger", async () => {
    const { checksum, statements } = await fixtures()
    const partial = probeFromRow(row({
      col_community_handle_claim_quotes__handle_claim_intent_id: 1,
      col_community_handle_label_reservations__handle_claim_intent_id: 1,
    }))
    const plan = planRepair(partial, checksum, statements)
    expect(plan.kind).toBe("repair")
    if (plan.kind !== "repair") throw new Error("expected repair")
    expect(plan.ledger).toBe(true)
    expect(plan.statements).toHaveLength(4)
    expect(plan.statements.join("\n")).toContain("ALTER TABLE community_handles")
    expect(plan.statements.join("\n")).not.toContain("ALTER TABLE community_handle_claim_quotes")
  })

  test("does not rewrite an existing exact ledger", async () => {
    const { checksum, statements } = await fixtures()
    const partial = probeFromRow(row({
      ledger_checksum: checksum,
      col_community_handle_claim_quotes__handle_claim_intent_id: 1,
      col_community_handle_label_reservations__handle_claim_intent_id: 1,
      col_community_handles__handle_claim_intent_id: 1,
    }))
    const plan = planRepair(partial, checksum, statements)
    expect(plan.kind).toBe("repair")
    if (plan.kind !== "repair") throw new Error("expected repair")
    expect(plan.ledger).toBe(false)
    expect(plan.statements).toHaveLength(3)
  })
})
