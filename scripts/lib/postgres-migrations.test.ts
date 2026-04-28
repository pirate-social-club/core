import { describe, expect, test } from "bun:test";
import {
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
      migrationName: "0050_control_plane_verification_requirements.sql",
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
      migrationName: "0051_control_plane_notifications.sql",
      existingMigrationNames: ["0000_control_plane_baseline_postgres.sql"],
    })).toBeNull();
  });

  test("uses exact migration filenames only", () => {
    expect(candidateMigrationNames("0018_control_plane_registry_table_refs.sql")).toEqual([
      "0018_control_plane_registry_table_refs.sql",
    ]);
  });
});
