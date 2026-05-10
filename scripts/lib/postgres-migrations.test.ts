import { describe, expect, test } from "bun:test";
import { migrationChecksumMatches } from "./postgres-migrations";

describe("applyPostgresMigrations", () => {
  test("accepts baseline checksum drift on already bootstrapped control-plane databases", () => {
    expect(migrationChecksumMatches({
      migrationName: "0000_control_plane_baseline_postgres.sql",
      existingChecksum: "current",
      currentChecksum: "current",
    })).toBe(true);

    expect(migrationChecksumMatches({
      migrationName: "0000_control_plane_baseline_postgres.sql",
      existingChecksum: "stale",
      currentChecksum: "current",
    })).toBe(true);
  });

  test("rejects checksum drift for regular applied migrations", () => {
    expect(migrationChecksumMatches({
      migrationName: "0085_control_plane_public_pirate_names.sql",
      existingChecksum: "current",
      currentChecksum: "current",
    })).toBe(true);

    expect(migrationChecksumMatches({
      migrationName: "0085_control_plane_public_pirate_names.sql",
      existingChecksum: "stale",
      currentChecksum: "current",
    })).toBe(false);
  });
});
