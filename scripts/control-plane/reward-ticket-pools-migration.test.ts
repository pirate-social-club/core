import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { postgresMigrationStatements } from "../lib/postgres-migrations";

const migrationPath = "db/control-plane/migrations/0224_control_plane_reward_ticket_pools.sql";
const migration = readFileSync(migrationPath, "utf8");

describe("reward ticket pools control-plane migration", () => {
  test("keeps ticket pools parallel to cash campaigns", () => {
    expect(migration).toContain("CREATE TABLE reward_ticket_pools");
    expect(migration).toContain("reward_ticket_pools_one_non_terminal_per_song");
    expect(migration).toContain("WHERE status NOT IN ('ended', 'canceled')");
    expect(migration).not.toContain("ALTER TABLE reward_campaigns");
    expect(migration).not.toContain("ALTER TABLE reward_song_pools");
  });

  test("hashes immutable economic terms and conserves purchase budget", () => {
    expect(migration).toContain("tickets_per_drawing INTEGER NOT NULL");
    expect(migration).toContain("max_ticket_cents INTEGER NOT NULL");
    expect(migration).toContain("terms_hash TEXT NOT NULL");
    expect(migration).toContain("reserved_cents + fulfilled_cents + refunded_cents <= funded_cents");
    expect(migration).toContain("actual_cost_atomic NUMERIC(78, 0)");
  });

  test("freezes one verified beneficiary position per song drawing", () => {
    expect(migration).toContain("CREATE TABLE reward_ticket_pool_beneficiaries");
    expect(migration).toContain("PRIMARY KEY (reward_ticket_pool_drawing_id, reward_identity_id)");
    expect(migration).toContain("UNIQUE (reward_ticket_pool_drawing_id, canonical_position)");
    expect(migration).toContain("reward_ticket_beneficiary_commitment_batches");
    expect(migration).toContain("commitment_inclusion_proof_json JSONB");
    expect(migration).toContain("reward_ticket_pool_drawings_frozen_snapshot_check");
    expect(migration).toContain("reward_ticket_pool_drawings_published_commitment_check");
  });

  test("requires zero-entry drawings to spend nothing", () => {
    expect(migration).toContain("reward_ticket_pool_drawings_zero_entry_check");
    expect(migration).toContain("beneficiary_count = 0 AND reserved_cents = 0");
    expect(migration).toContain("actual_cost_atomic IS NULL");
  });

  test("models retry-safe purchases claims and custody inventory", () => {
    expect(migration).toContain("CREATE TABLE reward_ticket_purchase_effects");
    expect(migration).toContain("'reservation_expired', 'needs_review'");
    expect(migration).toContain("review_deadline_at TIMESTAMPTZ");
    expect(migration).toContain("CREATE TABLE reward_ticket_inventory");
    expect(migration).toContain("UNIQUE (chain_id, ticket_nft_address, ticket_id)");
    expect(migration).toContain("CREATE TABLE reward_ticket_claim_effects");
    expect(migration).toContain("protocol_reported_winnings_atomic NUMERIC(78, 0)");
    expect(migration).toContain("received_amount_atomic NUMERIC(78, 0)");
    expect(migration).toContain("UNIQUE (reward_ticket_inventory_id)");
  });

  test("preserves exact atomic-USDC allocation and deterministic remainder evidence", () => {
    expect(migration).toContain("CREATE TABLE reward_ticket_allocation_batches");
    expect(migration).toContain("CREATE TABLE reward_ticket_allocation_batch_claims");
    expect(migration).toContain("UNIQUE (reward_ticket_pool_drawing_id)");
    expect(migration).toContain("proceeds_atomic NUMERIC(78, 0)");
    expect(migration).toContain("allocated_atomic = proceeds_atomic");
    expect(migration).toContain("amount_atomic NUMERIC(78, 0)");
    expect(migration).toContain("received_remainder_unit BOOLEAN NOT NULL");
    expect(migration).toContain("CREATE TABLE reward_ticket_usdc_balances");
    expect(migration).toContain("cashout_reserved_atomic + paid_atomic <= credited_atomic");
  });

  test("ships freshness and custody-solvency monitoring from day one", () => {
    expect(migration).toContain("CREATE TABLE reward_ticket_custody_solvency_observations");
    expect(migration).toContain("custody_balance_atomic >= outstanding_liability_atomic");
    expect(migration).toContain("'price_quote_freshness', 'purchase_reconciliation', 'drawing_sweep_freshness'");
    expect(migration).toContain("'claim_reconciliation', 'custody_solvency'");
    expect(migration).toContain("CREATE TABLE reward_ticket_pool_incidents");
  });

  test("revokes public access and grants only control-plane roles", () => {
    const statements = postgresMigrationStatements(migration);
    expect(statements.some((statement) =>
      statement.includes("REVOKE ALL ON TABLE") && statement.includes("FROM PUBLIC;")
    )).toBe(true);
    expect(statements.some((statement) =>
      statement.includes("SELECT, INSERT, UPDATE, DELETE")
      && statement.includes("TO control_plane_api_rw;")
    )).toBe(true);
    expect(statements.some((statement) =>
      statement.includes("GRANT SELECT")
      && statement.includes("TO control_plane_api_ro, control_plane_ops_ro;")
    )).toBe(true);
  });
});
