import { describe, expect, test } from "bun:test"
import { parseD1InfoOutput, selectLargestShard } from "./select-largest-production-community-shard"

describe("largest production community shard selection", () => {
  test("parses JSON after Wrangler warnings", () => {
    expect(parseD1InfoOutput(`warning text\n{"uuid":"db-1","name":"shard-1","database_size":42,"num_tables":7}`))
      .toEqual({ uuid: "db-1", name: "shard-1", database_size: 42, num_tables: 7 })
  })

  test("selects database size with a deterministic binding tie break", () => {
    const info = (name: string, database_size: number) => ({ uuid: name, name, database_size, num_tables: 1 })
    expect(selectLargestShard([
      { binding: "DB_CMTY_0002", info: info("two", 100) },
      { binding: "DB_CMTY_0001", info: info("one", 100) },
      { binding: "DB_CMTY_0003", info: info("three", 99) },
    ]).binding).toBe("DB_CMTY_0001")
  })

  test("refuses an empty fleet", () => {
    expect(() => selectLargestShard([])).toThrow("no allocated+loaded")
  })
})
