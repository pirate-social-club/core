import { describe, expect, test } from "bun:test"
import { TypeGenerator } from "./_typegen"

describe("TypeGenerator", () => {
  test("emits named self-references for recursive schemas", () => {
    const sourceSchemas = {
      Tree: {
        oneOf: [
          { type: "string" },
          {
            type: "array",
            items: { $ref: "#/components/schemas/Tree" },
          },
        ],
      },
    }
    const exports = [{ name: "Tree", ref: "#/components/schemas/Tree" }] as const

    const output = new TypeGenerator(
      { components: { schemas: sourceSchemas } },
      sourceSchemas,
      exports,
    ).generate(exports)

    expect(output).toContain("export type Tree = (string | Array<Tree>);")
  })
})
