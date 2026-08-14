import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const migration = readFileSync(
  "db/control-plane/migrations/0231_control_plane_reward_campaign_asset_descriptor.sql",
  "utf8",
);

describe("reward campaign asset descriptor control-plane migration", () => {
  test("descriptor columns are all-or-nothing and shaped like the funding-edge conventions", () => {
    expect(migration).toContain("asset_token_address ~ '^0x[0-9a-f]{40}$'");
    expect(migration).toContain("asset_token_decimals >= 0 AND asset_token_decimals <= 36");
    expect(migration).toContain(
      "(asset_chain_id IS NULL) = (asset_token_address IS NULL)",
    );
    expect(migration).toContain(
      "(asset_chain_id IS NULL) = (asset_token_decimals IS NULL)",
    );
    expect(migration).toContain(
      "(asset_chain_id IS NULL) = (asset_token_symbol IS NULL)",
    );
  });

  test("descriptor is set-once: NULL may be backfilled, a populated value is frozen", () => {
    expect(migration).toContain(
      "OLD.asset_chain_id IS NOT NULL",
    );
    expect(migration).toContain(
      "NEW.asset_token_address IS DISTINCT FROM OLD.asset_token_address",
    );
    expect(migration).not.toContain(
      "OR NEW.asset_chain_id IS DISTINCT FROM OLD.asset_chain_id\n",
    );
  });

  test("trigger replacement preserves the 0191/0192 reanchor and top-up carve-outs", () => {
    expect(migration).toContain("valid_activation_reanchor");
    expect(migration).toContain("valid_confirmed_topup_growth");
    expect(migration).toContain("NEW.budget_cents = GREATEST(OLD.budget_cents, NEW.funded_cents)");
    expect(migration).toContain("reward campaign terms are immutable");
  });
});
