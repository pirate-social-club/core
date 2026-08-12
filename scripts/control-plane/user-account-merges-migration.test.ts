import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const migration = readFileSync(
  "db/control-plane/migrations/0200_control_plane_user_account_merges.sql",
  "utf8",
);

describe("user account merges control-plane migration", () => {
  test("assigns distinct names to the block-reason value and state constraints", () => {
    expect(migration).toContain(
      "CONSTRAINT user_account_merges_block_reason_value_check CHECK",
    );
    expect(migration).toContain(
      "CONSTRAINT user_account_merges_blocked_state_check",
    );

    const constraintNames = [
      ...migration.matchAll(/\bCONSTRAINT\s+([a-z0-9_]+)/giu),
    ].map((match) => match[1]);
    expect(new Set(constraintNames).size).toBe(constraintNames.length);
  });
});
