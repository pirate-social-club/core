import { describe, expect, test } from "bun:test"

import { checkDuplicatePrefixes } from "./check-migration-integrity.mjs"

const communityRoot = {
  path: "db/community-template/migrations",
  label: "community-template",
  prefixPattern: /^(\d{4})_/u,
}

describe("migration duplicate-prefix integrity", () => {
  test("fails a duplicate merely because it is already historical", () => {
    const result = checkDuplicatePrefixes(communityRoot, [
      "db/community-template/migrations/1099_first.sql",
      "db/community-template/migrations/1099_second.sql",
    ])

    expect(result.warnings).toEqual([])
    expect(result.failures).toEqual([
      "community-template: duplicate migration prefix 1099: db/community-template/migrations/1099_first.sql, db/community-template/migrations/1099_second.sql",
    ])
  })

  test("allows only the exact reviewed historical sibling set", () => {
    const exact = [
      "db/community-template/migrations/1123_karaoke_attempts.sql",
      "db/community-template/migrations/1123_song_engagement_activity_timezone.sql",
    ]
    expect(checkDuplicatePrefixes(communityRoot, exact)).toEqual({
      failures: [],
      warnings: [
        `community-template: explicitly allowed historical duplicate prefix 1123: ${exact.join(", ")}`,
      ],
    })

    expect(checkDuplicatePrefixes(communityRoot, [...exact, "db/community-template/migrations/1123_third.sql"]).failures)
      .toHaveLength(1)
  })
})
