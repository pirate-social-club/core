import { describe, expect, test } from "bun:test"
import { planRepair, REPAIRS } from "./repair-staging-1158-source-columns"

const checksums = Object.fromEntries(REPAIRS.map(({ migration }) => [migration, migration]))

describe("1158 additive source-column repair", () => {
  test("refuses missing columns when their source migration ledger is absent", () => {
    expect(planRepair({ columns: [], ledgers: {} }, checksums).kind).toBe("refuse")
  })

  test("reproduces canonical declarations and converges", () => {
    const probe = {
      columns: [
        { table: "posts", name: "lyrics_language" },
        { table: "posts", name: "age_gate_source" },
        { table: "posts", name: "age_gate_evidence_ref" },
        { table: "posts", name: "age_gate_set_at" },
      ],
      ledgers: checksums,
    }
    const plan = planRepair(probe, checksums)
    expect(plan.kind).toBe("repair")
    expect(plan.statements).toContain("ALTER TABLE posts ADD COLUMN lyrics_language_reliable INTEGER NOT NULL DEFAULT 0;")
    expect(plan.statements).toContain("ALTER TABLE assets ADD COLUMN royalty_allocation_projection_synced INTEGER NOT NULL DEFAULT 1 CHECK (royalty_allocation_projection_synced IN (0, 1));")
    expect(planRepair({ columns: [
      ...REPAIRS.flatMap(({ columns }) => columns.map(([table, name]) => ({ table, name }))),
      { table: "posts", name: "age_gate_source" }, { table: "posts", name: "age_gate_evidence_ref" }, { table: "posts", name: "age_gate_set_at" },
    ], ledgers: checksums }, checksums)).toEqual({ kind: "converged" })
  })
})
