import { describe, expect, test } from "bun:test"
import { planRepair } from "./repair-staging-posts-idempotency-body-hash"

describe("staging posts idempotency column repair", () => {
  test("repairs only matching recorded 1117 drift", () => {
    expect(planRepair({ checksum: "x", probe: { hasPosts: true, hasColumn: false, ledgerChecksum: "x" } })).toEqual({ kind: "repair" })
    expect(planRepair({ checksum: "x", probe: { hasPosts: true, hasColumn: true, ledgerChecksum: "x" } })).toEqual({ kind: "converged" })
  })
  test("refuses unsafe states", () => {
    expect(planRepair({ checksum: "x", probe: { hasPosts: false, hasColumn: false, ledgerChecksum: "x" } }).kind).toBe("refuse")
    expect(planRepair({ checksum: "x", probe: { hasPosts: true, hasColumn: false, ledgerChecksum: "" } }).kind).toBe("refuse")
    expect(planRepair({ checksum: "x", probe: { hasPosts: true, hasColumn: false, ledgerChecksum: "y" } }).kind).toBe("refuse")
  })
})
