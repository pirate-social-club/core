import { describe, expect, test } from "bun:test"

import {
  parseAudienceGateMigration,
  planAudienceGateRepair,
} from "./repair-live-room-audience-gate-column-d1"

const statement = "ALTER TABLE live_rooms ADD COLUMN audience_gate_json TEXT;"

describe("live room audience gate single-shard repair", () => {
  test("accepts only the reviewed migration shape", () => {
    expect(parseAudienceGateMigration(`${statement}\n`)).toBe(statement)
    expect(() => parseAudienceGateMigration("ALTER TABLE live_rooms ADD COLUMN other TEXT;"))
      .toThrow("statement shape changed")
  })

  test("repairs only a matching recorded migration with a missing column", () => {
    expect(planAudienceGateRepair({
      checksum: "expected",
      statement,
      probe: { hasLiveRooms: true, hasColumn: false, ledgerChecksum: "expected" },
    })).toEqual({ kind: "repair", statement })
    expect(planAudienceGateRepair({
      checksum: "expected",
      statement,
      probe: { hasLiveRooms: true, hasColumn: true, ledgerChecksum: "expected" },
    })).toEqual({ kind: "converged" })
  })

  test("refuses absent tables, absent ledger rows, and checksum drift", () => {
    const plan = (hasLiveRooms: boolean, ledgerChecksum: string) => planAudienceGateRepair({
      checksum: "expected",
      statement,
      probe: { hasLiveRooms, hasColumn: false, ledgerChecksum },
    })
    expect(plan(false, "expected").kind).toBe("refuse")
    expect(plan(true, "").kind).toBe("refuse")
    expect(plan(true, "different").kind).toBe("refuse")
  })
})
