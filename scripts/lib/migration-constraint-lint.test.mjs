import { describe, expect, test } from "bun:test";
import { findAnonymousTableChecks, findExistingTableCheckSafetyGaps } from "./migration-constraint-lint.mjs";

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

describe("findExistingTableCheckSafetyGaps", () => {
  test("requires a data decision before constraining an existing table", () => {
    expect(findExistingTableCheckSafetyGaps(`
      ALTER TABLE reward_nationality_decisions ADD COLUMN resolved_amount_cents INTEGER;
      ALTER TABLE reward_nationality_decisions
        ADD CONSTRAINT reward_nationality_decisions_amount_shape_check CHECK (resolved_amount_cents IS NOT NULL);
    `)).toEqual([{
      line: 3,
      table: "reward_nationality_decisions",
      constraint: "reward_nationality_decisions_amount_shape_check",
    }]);
  });

  test("accepts the repaired migration shape after an existing-row backfill", () => {
    expect(findExistingTableCheckSafetyGaps(`
      ALTER TABLE reward_nationality_decisions ADD COLUMN resolved_amount_cents INTEGER;
      UPDATE reward_nationality_decisions SET resolved_amount_cents = 100 WHERE retryability = 'resolved';
      ALTER TABLE reward_nationality_decisions
        ADD CONSTRAINT reward_nationality_decisions_amount_shape_check CHECK (resolved_amount_cents IS NOT NULL);
    `)).toEqual([]);
  });

  test("does not require a backfill for a table created in the same migration", () => {
    expect(findExistingTableCheckSafetyGaps(`
      CREATE TABLE reward_snapshots (amount_cents INTEGER);
      ALTER TABLE reward_snapshots
        ADD CONSTRAINT reward_snapshots_amount_check CHECK (amount_cents > 0);
    `)).toEqual([]);
  });

  test("allows a nullable new column when the check explicitly accepts its legacy NULL state", () => {
    expect(findExistingTableCheckSafetyGaps(`
      ALTER TABLE reward_pending_qualifications ADD COLUMN exposure_amount_cents INTEGER;
      ALTER TABLE reward_pending_qualifications
        ADD CONSTRAINT reward_pending_qualifications_exposure_check CHECK (
          exposure_amount_cents IS NULL OR exposure_amount_cents > 0
        );
    `)).toEqual([]);
  });

  test("allows an explicit reviewer-owned safety annotation", () => {
    expect(findExistingTableCheckSafetyGaps(`
      -- migration-safety: existing-table-check-reviewed: existing rows are known valid from the prior invariant
      ALTER TABLE reward_campaigns
        ADD CONSTRAINT reward_campaigns_amount_check CHECK (default_amount_cents > 0);
    `)).toEqual([]);
  });
});
