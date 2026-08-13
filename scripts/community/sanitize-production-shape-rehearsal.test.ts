import { describe, expect, test } from "bun:test"
import { parseSanitizationRules } from "./sanitize-production-shape-rehearsal"

describe("sanitize production-shape rehearsal CLI", () => {
  test("does not permit unresolved manifest modes", () => {
    expect(() => parseSanitizationRules({
      columns: [{ table: "posts", column: "body", mode: "unresolved" }],
    })).toThrow("posts.body unresolved")
  })

  test("accepts only the explicit sanitizer modes", () => {
    expect(parseSanitizationRules({ columns: [
      { table: "schema_migrations", column: "checksum", mode: "preserve" },
      { table: "posts", column: "post_id", mode: "stable_text" },
      { table: "posts", column: "body", mode: "mask_text" },
      { table: "posts", column: "payload", mode: "stable_blob" },
    ]})).toHaveLength(4)
  })
})
