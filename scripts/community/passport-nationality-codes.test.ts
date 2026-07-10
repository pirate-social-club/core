import { describe, expect, test } from "bun:test"

import {
  assertPassportNationalityGateSupported,
  assessPassportNationalityGate,
  canonicalPassportNationalityAlias,
} from "./passport-nationality-codes"

describe("passport nationality gate codes", () => {
  test.each(["KS", "RKS", "XKX", "XKK", " rks "]) (
    "maps Kosovo document alias %s to the existing policy value",
    (value) => {
      expect(canonicalPassportNationalityAlias(value)).toBe("XKK")
    },
  )

  test("rejects the confirmed unsupported Antarctica nationality gate", () => {
    expect(assessPassportNationalityGate("ATA").status).toBe("unsupported")
    expect(() => assertPassportNationalityGateSupported("ATA")).toThrow(
      "no state issues Antarctic nationality documents",
    )
  })

  test("pauses dependent-territory gates until document evidence is recorded", () => {
    expect(assessPassportNationalityGate("MAF").status).toBe("needs_evidence")
    expect(() => assertPassportNationalityGateSupported("MAF")).toThrow(
      "has not been verified as a passport nationality disclosure value",
    )
  })

  test("rejects territory codes confirmed not to be passport nationalities", () => {
    expect(assessPassportNationalityGate("GIB").status).toBe("unsupported")
    expect(() => assertPassportNationalityGateSupported("GIB")).toThrow(
      "does not issue a nationality document using this local ISO territory code",
    )
  })

  test("allows ordinary sovereign nationality codes", () => {
    expect(assessPassportNationalityGate("HRV")).toEqual({ status: "supported" })
    expect(() => assertPassportNationalityGateSupported("HRV")).not.toThrow()
  })
})
