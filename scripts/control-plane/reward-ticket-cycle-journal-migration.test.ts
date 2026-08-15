import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"

const migration = readFileSync(
  "db/control-plane/migrations/0235_control_plane_reward_ticket_cycle_journal.sql",
  "utf8",
)

describe("reward ticket cycle journal migration", () => {
  test("persists an exact signed transaction before broadcast", () => {
    expect(migration).toContain("CREATE TABLE reward_ticket_evm_submissions")
    expect(migration).toContain("signed_transaction TEXT NOT NULL")
    expect(migration).toContain("UNIQUE (chain_id, signer_address, nonce)")
    expect(migration).toContain("UNIQUE (chain_id, transaction_hash)")
    expect(migration).toContain("prepared reward ticket transaction identity is immutable")
  })

  test("supports leased unattended cycles and explicit recovery", () => {
    expect(migration).toContain("CREATE TABLE reward_ticket_automation_cycles")
    expect(migration).toContain("schedule_key TEXT NOT NULL UNIQUE")
    expect(migration).toContain("'recovery_required'")
    expect(migration).toContain("reward_ticket_automation_cycles_lease_shape_check")
  })

  test("records append-only cycle and drill evidence", () => {
    expect(migration).toContain("CREATE TABLE reward_ticket_automation_evidence")
    expect(migration).toContain("'crash_restart_drill'")
    expect(migration).toContain("'pause_drill'")
    expect(migration).toContain("reward ticket automation evidence is append-only")
    expect(migration).toContain("GRANT SELECT, INSERT ON TABLE reward_ticket_automation_evidence")
  })

  test("is pinned to Base Sepolia", () => {
    expect(migration.match(/chain_id = 84532/g)?.length).toBe(2)
  })
})
