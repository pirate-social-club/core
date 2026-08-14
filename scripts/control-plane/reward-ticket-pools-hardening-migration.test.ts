import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const migrationPath =
  "db/control-plane/migrations/0232_control_plane_reward_ticket_pool_hardening.sql";
const migration = readFileSync(migrationPath, "utf8");

describe("reward ticket pool hardening migration", () => {
  test("binds published commitments and quarantines protocol drawing mismatches", () => {
    expect(migration).toContain("reward_ticket_commitment_batches_published_evidence_check");
    expect(migration).toContain("reward_ticket_pool_drawings_commitment_identity_fk");
    expect(migration).toContain("protocol_drawing_id NUMERIC(78, 0)");
    expect(migration).toContain("reward_ticket_inventory_drawing_mismatch");
    expect(migration).toContain("mismatched protocol drawing inventory must remain in needs_review");
    expect(migration).not.toContain("reward_ticket_inventory_expected_drawing_fk");
    expect(migration).toContain("ALTER COLUMN canonical_position SET NOT NULL");
  });

  test("models finalized cashout effects and derives balance projections from the ledger", () => {
    expect(migration).toContain("CREATE TABLE reward_ticket_custody_backing_domains");
    expect(migration).toContain("single_custody_per_asset_v1");
    expect(migration).toContain("SELECT DISTINCT ON (chain_id, usdc_token_address)");
    expect(migration).toContain("reward_ticket_pools_custody_backing_domain_fk");
    expect(migration).toContain("reward_ticket_custody_solvency_backing_domain_fk");
    expect(migration).toContain("CREATE TABLE reward_ticket_cashout_effects");
    expect(migration).toContain("finalized_at TIMESTAMPTZ");
    expect(migration).toContain("CREATE TRIGGER reward_ticket_usdc_ledger_apply");
    expect(migration).toContain("cashout payment requires a finalized confirmed effect");
    expect(migration).toContain("pool.usdc_token_address = NEW.token_address");
    expect(migration).toContain("REVOKE INSERT, UPDATE, DELETE ON TABLE reward_ticket_usdc_balances");
    expect(migration).toContain("CREATE TABLE reward_ticket_platform_revenue_ledger_entries");
    expect(migration).toContain("platform referral revenue address must be outside beneficiary custody");
    expect(migration).toContain("reward_ticket_platform_revenue_ledger_entries_immutable");
  });

  test("requires complete sweep claim and deterministic equal allocation before credit", () => {
    expect(migration).toContain("inventory_complete_at TIMESTAMPTZ");
    expect(migration).toContain("sweep_complete_at TIMESTAMPTZ");
    expect(migration).toContain("allocation proceeds do not equal finalized claim receipts");
    expect(migration).toContain("allocation rows violate deterministic equal_v1 rounding");
    expect(migration).toContain("credited drawing requires a credited allocation batch");
    expect(migration).toContain("credited reward ticket allocation batches are immutable");
    expect(migration).toContain("DEFERRABLE INITIALLY DEFERRED");
    expect(migration).toContain("CHECK (amount_atomic >= 0)");
  });

  test("makes financial evidence append-only and removes runtime delete authority", () => {
    expect(migration).toContain("reward_ticket_usdc_ledger_entries_immutable");
    expect(migration).toContain("reward_ticket_custody_solvency_observations_immutable");
    expect(migration).toContain("published reward ticket commitment evidence is immutable");
    expect(migration).toContain("REVOKE DELETE ON TABLE");
    expect(migration).toContain("FROM control_plane_api_rw");
    expect(migration).toContain("reward_ticket_purchase_effects_transition");
    expect(migration).toContain("reward_ticket_claim_effects_transition");
    expect(migration).toContain("finalized reward ticket claim receipt is immutable");
  });
});
