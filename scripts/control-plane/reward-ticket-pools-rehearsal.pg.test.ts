import { SQL } from "bun"
import { describe, expect, test } from "bun:test"

const DATABASE_URL = process.env.REWARD_TICKET_REHEARSAL_DATABASE_URL
const RUN = Boolean(DATABASE_URL)
const CHAIN_ID = 84532
const JACKPOT = "0x465dA3c859f193A3807386387bEE941B2A4c3279"
const BUYER = "0x53c04e7e5044B28Ea8A4F9c4b26E3Ac1aeb63746"
const NFT = "0x45084829ac63f9dC6a3D4981A46FA896f9180ECd"
const USDC = "0x036CbD53842c5426634e7929541eC2318f3dCF7e"
const CUSTODY = "0x1cd289B6b232E1378d606ba550019E553685ad4C"
const REVENUE = "0xBc61B707dc52BCDF51D261DcdF72329723C9BB8F"

function db(): SQL {
  return new SQL({ url: DATABASE_URL as string, tls: false, max: 1 } as Record<string, unknown>)
}

async function sqlState(operation: () => Promise<unknown>): Promise<string | null> {
  try { await operation(); return null } catch (error) { return (error as { errno?: string }).errno ?? null }
}

describe.skipIf(!RUN)("reward ticket full-chain Base Sepolia replay", () => {
  test("replays no-win and net-winning cycles through 0227/0228 constraints", async () => {
    const connection = db()
    await connection.unsafe(`
      INSERT INTO users (
        user_id, verification_state, verification_capabilities_json, created_at, updated_at
      ) VALUES
        ('rt_owner', 'verified', '{}', NOW(), NOW()),
        ('rt_u0', 'verified', '{}', NOW(), NOW()),
        ('rt_u1', 'verified', '{}', NOW(), NOW()),
        ('rt_u2', 'verified', '{}', NOW(), NOW())
    `)
    await connection.unsafe(`
      INSERT INTO communities (
        community_id, creator_user_id, display_name, membership_mode, status,
        provisioning_state, transfer_state, created_at, updated_at
      ) VALUES (
        'rt_community', 'rt_owner', 'Reward rehearsal', 'open', 'active',
        'active', 'none', NOW(), NOW()
      )
    `)
    for (const position of [0, 1, 2]) {
      await connection.unsafe(`
        INSERT INTO reward_qualification_events (
          reward_qualification_event_id, community_id, shard_sequence, user_id,
          post_id, song_artifact_bundle_id, activity, qualified_at,
          reward_period_key, qualification_policy_version, evidence_summary_json
        ) VALUES (
          'rt_q${position}', 'rt_community', ${position + 1}, 'rt_u${position}',
          'rt_post_win', 'rt_bundle_win', 'karaoke', '2026-08-13T23:50:00Z',
          '2026-08-13', 'unique_v1', '{}'
        )
      `)
    }
    await connection.unsafe(`
      INSERT INTO reward_ticket_custody_backing_domains (
        chain_id, token_address, custody_address, status, backing_policy_version, activated_at
      ) VALUES (${CHAIN_ID}, '${USDC}', '${CUSTODY}', 'active', 'single_custody_per_asset_v1', NOW())
    `)
    for (const [suffix, drawingId, postId] of [
      ["no_win", 7779, "rt_post_no_win"],
      ["win", 7780, "rt_post_win"],
    ] as const) {
      const termsHash = "11".repeat(32)
      const commitmentTx = suffix === "win"
        ? "0x299334d02e60ff7eeec3ffc18345079ba779c5d7e524118e95d939b36388f5aa"
        : "0x6cf131ba8ad1d0e4baa822cdb0113d64a5031b1b31c9a39c7139cd9af7dfa5a5"
      const purchaseTx = suffix === "win"
        ? "0xdcc29758ac401fcda368b406d4995c5d58631aa29b9cf2570f1fa47957c96f94"
        : "0xdadd7335febcfd18e2733aa8d490d946b19ee48beee8870d4d2a315fb5116306"
      await connection.unsafe(`
        INSERT INTO reward_ticket_pools (
          reward_ticket_pool_id, community_id, post_id, song_artifact_bundle_id,
          creator_user_id, song_owner_user_id, creation_idempotency_key, status,
          qualifying_activity, identity_policy_version, tickets_per_drawing,
          max_ticket_cents, entry_cutoff_seconds, drawing_association_policy,
          beneficiary_algorithm_version, chain_id, jackpot_address,
          random_ticket_buyer_address, ticket_nft_address, usdc_token_address,
          custody_address, referrer_address, source_tag, terms_hash,
          funded_cents, fulfilled_cents, starts_at
        ) VALUES (
          'rt_pool_${suffix}', 'rt_community', '${postId}', 'rt_bundle_${suffix}',
          'rt_owner', 'rt_owner', 'rt_create_${suffix}', 'active', 'either', 'unique_v1',
          1, 1, 120, 'current_v1', 'equal_v1', ${CHAIN_ID}, '${JACKPOT}', '${BUYER}',
          '${NFT}', '${USDC}', '${CUSTODY}', '${REVENUE}', 'pirate-rehearsal',
          '${termsHash}', 1, 1, '2026-08-13T23:00:00Z'
        )
      `)
      await connection.unsafe(`
        INSERT INTO reward_ticket_beneficiary_commitment_batches (
          reward_ticket_beneficiary_commitment_batch_id, chain_id, jackpot_address,
          drawing_id, root_hash, publication_kind, publication_reference,
          publication_tx_hash, publication_block_number, status, frozen_at, published_at
        ) VALUES (
          'rt_commit_${suffix}', ${CHAIN_ID}, '${JACKPOT}', ${drawingId}, '${"44".repeat(32)}',
          'onchain', 'base-sepolia:${drawingId}',
          '${commitmentTx}', ${suffix === "win" ? 45466466 : 45465552},
          'published', '2026-08-13T23:00:00Z', '2026-08-13T23:01:00Z'
        )
      `)
      await connection.unsafe(`
        INSERT INTO reward_ticket_pool_drawings (
          reward_ticket_pool_drawing_id, reward_ticket_pool_id, chain_id,
          jackpot_address, drawing_id, status, entry_opens_at, entry_cutoff_at,
          drawing_resolves_at, beneficiary_count, snapshot_hash, commitment_batch_id,
          commitment_leaf_index, commitment_inclusion_proof_json, ticket_count,
          actual_cost_cents, actual_cost_atomic, frozen_at, committed_at,
          tickets_confirmed_at, drawing_resolved_at, inventory_complete_at, sweep_complete_at
        ) VALUES (
          'rt_drawing_${suffix}', 'rt_pool_${suffix}', ${CHAIN_ID}, '${JACKPOT}', ${drawingId},
          '${suffix === "win" ? "winnings_detected" : "no_win"}',
          '2026-08-13T23:00:00Z', '2026-08-13T23:05:00Z', '2026-08-13T23:30:00Z',
          ${suffix === "win" ? 3 : 1}, '${"55".repeat(32)}', 'rt_commit_${suffix}', 0, '[]',
          1, 1, 10000, '2026-08-13T23:05:00Z', '2026-08-13T23:06:00Z',
          '2026-08-13T23:07:00Z', '2026-08-13T23:35:00Z',
          '2026-08-13T23:08:00Z', '2026-08-13T23:36:00Z'
        )
      `)
      const beneficiaryCount = suffix === "win" ? 3 : 1
      for (let position = 0; position < beneficiaryCount; position += 1) {
        await connection.unsafe(`
          INSERT INTO reward_ticket_pool_beneficiaries (
            reward_ticket_pool_drawing_id, reward_identity_id, user_id,
            reward_qualification_event_id, qualification_evidence_hash,
            canonical_position, qualified_at
          ) VALUES (
            'rt_drawing_${suffix}', 'rt_identity_${suffix}_${position}', 'rt_u${position}',
            'rt_q${position}', '${String(position + 1).repeat(64)}', ${position},
            '2026-08-13T23:04:00Z'
          )
        `)
      }
      await connection.unsafe(`
        INSERT INTO reward_ticket_purchase_effects (
          reward_ticket_purchase_effect_id, reward_ticket_pool_drawing_id,
          idempotency_key, status, expected_ticket_count, reserved_cents,
          actual_cost_cents, actual_cost_atomic, recipient_address, tx_hash,
          confirmed_block_number, confirmed_block_hash, confirmed_at, finalized_at
        ) VALUES (
          'rt_purchase_${suffix}', 'rt_drawing_${suffix}', 'rt_purchase_key_${suffix}',
          'confirmed', 1, 1, 1, 10000, '${CUSTODY}',
          '${purchaseTx}', ${suffix === "win" ? 45466471 : 45465557},
          '0x${"66".repeat(32)}', '2026-08-13T23:07:00Z', '2026-08-13T23:08:00Z'
        )
      `)
    }
    await connection.unsafe(`
      INSERT INTO reward_ticket_inventory (
        reward_ticket_inventory_id, reward_ticket_pool_drawing_id,
        reward_ticket_purchase_effect_id, chain_id, ticket_nft_address,
        ticket_id, owner_address, status, payout_tier, protocol_drawing_id
      ) VALUES
        ('rt_ticket_no_win', 'rt_drawing_no_win', 'rt_purchase_no_win', ${CHAIN_ID}, '${NFT}',
         44928936071602651772011246314840568663993266602938147578316113749132323306689,
         '${CUSTODY}', 'no_win', 0, 7779),
        ('rt_ticket_win', 'rt_drawing_win', 'rt_purchase_win', ${CHAIN_ID}, '${NFT}',
         99260296862274692944937490076696356047997256690784268744380105077013759748969,
         '${CUSTODY}', 'claimed', 4, 7780)
    `)
    await connection.unsafe(`
      INSERT INTO reward_ticket_claim_effects (
        reward_ticket_claim_effect_id, reward_ticket_pool_drawing_id,
        idempotency_key, status, tx_hash, protocol_reported_winnings_atomic,
        received_amount_atomic, gross_tier_payout_atomic, referral_accrual_atomic,
        confirmed_block_number, confirmed_block_hash, confirmed_at, finalized_at
      ) VALUES (
        'rt_claim_win', 'rt_drawing_win', 'rt_claim_key_win', 'confirmed',
        '0x0a8262fed2d1cb02430bf90a9814ef112cd44e95b8c76adfcf1ca88efa17a14d',
        10001, 10001, 11112, 1111, 45467393,
        '0xdba9bf5c6c969df7a8e18977b2c28a0b6e3e5fe2f1b5e2df0671fcb7e7ef848b',
        '2026-08-14T10:28:00Z', '2026-08-14T10:29:00Z'
      )
    `)
    await connection.unsafe("INSERT INTO reward_ticket_claim_tickets VALUES ('rt_claim_win', 'rt_ticket_win', NOW())")
    expect(await sqlState(() => connection.unsafe(`
      INSERT INTO reward_ticket_platform_revenue_ledger_entries (
        reward_ticket_platform_revenue_ledger_entry_id, chain_id, token_address,
        platform_revenue_address, entry_kind, amount_atomic,
        reward_ticket_claim_effect_id, tx_hash, log_index,
        observed_block_number, observed_block_hash, observed_at
      ) VALUES (
        'rt_bad_win_referral', ${CHAIN_ID}, '${USDC}', '${REVENUE}',
        'winnings_referral_accrual', 1110, 'rt_claim_win',
        '0x0a8262fed2d1cb02430bf90a9814ef112cd44e95b8c76adfcf1ca88efa17a14d',
        0, 45467393,
        '0xdba9bf5c6c969df7a8e18977b2c28a0b6e3e5fe2f1b5e2df0671fcb7e7ef848b', NOW()
      )
    `))).toBe("23514")
    await connection.unsafe(`
      INSERT INTO reward_ticket_platform_revenue_ledger_entries (
        reward_ticket_platform_revenue_ledger_entry_id, chain_id, token_address,
        platform_revenue_address, entry_kind, amount_atomic,
        reward_ticket_claim_effect_id, tx_hash, log_index,
        observed_block_number, observed_block_hash, observed_at
      ) VALUES (
        'rt_win_referral', ${CHAIN_ID}, '${USDC}', '${REVENUE}',
        'winnings_referral_accrual', 1111, 'rt_claim_win',
        '0x0a8262fed2d1cb02430bf90a9814ef112cd44e95b8c76adfcf1ca88efa17a14d',
        1, 45467393,
        '0xdba9bf5c6c969df7a8e18977b2c28a0b6e3e5fe2f1b5e2df0671fcb7e7ef848b', NOW()
      )
    `)
    await connection.begin(async (tx) => {
      await tx.unsafe(`
        INSERT INTO reward_ticket_allocation_batches (
          reward_ticket_allocation_batch_id, reward_ticket_pool_drawing_id,
          idempotency_key, algorithm_version, beneficiary_count,
          proceeds_atomic, allocated_atomic, status
        ) VALUES ('rt_batch_win', 'rt_drawing_win', 'rt_batch_key_win', 'equal_v1', 3, 10001, 10001, 'pending')
      `)
      await tx.unsafe("INSERT INTO reward_ticket_allocation_batch_claims VALUES ('rt_batch_win', 'rt_claim_win', NOW())")
      for (const [position, amount] of [3334, 3334, 3333].entries()) {
        await tx.unsafe(`
          INSERT INTO reward_ticket_allocations (
            reward_ticket_allocation_id, reward_ticket_allocation_batch_id,
            reward_ticket_pool_drawing_id, reward_identity_id, user_id,
            canonical_position, amount_atomic, received_remainder_unit
          ) VALUES (
            'rt_allocation_${position}', 'rt_batch_win', 'rt_drawing_win',
            'rt_identity_win_${position}', 'rt_u${position}', ${position}, ${amount}, ${position < 2}
          )
        `)
      }
      await tx.unsafe("UPDATE reward_ticket_allocation_batches SET status='credited', credited_at=NOW() WHERE reward_ticket_allocation_batch_id='rt_batch_win'")
      await tx.unsafe("UPDATE reward_ticket_pool_drawings SET status='credited', credited_at=NOW() WHERE reward_ticket_pool_drawing_id='rt_drawing_win'")
      for (const [position, amount] of [3334, 3334, 3333].entries()) {
        await tx.unsafe(`
          INSERT INTO reward_ticket_usdc_ledger_entries (
            reward_ticket_usdc_ledger_entry_id, user_id, chain_id, token_address,
            idempotency_key, entry_kind, amount_atomic, reward_ticket_allocation_id
          ) VALUES (
            'rt_credit_${position}', 'rt_u${position}', ${CHAIN_ID}, '${USDC}',
            'rt_credit_key_${position}', 'pool_allocation_credit', ${amount}, 'rt_allocation_${position}'
          )
        `)
      }
    })

    await connection.unsafe(`
      INSERT INTO reward_ticket_custody_solvency_observations (
        reward_ticket_custody_solvency_observation_id, chain_id, token_address,
        custody_address, custody_balance_atomic, outstanding_liability_atomic,
        canonical_block_number, canonical_block_hash, status, observed_at
      ) VALUES (
        'rt_solvency_win', ${CHAIN_ID}, '${USDC}', '${CUSTODY}', 19910001, 10001,
        45467393,
        '0xdba9bf5c6c969df7a8e18977b2c28a0b6e3e5fe2f1b5e2df0671fcb7e7ef848b',
        'solvent', NOW()
      )
    `)

    const noWinAllocations = await connection.unsafe(`
      SELECT COUNT(*)::INTEGER AS count FROM reward_ticket_allocations
      WHERE reward_ticket_pool_drawing_id='rt_drawing_no_win'
    `)
    expect(noWinAllocations[0]?.count).toBe(0)
    const balances = await connection.unsafe(`
      SELECT user_id, credited_atomic::TEXT AS credited_atomic
      FROM reward_ticket_usdc_balances ORDER BY user_id
    `)
    expect(balances).toEqual([
      { user_id: "rt_u0", credited_atomic: "3334" },
      { user_id: "rt_u1", credited_atomic: "3334" },
      { user_id: "rt_u2", credited_atomic: "3333" },
    ])
    const solvency = await connection.unsafe(`
      SELECT custody_balance_atomic::TEXT AS custody_balance_atomic,
             outstanding_liability_atomic::TEXT AS outstanding_liability_atomic,
             status
      FROM reward_ticket_custody_solvency_observations
      WHERE reward_ticket_custody_solvency_observation_id='rt_solvency_win'
    `)
    expect(solvency).toEqual([{
      custody_balance_atomic: "19910001",
      outstanding_liability_atomic: "10001",
      status: "solvent",
    }])
    const lateState = await sqlState(() => connection.begin(async (tx) => {
      await tx.unsafe(`
        INSERT INTO reward_ticket_inventory (
          reward_ticket_inventory_id, reward_ticket_pool_drawing_id,
          reward_ticket_purchase_effect_id, chain_id, ticket_nft_address,
          ticket_id, owner_address, status, payout_tier, protocol_drawing_id
        ) VALUES (
          'rt_late_ticket', 'rt_drawing_win', 'rt_purchase_win', ${CHAIN_ID}, '${NFT}', 99,
          '${CUSTODY}', 'needs_review', 0, 7752
        )
      `)
    }))
    expect(lateState).toBe("23514")
    await connection.unsafe(`
      INSERT INTO reward_ticket_pool_incidents (
        reward_ticket_pool_incident_id, reward_ticket_pool_id,
        reward_ticket_pool_drawing_id, incident_kind, status,
        owner_identifier, evidence_json
      ) VALUES (
        'rt_late_inventory_incident', 'rt_pool_win', 'rt_drawing_win',
        'late_inventory_rejected', 'open', 'reward_ticket_worker',
        '{"sqlstate":"23514","retry":false}'
      )
    `)
    const incident = await connection.unsafe(`
      SELECT status, evidence_json FROM reward_ticket_pool_incidents
      WHERE reward_ticket_pool_incident_id='rt_late_inventory_incident'
    `)
    expect(incident[0]).toEqual({
      status: "open",
      evidence_json: { sqlstate: "23514", retry: false },
    })
    await connection.end()
  }, 30_000)
})
