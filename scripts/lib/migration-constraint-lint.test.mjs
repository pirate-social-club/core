import { describe, expect, test } from "bun:test";
import { findAnonymousTableChecks } from "./migration-constraint-lint.mjs";

describe("findAnonymousTableChecks", () => {
  test("rejects anonymous table-level checks but permits inline column checks", () => {
    const sql = `CREATE TABLE funding_effects (
      amount INTEGER NOT NULL CHECK (amount >= 0),
      status TEXT,
      CHECK (status IS NULL OR amount > 0)
    );`;
    expect(findAnonymousTableChecks(sql)).toEqual([{ line: 4, kind: "create_table" }]);
  });

  test("accepts named table-level checks", () => {
    const sql = `CREATE TABLE funding_effects (
      amount INTEGER,
      CONSTRAINT funding_effects_amount_positive CHECK (amount >= 0)
    );`;
    expect(findAnonymousTableChecks(sql)).toEqual([]);
  });

  test("ignores check-like text in comments and literals", () => {
    const sql = `CREATE TABLE notes (
      body TEXT DEFAULT ', CHECK (bad)',
      -- CHECK (also_bad)
      value INTEGER
    );`;
    expect(findAnonymousTableChecks(sql)).toEqual([]);
  });

  test("rejects ALTER TABLE ADD CHECK but permits ADD COLUMN inline checks", () => {
    expect(findAnonymousTableChecks("ALTER TABLE effects ADD CHECK (amount >= 0);")).toEqual([
      { line: 1, kind: "alter_table" },
    ]);
    expect(findAnonymousTableChecks("ALTER TABLE effects ADD COLUMN amount INTEGER CHECK (amount >= 0);")).toEqual([]);
  });
});
