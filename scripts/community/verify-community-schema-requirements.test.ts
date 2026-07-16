import { describe, expect, test } from "bun:test"

import { validateRequirements } from "./verify-community-schema-requirements"

const base = {
  version: 1,
  unconditional: ["1133_multi_namespace_bindings.sql"],
  features: {},
  deferred: {},
}

describe("schema requirements policy validation", () => {
  test("accepts known, disjoint policy classes", () => {
    expect(validateRequirements(base).unconditional).toEqual(base.unconditional)
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
})
