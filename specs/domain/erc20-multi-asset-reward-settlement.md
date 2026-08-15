# ERC-20 Multi-Asset Reward Settlement

Status: ratified program specification (2026-08-15) — proposed program, not
active implementation. Decisions D1 and D4 are ratified; no implementation PR
exists.

Depends on:

- API #1318, merged as `d82803fa` (settlement-asset descriptor snapshot in
  campaign terms hash v5).
- Core #557 (migration 0231, campaign asset-descriptor columns) and #560
  (migration 0232), applied and ledger-verified in both staging and
  production.

**Migration numbers 0235–0239 are provisional.** They were computed against
core `origin/main@92ffb8d` on 2026-08-15, where 0233 and 0234 are already
taken by reward-ticket-pool hardening (#561/#562). The control-plane sequence
moves quickly; recompute the next free numbers immediately before each
implementation PR and renumber this spec's references in the same PR.

Related docs:

- [song-practice-reward-campaigns.md](./song-practice-reward-campaigns.md)
- [song-practice-reward-decisions.md](./song-practice-reward-decisions.md)

## 1. Position statement

#1318 delivered the immutable settlement-asset foundation: campaigns snapshot
{chain, token, decimals, symbol} into terms hash v5, legacy rows replay
against the legacy hash, and funding quotes fail closed on asset mismatch.
The system remains single-configured-asset (canonical USDC). This program
makes a **second admitted asset** possible without weakening any existing
invariant. General "arbitrary ERC-20" support is explicitly **not** the goal
— admission is a curated, evidence-backed registry act.

## 2. Ratified design decisions

- **D1 — Denomination policy: `usd_par` only (phase 1).** *Ratified
  2026-08-15.* Admission is limited to assets with an approved 1-token =
  1-USD settlement policy, `decimals >= 2`, and plain ERC-20 semantics (no
  fee-on-transfer, rebasing, or transfer hooks). Under `usd_par`, conversion
  is exact integer scaling: `atomic = cents * 10^(decimals-2)`; campaign
  economics stay cents-denominated (`budget_cents`, liability SQL, solvency
  gates all unchanged in kind). **Priced/volatile assets and atomic-native
  economics are out of scope** — they require a price/denomination snapshot
  mechanism and introduce an oracle trust surface that does not exist in the
  codebase today; that is a separate program with its own design.
- **D1a — Depeg response is an ops procedure, not code.** On depeg of an
  admitted asset: set registry status `suspended` (halts new quotes/campaigns
  for that asset via the existing fail-closed readiness path), engage
  `REWARDS_SOLVENCY_FREEZE_ENABLED` / `REWARDS_PAYOUTS_ENABLED` as scope
  requires, then run the retirement flow (D6). Solvency evidence is
  token-unit based and dollar-blind — operators must treat a suspended-asset
  solvency row as invalid until re-pegged or retired.
- **D2 — Payout partitioning: one payout = one asset.** Reward events carry
  an asset identity; user balances are computed per asset (replacing today's
  global `currentBalanceCents`, `reward-cashout-service.ts:286`); a payout
  effect snapshots its asset; FIFO allocations (`reward_payout_allocations`,
  0150) may not cross assets; single-inflight widens from per-user to
  per-(user, asset); idempotency stays per-(user, key) globally — a retry
  must replay the identical asset.
- **D3 — Registry ≠ rail.** Two concepts, two tables: **asset admission**
  (intrinsic: chain, token, decimals, symbol, denomination policy, lifecycle)
  and **settlement rail binding** (per environment/backend: treasury, vault,
  operator, policy version). Retires both hardcoded `CANONICAL_USDC_BY_CHAIN`
  maps (`lib/communities/bookings/booking-chain-config.ts:17`,
  `lib/bookings/booking-settlement-config.ts:22`) and the #1318 config
  literals.
- **D4 — Funded-inventory refunds: in scope.** *Ratified 2026-08-15 as a
  scope decision.* `refunded_cents` is schema-reserved but never written;
  this program builds end-campaign/retirement remainder refunds to funders.
  Without it, admitting a second asset strands value at retirement time.

  The detailed product refund policy is deliberately **not** defined in this
  spec. Its ratification is a hard prerequisite for the refund implementation
  PR (sequence step 9) and for enabling any second asset. The policy must
  cover, at minimum: eligibility, per-campaign-kind behavior (permanent pools
  vs. ended campaigns), timing, proportional allocation, gas/fee treatment,
  ambiguous or in-flight effects, custody incidents, rounding, audit
  evidence, and terminal disposition. **No non-USDC asset may be activated
  until that policy is ratified, the refund implementation has landed, and
  the staging retirement/refund drill (sequence step 10) is complete.**
- **D5 — Vault model: per-token vault deployments, no contract change.** The
  vault `pay/refund` encoding carries no token parameter because each vault
  instance is single-asset. Multi-asset execution = deploy one vault per
  admitted token with the same policy framework, not a contracts change. EOA
  rail first (simpler), vault rails per token after.
- **D6 — Retirement folds into the registry lifecycle.** The 0195/0196
  tables remain the evidence/anomaly store; the registry gains
  `status: admitted | suspended | retired` with `quote_cutoff_at`, replacing
  migration-seeded retirements with an operator-driven workflow. Lifecycle
  enforcement (fail-closed, quote-cutoff, anomaly ledger) reuses the existing
  `reward-campaign-lifecycle.ts` machinery.

## 3. Core schema (new migrations, numbered by intended landing order)

**0235 — registry and rail bindings:**

- `reward_settlement_assets(chain_id, token_address, decimals, symbol,
  denomination_policy, status, admitted_at, admitted_by,
  authorization_reference, suspended_at, retired_at, quote_cutoff_at, ...)` —
  PK `(chain_id, token_address)`; CHECKs mirror 0231 bounds (lowercase
  address, bounded decimals) plus `decimals >= 2` per D1;
  `denomination_policy = 'usd_par'` initially with the CHECK rejecting
  anything else, so a future priced policy is a deliberate migration.
- `reward_settlement_rails(environment, backend, chain_id, token_address,
  treasury_address, vault_address, operator_address, policy_version, ...)` —
  FK to assets; one active row per (environment, asset).
- 0195-style immutability/append-only triggers; seed canonical USDC (8453,
  84532) as `admitted`/`usd_par`.

**0236 — reward-event asset identity:** add nullable
`asset_chain_id`/`asset_token_address` to `reward_events` (0131) and
`reward_campaign_reservations` (0134). **NULL = legacy env-resolved asset**
(same documented convention as 0231); an ops-run backfill script (not a
migration — the legacy asset differs per environment) stamps explicit values
after the asset is admitted in that environment's registry. New writes always
populate from the campaign snapshot (campaign-linked) or the environment's
single admitted asset (legacy streak path — valid only while exactly one
asset is admitted; the multi-asset gate below forbids legacy-path ambiguity).

**0237 — payout effect partitioning:** add non-null asset snapshot columns to
`reward_payout_effects` (0132) after backfill; rebuild the single-inflight
partial unique index (0133) as
`(user_id, asset_chain_id, asset_token_address) WHERE status='submitted'`; a
terms-trigger-style integrity trigger rejects `reward_payout_allocations`
rows whose reward event's asset differs from the payout effect's.

**0238 — funding effect descriptor:** add `asset_token_decimals`,
`asset_token_symbol` (snapshot at quote time from the campaign descriptor) to
`reward_campaign_funding_effects` (0134); NULLable, legacy = 6/USDC by the
same convention.

**0239 — observation rekeying:** rebuild `reward_solvency_observations`
(0160) and `reward_vault_capacity_observations` (0161) replacing the
singleton `observation_key` CHECKs with composite keys (`observation_key` =
`rewards_treasury:{chain}:{token}` /
`rewards_vault:{chain}:{token}:{vault}`), following the table-rebuild
precedent of 0228/0229. One observation row per admitted asset per rail.

## 4. API changes by site

- **Registry reader** (new `reward-settlement-asset-registry.ts`): async
  control-plane lookup with bounded cache + invalidation; **fail closed**
  when the registry is unreachable (writes/quotes/payouts error; reads
  degrade per existing read flags). Replaces the two canonical maps and
  #1318's `tokenDecimals: 6, tokenSymbol: "USDC"` literals in
  `reward-campaign-config.ts`; readiness checks
  (`reward-campaign-settlement-readiness.ts`,
  `assertRewardsCampaignAndSettlementChainsMatch`) consult registry + rail.
- **Decimals conversion module** (single home, driven by the snapshotted
  descriptor; exact scaling, `decimals >= 2` precondition). Replaces all
  eight hardcoded sites: `reward-campaign-service.ts` (quote atomic),
  `reward-cashout-service.ts` (capacity),
  `reward-campaign-solvency-monitor.ts:10`, `reward-payout-fairness.ts:6`,
  `reward-pool-refund-readiness.ts:4`, `reward-vault-refund-policy.ts:17`
  (+ whole-cent rule generalized to smallest-display-unit),
  `operator-chain-real.ts:147,482` (+ `decimals()===6` on-chain guard becomes
  `=== snapshot`), `ops-wallets.ts:156-157` display.
- **Cashout partitioning**: `currentBalanceCents(userId)` →
  `currentBalanceCents(userId, asset)`; cashout request resolves the asset
  from the recipient/context (while one asset is admitted, default is
  unambiguous); payout creation writes the 0237 snapshot; allocation
  confined; single-inflight per asset.
- **Solvency/capacity**: monitor writes one row per admitted asset (liability
  SQL is already triple-scoped); `assertRewardSolvencyAdmission` and the
  fairness reader key by the payout/funding asset.
- **Execution**: EOA rail — token address/decimals already parameterized
  except the two multiplication sites and guard (above). Vault rail —
  per-token vault address/policy from the rail binding; no encoding change.
- **Public surface**: expose the asset descriptor on the campaign resource
  and cashout resource serializers; capabilities endpoint reports admitted
  assets; create-campaign gains an optional asset selector that must equal
  the single admitted asset until multi-asset is flagged on. OpenAPI
  (`rewards.yaml`) documents terms v5's asset coverage; reference fields per
  API standards (`chain_id`/`token_address` already conform).
- **Flags**: `REWARDS_MULTI_ASSET_ENABLED` (fail-closed master gate: until
  enabled, every path asserts the single admitted asset), and per-asset
  status enforced from the registry. Existing kill switches unchanged.

## 5. PR sequence

Each PR is narrowly reviewable; core-first, pin+fixture in the same commit,
ledger-verify before Worker deploy.

1. **Core 0235** — registry + rail tables, USDC seeded, `usd_par` only.
   Non-USDC activation prohibited.
2. **API** — pin+fixture sync; registry reader; readiness/config rewiring.
   USDC-only behavior preserved (one admitted asset).
3. **Core 0236 + API** — reward-event asset identity, legacy mapping
   convention + backfill script, partitioned balances.
4. **Core 0237 + API** — payout effect snapshot, allocation confinement
   trigger, per-asset single-inflight.
5. **Core 0238 + API** — funding-effect descriptor snapshot.
6. **API** — decimals conversion module across the eight files.
7. **Core 0239 + API** — per-asset solvency + vault-capacity observations;
   gate/fairness readers.
8. **API/ops** — EOA multi-asset execution; then per-token vault deployment
   + rail binding (no contracts change).
9. **API** — admission/suspension/retirement operator workflow (0195
   evidence store retained); retired-asset refund path in the refund
   reconciler; funded-inventory refunds (D4 — **blocked until the refund
   product policy is ratified**).
10. **Staging proof per new rail** — admit a Sepolia USD-par test token,
    scripted funding leg (closes the rehearsal gap: `run-lifecycle.ts`
    currently requires a pre-funded campaign), full money loop,
    suspension/depeg drill, retirement drill with refunds. Production
    admission is itself a registry migration PR — only after all gates are
    deployed and proven, and only after the D4 policy prerequisite in
    section 2 is fully satisfied.

Dependencies: 1→2; 2→3→4; 2→5; 6 after 3 (conversion needs descriptors
everywhere); 7 after 5; 8 after {4, 6, 7}; 9 after 2 plus the D4 policy
ratification; 10 last per rail.

## 6. Test plan (per PR, matching repo gates)

Fixture sync each pin bump (api-core parity); pg-harness migration list
extended per migration; new pg coverage for cross-asset allocation rejection,
per-asset single-inflight, per-asset solvency gating; route tests for asset
exposure and selector validation; conversion-module unit tests across
decimals ∈ {2, 6, 8, 18} and rejection of decimals < 2 at admission;
retirement/refund pg tests; staging rehearsal artifacts archived per the
existing fixture-audit convention.

## 7. Explicit non-goals

Arbitrary/user-submitted tokens; priced or volatile assets; atomic-native
campaign economics; cross-asset payouts; vault contract changes; any change
to the merged #1318 guarantees.

## 8. What would invalidate this spec

A requirement for non-USD-par assets (reopens D1 → oracle/pricing design); a
requirement for one payout spanning assets (reopens D2); a vault contract
change (reopens D5 → contracts repo involvement).
