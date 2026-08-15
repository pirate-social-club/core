import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"

const migration = readFileSync(
  "db/control-plane/migrations/0236_control_plane_reward_settlement_asset_registry.sql",
  "utf8",
)

describe("reward settlement asset registry migration", () => {
  test("asset admission is registry data, separate from execution rails", () => {
    expect(migration).toContain("CREATE TABLE reward_settlement_assets")
    expect(migration).toContain("CREATE TABLE reward_settlement_rails")
    expect(migration).toContain("PRIMARY KEY (chain_id, token_address)")
    expect(migration).toContain(
      "REFERENCES reward_settlement_assets (chain_id, token_address)",
    )
  })

  test("phase-one admission policy is frozen in schema", () => {
    expect(migration).toContain("denomination_policy = 'usd_par'")
    expect(migration).toContain("decimals >= 2 AND decimals <= 36")
    expect(migration).toContain("token_address ~ '^0x[0-9a-f]{40}$'")
    expect(migration).toContain("authorization_reference")
  })

  test("lifecycle transitions are constrained and retirement is terminal", () => {
    expect(migration).toContain("'admitted', 'suspended', 'retired'")
    expect(migration).toContain("retired reward settlement asset is frozen")
    expect(migration).toContain("invalid reward settlement asset lifecycle transition")
    expect(migration).toContain("reward_settlement_assets_retired_shape_check")
    expect(migration).toContain("quote_cutoff_at IS NOT NULL")
  })

  test("lifecycle timestamps are transition evidence, never free-form", () => {
    expect(migration).toContain(
      "reward settlement asset lifecycle evidence changes only with a status transition",
    )
    expect(migration).toContain("suspension evidence is preserved through retirement")
    // Quote cutoff exists only on retired rows: both non-retired shapes pin it NULL.
    expect(
      migration.match(/retired_at IS NULL AND quote_cutoff_at IS NULL/g)?.length,
    ).toBe(2)
  })

  test("current-state scope is declared with the event-ledger precondition", () => {
    expect(migration).toContain("CURRENT STATE, not an audit log")
    expect(migration).toContain("append-only lifecycle")
    expect(migration).toContain("Before any runtime mutation is granted")
  })

  test("registry rows can be retired but never deleted or re-identified", () => {
    expect(migration).toContain("reward settlement asset identity is immutable")
    expect(migration).toContain("reward settlement rail binding is immutable")
    expect(migration).toContain(
      "reward settlement registry rows are append-only; retire instead of deleting",
    )
  })

  test("one active rail per environment and asset", () => {
    expect(migration).toContain("reward_settlement_rails_active_binding_idx")
    expect(migration).toContain("WHERE status = 'active'")
    expect(migration).toContain("reward_settlement_rails_vault_shape_check")
  })

  test("seeds only the two canonical USDC identities, both usd_par", () => {
    expect(migration).toContain("8453, '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', 6, 'USDC', 'usd_par'")
    expect(migration).toContain("84532, '0x036cbd53842c5426634e7929541ec2318f3dcf7e', 6, 'USDC', 'usd_par'")
    expect(migration.match(/'admitted', NOW\(\), 'migration:0236'/g)?.length).toBe(2)
    expect(migration).not.toContain("INSERT INTO reward_settlement_rails")
  })

  test("the API can read the registry but cannot mutate it", () => {
    expect(migration).toContain("GRANT SELECT ON TABLE")
    expect(migration).toContain("REVOKE INSERT, UPDATE, DELETE ON TABLE")
  })
})
