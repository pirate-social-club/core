import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { postgresMigrationStatements } from "../lib/postgres-migrations"

const migration = readFileSync(
  "db/control-plane/migrations/0226_control_plane_generic_story_asset_kinds.sql",
  "utf8",
)

describe("generic Story asset kinds control-plane migration", () => {
  test("replaces the generated asset-kind check with the complete explicit registry", () => {
    const statements = postgresMigrationStatements(migration)

    expect(statements).toHaveLength(2)
    expect(statements[0]).toContain(
      "DROP CONSTRAINT story_registered_asset_projections_asset_kind_check",
    )
    expect(statements[1]).toContain(
      "ADD CONSTRAINT story_registered_asset_projections_asset_kind_check",
    )
    for (const kind of ["song_audio", "video_file", "download_file", "learning_deck"]) {
      expect(statements[1]).toContain(`'${kind}'`)
    }
    expect(statements[1]).not.toMatch(/ELSE|otherwise/i)
  })
})
