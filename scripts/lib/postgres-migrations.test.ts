import { describe, expect, test } from "bun:test";
import {
  acceptsHistoricalChecksum,
  candidateMigrationNames,
  supersessionSkipReason,
} from "./postgres-migrations";

describe("applyPostgresMigrations", () => {
  test("skips legacy migrations when the baseline is already applied", () => {
    expect(supersessionSkipReason({
      migrationName: "0001_control_plane_identity.sql",
      existingMigrationNames: ["0000_control_plane_baseline_postgres.sql"],
    })).toBe("superseded by 0000_control_plane_baseline_postgres.sql");
  });

  test("skips the baseline when a superseded legacy migration is already recorded", () => {
    expect(supersessionSkipReason({
      migrationName: "0000_control_plane_baseline_postgres.sql",
      existingMigrationNames: ["0001_control_plane_identity.sql"],
    })).toBe("current schema already represented by 0001_control_plane_identity.sql");
  });

  test("does not skip unrelated future migrations", () => {
    expect(supersessionSkipReason({
      migrationName: "0034_future.sql",
      existingMigrationNames: ["0000_control_plane_baseline_postgres.sql"],
    })).toBeNull();
  });

  test("resolves known historical migration renames", () => {
    expect(candidateMigrationNames("0018_control_plane_device_sessions.sql")).toEqual([
      "0018_control_plane_device_sessions.sql",
      "0016_control_plane_device_sessions.sql",
    ]);
  });

  test("accepts explicitly allowed historical checksums", () => {
    expect(acceptsHistoricalChecksum({
      migrationName: "0002_control_plane_communities.sql",
      existingChecksum: "8eb1ffcbe1e3259383015ff449f1f3ba8186ecafcc694a9241614bd4af2779ba",
      currentChecksum: "5f71ad5eee9c046d05253f535cbe106ac2b7a29d203bd8a6afdcbf0ab19d9121",
    })).toBe(true);
  });
});
