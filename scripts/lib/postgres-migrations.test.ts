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

  test("skips migrations represented by the current baseline snapshot", () => {
    expect(supersessionSkipReason({
      migrationName: "0046_control_plane_verification_requirements.sql",
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
      migrationName: "0047_control_plane_notifications.sql",
      existingMigrationNames: ["0000_control_plane_baseline_postgres.sql"],
    })).toBeNull();
  });

  test("resolves known historical migration renames", () => {
    expect(candidateMigrationNames("0018_control_plane_device_sessions.sql")).toEqual([
      "0018_control_plane_device_sessions.sql",
      "0016_control_plane_device_sessions.sql",
    ]);

    expect(candidateMigrationNames("0017a_control_plane_registry_table_refs.sql")).toEqual([
      "0017a_control_plane_registry_table_refs.sql",
      "0017_control_plane_registry_table_refs.sql",
    ]);
  });

  test("accepts explicitly allowed historical checksums", () => {
    expect(acceptsHistoricalChecksum({
      migrationName: "0000_control_plane_baseline_postgres.sql",
      existingChecksum: "8b61a91a715ddb8ea6e63c6caed3deb8265d7b1e1bfc80bdcba335f43e450364",
      currentChecksum: "bfbd53fd10a3e4f57569cade0ae36fffa7b7a8e49bb82dd97d77ed58cb4e750e",
    })).toBe(true);

    expect(acceptsHistoricalChecksum({
      migrationName: "0002_control_plane_communities.sql",
      existingChecksum: "8eb1ffcbe1e3259383015ff449f1f3ba8186ecafcc694a9241614bd4af2779ba",
      currentChecksum: "5f71ad5eee9c046d05253f535cbe106ac2b7a29d203bd8a6afdcbf0ab19d9121",
    })).toBe(true);
  });
});
