import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { migrationChecksumMatches, postgresMigrationStatements } from "./postgres-migrations";

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

  test("splits multi-statement Postgres migrations so grants cannot be skipped", () => {
    const statements = postgresMigrationStatements(`
      -- Leading comments stay attached to the first real statement.
      CREATE TABLE operator_credentials (
        operator_credential_id TEXT PRIMARY KEY,
        last_used_at TIMESTAMPTZ
      );

      REVOKE ALL ON TABLE operator_credentials FROM control_plane_api_rw;
      GRANT SELECT ON TABLE operator_credentials TO control_plane_api_rw;
      GRANT UPDATE (last_used_at) ON TABLE operator_credentials TO control_plane_api_rw;
    `);

    expect(statements).toHaveLength(4);
    expect(statements[0]).toContain("CREATE TABLE operator_credentials");
    expect(statements[1]).toBe("REVOKE ALL ON TABLE operator_credentials FROM control_plane_api_rw;");
    expect(statements[2]).toBe("GRANT SELECT ON TABLE operator_credentials TO control_plane_api_rw;");
    expect(statements[3]).toBe("GRANT UPDATE (last_used_at) ON TABLE operator_credentials TO control_plane_api_rw;");
  });

  test("ignores semicolons inside comments while splitting migrations", () => {
    const statements = postgresMigrationStatements(`
      -- A comment with a semicolon; it must not split.
      CREATE TABLE demo_one (id TEXT PRIMARY KEY);
      /* Block comments can also include semicolons; keep scanning. */
      CREATE TABLE demo_two (id TEXT PRIMARY KEY);
      -- trailing comment only;
    `);

    expect(statements).toHaveLength(2);
    expect(statements[0]).toContain("CREATE TABLE demo_one");
    expect(statements[1]).toContain("CREATE TABLE demo_two");
  });

  test("0123 operator credential migration includes executable privilege statements", () => {
    const migration = readFileSync("db/control-plane/migrations/0123_control_plane_operator_credentials.sql", "utf8");
    const statements = postgresMigrationStatements(migration);

    expect(statements.some((statement) => statement.includes("CREATE TABLE operator_credentials"))).toBe(true);
    expect(statements).toContain("REVOKE ALL ON TABLE operator_credentials FROM control_plane_api_rw;");
    expect(statements).toContain("GRANT SELECT ON TABLE operator_credentials TO control_plane_api_rw;");
    expect(statements).toContain("GRANT UPDATE (last_used_at) ON TABLE operator_credentials TO control_plane_api_rw;");
    expect(statements).toContain("GRANT SELECT ON TABLE operator_credentials TO control_plane_api_ro;");
    expect(statements).toContain("GRANT SELECT ON TABLE operator_credentials TO control_plane_ops_ro;");
  });

  test("b0001 bookings migration comments do not create stray statements", () => {
    const migration = readFileSync("db/bookings/migrations/b0001_bookings_global_schema.sql", "utf8");
    const statements = postgresMigrationStatements(migration);

    expect(statements.some((statement) => statement.trimStart().startsWith("a separate ledger"))).toBe(false);
    expect(statements.some((statement) => statement.trimStart().startsWith("no community)"))).toBe(false);
    expect(statements.some((statement) => statement.trimStart().startsWith("runtime rw reads+writes"))).toBe(false);
    expect(statements.some((statement) => statement.includes("CREATE TABLE bookings.profiles"))).toBe(true);
    expect(statements).toContain("GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA bookings TO control_plane_api_rw;");
  });
});
