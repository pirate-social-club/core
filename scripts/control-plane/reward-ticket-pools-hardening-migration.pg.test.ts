import { SQL } from "bun";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { postgresMigrationStatements } from "../lib/postgres-migrations";

const ADMIN_URL =
  process.env.CONTROL_PLANE_MIGRATION_TEST_ADMIN_URL ??
  process.env.BOOKINGS_MIGRATION_TEST_ADMIN_URL;
const RUN = Boolean(ADMIN_URL);
const TEST_DB = "reward_ticket_pool_hardening_test";
const RW_PASSWORD = "test-reward-ticket-rw";

function urlFor(options: { db?: string; user?: string; password?: string }): string {
  const url = new URL(ADMIN_URL as string);
  if (options.user !== undefined) url.username = options.user;
  if (options.password !== undefined) url.password = options.password;
  if (options.db !== undefined) url.pathname = `/${options.db}`;
  if (!url.searchParams.get("sslmode")) url.searchParams.set("sslmode", "disable");
  return url.toString();
}

function connect(options: { db?: string; user?: string; password?: string }): SQL {
  return new SQL({
    url: urlFor(options),
    tls: false,
    max: 1,
    connectionTimeout: 5,
  } as Record<string, unknown>);
}

async function applyMigration(sql: SQL, path: string): Promise<void> {
  for (const statement of postgresMigrationStatements(readFileSync(path, "utf8"))) {
    await sql.unsafe(statement);
  }
}

async function expectSqlState(sql: SQL, statement: string, expected: string): Promise<void> {
  let caught: { errno?: string } | undefined;
  try {
    await sql.unsafe(statement);
  } catch (error) {
    caught = error as { errno?: string };
  }
  expect(caught, `expected SQLSTATE ${expected}, got success`).toBeDefined();
  expect(caught?.errno).toBe(expected);
}

describe.skipIf(!RUN)("reward ticket pool migration 0232 (real Postgres)", () => {
  beforeAll(async () => {
    const root = connect({});
    await root.unsafe(`DROP DATABASE IF EXISTS ${TEST_DB} WITH (FORCE)`);
    await root.unsafe(`CREATE DATABASE ${TEST_DB}`);
    await root.end();

    const db = connect({ db: TEST_DB });
    for (const role of ["control_plane_api_rw", "control_plane_api_ro", "control_plane_ops_ro"]) {
      await db.unsafe(`DROP ROLE IF EXISTS ${role}`);
      const login = role === "control_plane_api_rw" ? `LOGIN PASSWORD '${RW_PASSWORD}'` : "NOLOGIN";
      await db.unsafe(`CREATE ROLE ${role} ${login} NOSUPERUSER NOCREATEDB NOCREATEROLE`);
      await db.unsafe(`GRANT USAGE ON SCHEMA public TO ${role}`);
    }
    await db.unsafe("CREATE TABLE communities (community_id TEXT PRIMARY KEY)");
    await db.unsafe("CREATE TABLE users (user_id TEXT PRIMARY KEY)");
    await db.unsafe(
      "CREATE TABLE reward_qualification_events (reward_qualification_event_id TEXT PRIMARY KEY)",
    );
    await applyMigration(db, "db/control-plane/migrations/0224_control_plane_reward_ticket_pools.sql");
    await applyMigration(
      db,
      "db/control-plane/migrations/0232_control_plane_reward_ticket_pool_hardening.sql",
    );
    await db.unsafe("INSERT INTO communities VALUES ('community')");
    await db.unsafe("INSERT INTO users VALUES ('creator'), ('owner'), ('u0'), ('u1'), ('u2')");
    await db.unsafe("INSERT INTO reward_qualification_events VALUES ('q0'), ('q1'), ('q2')");
    await db.unsafe(`
      INSERT INTO reward_ticket_custody_backing_domains (
        chain_id, token_address, custody_address, status, backing_policy_version, activated_at
      ) VALUES (
        84532, '0x4444444444444444444444444444444444444444',
        '0x5555555555555555555555555555555555555555', 'active',
        'single_custody_per_asset_v1', '2026-08-13T00:00:00Z'
      )
    `);
    await db.end();
  });

  afterAll(async () => {
    const root = connect({});
    await root.unsafe(`DROP DATABASE IF EXISTS ${TEST_DB} WITH (FORCE)`).catch(() => undefined);
    for (const role of ["control_plane_api_rw", "control_plane_api_ro", "control_plane_ops_ro"]) {
      await root.unsafe(`DROP ROLE IF EXISTS ${role}`).catch(() => undefined);
    }
    await root.end();
  });

  test("rejects publication without durable evidence", async () => {
    const db = connect({ db: TEST_DB });
    await expectSqlState(
      db,
      `INSERT INTO reward_ticket_beneficiary_commitment_batches (
         reward_ticket_beneficiary_commitment_batch_id, chain_id, jackpot_address,
         drawing_id, root_hash, publication_kind, status, frozen_at
       ) VALUES (
         'bad_commitment', 84532, '0x1111111111111111111111111111111111111111',
         1, '${"a".repeat(64)}', 'public_append_only_log', 'published', NOW()
       )`,
      "23514",
    );
    await db.end();
  });

  test("credits a zero-safe deterministic split only after inventory sweep and final claim", async () => {
    const db = connect({ db: TEST_DB });
    await db.begin(async (tx) => {
      await tx.unsafe(`
        INSERT INTO reward_ticket_pools (
          reward_ticket_pool_id, community_id, post_id, song_artifact_bundle_id,
          creator_user_id, song_owner_user_id, creation_idempotency_key, status,
          qualifying_activity, identity_policy_version, tickets_per_drawing,
          max_ticket_cents, entry_cutoff_seconds, drawing_association_policy,
          beneficiary_algorithm_version, chain_id, jackpot_address,
          random_ticket_buyer_address, ticket_nft_address, usdc_token_address,
          custody_address, source_tag, terms_hash, funded_cents, fulfilled_cents, starts_at
        ) VALUES (
          'pool', 'community', 'post', 'bundle', 'creator', 'owner', 'create', 'active',
          'either', 'unique_v1', 1, 100, 300, 'current_v1', 'equal_v1', 84532,
          '0x1111111111111111111111111111111111111111',
          '0x2222222222222222222222222222222222222222',
          '0x3333333333333333333333333333333333333333',
          '0x4444444444444444444444444444444444444444',
          '0x5555555555555555555555555555555555555555',
          'source', '${"b".repeat(64)}', 100, 1, '2026-08-13T00:00:00Z'
        )
      `);
      await tx.unsafe(`
        INSERT INTO reward_ticket_beneficiary_commitment_batches (
          reward_ticket_beneficiary_commitment_batch_id, chain_id, jackpot_address,
          drawing_id, root_hash, publication_kind, publication_reference,
          status, frozen_at, published_at
        ) VALUES (
          'commitment', 84532, '0x1111111111111111111111111111111111111111',
          7, '${"c".repeat(64)}', 'public_append_only_log', 'log://commitment/7',
          'published', '2026-08-13T00:05:00Z', '2026-08-13T00:06:00Z'
        )
      `);
      await tx.unsafe(`
        INSERT INTO reward_ticket_pool_drawings (
          reward_ticket_pool_drawing_id, reward_ticket_pool_id, chain_id,
          jackpot_address, drawing_id, status, entry_opens_at, entry_cutoff_at,
          drawing_resolves_at, beneficiary_count, snapshot_hash, commitment_batch_id,
          commitment_leaf_index, commitment_inclusion_proof_json, ticket_count,
          actual_cost_cents, actual_cost_atomic, frozen_at, committed_at,
          tickets_confirmed_at, drawing_resolved_at, credited_at,
          inventory_complete_at, sweep_complete_at
        ) VALUES (
          'drawing', 'pool', 84532, '0x1111111111111111111111111111111111111111',
          7, 'credited', '2026-08-13T00:00:00Z', '2026-08-13T00:05:00Z',
          '2026-08-13T00:30:00Z', 3, '${"d".repeat(64)}', 'commitment', 0, '[]', 1,
          1, 10000, '2026-08-13T00:05:00Z', '2026-08-13T00:06:00Z',
          '2026-08-13T00:10:00Z', '2026-08-13T00:31:00Z', '2026-08-13T00:40:00Z',
          '2026-08-13T00:11:00Z', '2026-08-13T00:32:00Z'
        )
      `);
      for (const [position, user] of ["u0", "u1", "u2"].entries()) {
        await tx.unsafe(`
          INSERT INTO reward_ticket_pool_beneficiaries (
            reward_ticket_pool_drawing_id, reward_identity_id, user_id,
            reward_qualification_event_id, qualification_evidence_hash,
            canonical_position, qualified_at
          ) VALUES (
            'drawing', 'identity${position}', '${user}', 'q${position}',
            '${String(position).repeat(64)}', ${position}, '2026-08-13T00:04:00Z'
          )
        `);
      }
      await tx.unsafe(`
        INSERT INTO reward_ticket_purchase_effects (
          reward_ticket_purchase_effect_id, reward_ticket_pool_drawing_id,
          idempotency_key, status, expected_ticket_count, reserved_cents,
          actual_cost_cents, actual_cost_atomic, recipient_address, tx_hash,
          confirmed_block_number, confirmed_block_hash, confirmed_at, finalized_at
        ) VALUES (
          'purchase', 'drawing', 'purchase-key', 'confirmed', 1, 100, 1, 10000,
          '0x5555555555555555555555555555555555555555', '0x${"1".repeat(64)}',
          10, '0x${"2".repeat(64)}', '2026-08-13T00:10:00Z',
          '2026-08-13T00:11:00Z'
        )
      `);
      await tx.unsafe(`
        INSERT INTO reward_ticket_inventory (
          reward_ticket_inventory_id, reward_ticket_pool_drawing_id,
          reward_ticket_purchase_effect_id, chain_id, ticket_nft_address,
          ticket_id, owner_address, status, payout_tier, protocol_drawing_id
        ) VALUES (
          'ticket', 'drawing', 'purchase', 84532,
          '0x3333333333333333333333333333333333333333', 99,
          '0x5555555555555555555555555555555555555555', 'claimed', 1, 7
        )
      `);
      await tx.unsafe(`
        INSERT INTO reward_ticket_claim_effects (
          reward_ticket_claim_effect_id, reward_ticket_pool_drawing_id,
          idempotency_key, status, tx_hash, protocol_reported_winnings_atomic,
          received_amount_atomic, confirmed_block_number, confirmed_block_hash,
          confirmed_at, finalized_at
        ) VALUES (
          'claim', 'drawing', 'claim-key', 'confirmed', '0x${"3".repeat(64)}', 2, 2,
          20, '0x${"4".repeat(64)}', '2026-08-13T00:35:00Z', '2026-08-13T00:36:00Z'
        )
      `);
      await tx.unsafe("INSERT INTO reward_ticket_claim_tickets VALUES ('claim', 'ticket', NOW())");
      await tx.unsafe(`
        INSERT INTO reward_ticket_allocation_batches (
          reward_ticket_allocation_batch_id, reward_ticket_pool_drawing_id,
          idempotency_key, algorithm_version, beneficiary_count,
          proceeds_atomic, allocated_atomic, status
        ) VALUES ('batch', 'drawing', 'batch-key', 'equal_v1', 3, 2, 2, 'pending')
      `);
      await tx.unsafe(
        "INSERT INTO reward_ticket_allocation_batch_claims VALUES ('batch', 'claim', NOW())",
      );
      for (const [position, amount] of [1, 1, 0].entries()) {
        await tx.unsafe(`
          INSERT INTO reward_ticket_allocations (
            reward_ticket_allocation_id, reward_ticket_allocation_batch_id,
            reward_ticket_pool_drawing_id, reward_identity_id, user_id,
            canonical_position, amount_atomic, received_remainder_unit
          ) VALUES (
            'allocation${position}', 'batch', 'drawing', 'identity${position}',
            'u${position}', ${position}, ${amount}, ${position < 2}
          )
        `);
      }
      await tx.unsafe(`
        UPDATE reward_ticket_allocation_batches
        SET status = 'credited', credited_at = '2026-08-13T00:40:00Z'
        WHERE reward_ticket_allocation_batch_id = 'batch'
      `);
      for (const position of [0, 1]) {
        await tx.unsafe(`
          INSERT INTO reward_ticket_usdc_ledger_entries (
            reward_ticket_usdc_ledger_entry_id, user_id, chain_id, token_address,
            idempotency_key, entry_kind, amount_atomic, reward_ticket_allocation_id
          ) VALUES (
            'credit${position}', 'u${position}', 84532,
            '0x4444444444444444444444444444444444444444', 'credit-key-${position}',
            'pool_allocation_credit', 1, 'allocation${position}'
          )
        `);
      }
    });

    const balances = await db.unsafe(`
      SELECT user_id, credited_atomic::TEXT AS credited_atomic
      FROM reward_ticket_usdc_balances ORDER BY user_id
    `);
    expect(balances).toEqual([
      { user_id: "u0", credited_atomic: "1" },
      { user_id: "u1", credited_atomic: "1" },
    ]);

    await expectSqlState(
      db,
      `INSERT INTO reward_ticket_inventory (
         reward_ticket_inventory_id, reward_ticket_pool_drawing_id,
         reward_ticket_purchase_effect_id, chain_id, ticket_nft_address,
         ticket_id, owner_address, status, protocol_drawing_id
       ) VALUES (
         'mismatch-held', 'drawing', 'purchase', 84532,
         '0x3333333333333333333333333333333333333333', 100,
         '0x5555555555555555555555555555555555555555', 'held', 8
       )`,
      "23514",
    );

    let mismatchCommitError: { errno?: string } | undefined;
    try {
      await db.begin(async (tx) => {
        await tx.unsafe(`
          INSERT INTO reward_ticket_inventory (
            reward_ticket_inventory_id, reward_ticket_pool_drawing_id,
            reward_ticket_purchase_effect_id, chain_id, ticket_nft_address,
            ticket_id, owner_address, status, protocol_drawing_id
          ) VALUES (
            'mismatch-review', 'drawing', 'purchase', 84532,
            '0x3333333333333333333333333333333333333333', 101,
            '0x5555555555555555555555555555555555555555', 'needs_review', 8
          )
        `);
      });
    } catch (error) {
      mismatchCommitError = error as { errno?: string };
    }
    expect(mismatchCommitError?.errno).toBe("23514");

    await expectSqlState(
      db,
      "UPDATE reward_ticket_claim_effects SET received_amount_atomic = 3 WHERE reward_ticket_claim_effect_id = 'claim'",
      "23514",
    );
    await db.unsafe(`
      INSERT INTO reward_ticket_platform_revenue_ledger_entries (
        reward_ticket_platform_revenue_ledger_entry_id, chain_id, token_address,
        platform_revenue_address, entry_kind, amount_atomic,
        reward_ticket_purchase_effect_id, tx_hash, log_index,
        observed_block_number, observed_block_hash, observed_at
      ) VALUES (
        'platform-revenue', 84532, '0x4444444444444444444444444444444444444444',
        '0x7777777777777777777777777777777777777777',
        'purchase_referral_accrual', 1, 'purchase', '0x${"1".repeat(64)}', 4,
        10, '0x${"2".repeat(64)}', NOW()
      )
    `);
    await expectSqlState(
      db,
      "UPDATE reward_ticket_platform_revenue_ledger_entries SET amount_atomic = 2 WHERE reward_ticket_platform_revenue_ledger_entry_id = 'platform-revenue'",
      "23514",
    );
    await db.end();
  });

  test("denies direct balance mutation and settles cashout through finalized effects", async () => {
    const rw = connect({ db: TEST_DB, user: "control_plane_api_rw", password: RW_PASSWORD });
    await expectSqlState(
      rw,
      "UPDATE reward_ticket_usdc_balances SET credited_atomic = 100 WHERE user_id = 'u0'",
      "42501",
    );
    await rw.unsafe(`
      INSERT INTO reward_ticket_cashout_effects (
        reward_ticket_cashout_effect_id, user_id, chain_id, token_address,
        custody_address, destination_address, idempotency_key, status, amount_atomic
      ) VALUES (
        'cashout', 'u0', 84532, '0x4444444444444444444444444444444444444444',
        '0x5555555555555555555555555555555555555555',
        '0x6666666666666666666666666666666666666666', 'cashout-key', 'reserved', 1
      )
    `);
    await rw.unsafe(`
      INSERT INTO reward_ticket_usdc_ledger_entries (
        reward_ticket_usdc_ledger_entry_id, user_id, chain_id, token_address,
        idempotency_key, entry_kind, amount_atomic, reward_ticket_cashout_effect_id
      ) VALUES (
        'reserve', 'u0', 84532, '0x4444444444444444444444444444444444444444',
        'reserve-key', 'cashout_reservation', 1, 'cashout'
      )
    `);
    await rw.unsafe(`
      UPDATE reward_ticket_cashout_effects
      SET status = 'submitted', tx_hash = '0x${"5".repeat(64)}',
          submitted_block_number = 29, submitted_at = NOW()
      WHERE reward_ticket_cashout_effect_id = 'cashout'
    `);
    await rw.unsafe(`
      UPDATE reward_ticket_cashout_effects
      SET status = 'confirmed',
          confirmed_block_number = 30, confirmed_block_hash = '0x${"6".repeat(64)}',
          confirmed_at = NOW(), finalized_at = NOW()
      WHERE reward_ticket_cashout_effect_id = 'cashout'
    `);
    await rw.unsafe(`
      INSERT INTO reward_ticket_usdc_ledger_entries (
        reward_ticket_usdc_ledger_entry_id, user_id, chain_id, token_address,
        idempotency_key, entry_kind, amount_atomic, reward_ticket_cashout_effect_id
      ) VALUES (
        'payment', 'u0', 84532, '0x4444444444444444444444444444444444444444',
        'payment-key', 'cashout_payment', 1, 'cashout'
      )
    `);
    const balances = await rw.unsafe(`
      SELECT credited_atomic::TEXT AS credited, cashout_reserved_atomic::TEXT AS reserved,
             paid_atomic::TEXT AS paid
      FROM reward_ticket_usdc_balances WHERE user_id = 'u0'
    `);
    expect(balances[0]).toEqual({ credited: "1", reserved: "0", paid: "1" });
    await rw.end();
  });
});
