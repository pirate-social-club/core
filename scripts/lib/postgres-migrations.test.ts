import { describe, expect, test } from "bun:test";
import { migrationChecksumMatches } from "./postgres-migrations";

describe("applyPostgresMigrations", () => {
  test("accepts only the current checksum for applied migrations", () => {
    expect(migrationChecksumMatches({
      migrationName: "0000_control_plane_baseline_postgres.sql",
      existingChecksum: "current",
      currentChecksum: "current",
    })).toBe(true);

    expect(migrationChecksumMatches({
      migrationName: "0000_control_plane_baseline_postgres.sql",
      existingChecksum: "stale",
      currentChecksum: "current",
    })).toBe(false);
  });
});
