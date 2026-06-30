import { describe, expect, test } from "bun:test";
import { sanitizePostgresUrlForBunSql } from "./postgres-url";

describe("sanitizePostgresUrlForBunSql", () => {
  test("removes libpq TLS file parameters that Bun SQL forwards as server settings", () => {
    const sanitized = sanitizePostgresUrlForBunSql(
      "postgres://user:pass@example.test/db?sslmode=require&sslrootcert=/tmp/ca.pem&sslcert=/tmp/client.pem&application_name=ops",
    );

    expect(sanitized).toBe("postgres://user:pass@example.test/db?sslmode=require&application_name=ops");
  });

  test("leaves non-postgres URLs unchanged", () => {
    expect(sanitizePostgresUrlForBunSql("file:./local.db?sslrootcert=/tmp/ca.pem")).toBe(
      "file:./local.db?sslrootcert=/tmp/ca.pem",
    );
  });
});
