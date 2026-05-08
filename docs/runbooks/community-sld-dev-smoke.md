# Community SLD Dev Smoke Runbook

This runbook gates the first live community SLD pilot. It must be completed in dev or staging before enabling paid claims for any production country community.

The current v1 flow issues app-internal community handles only. It proves:

- quote creation
- Base Sepolia USDC funding verification
- claim insertion
- `/handles/me`
- admin list, reserve, and revoke

It does not prove external DNS, HNS, or Spaces subdomain resolution unless a separate subdomain issuer is explicitly wired to the claim path and tested separately.

## Scope

- Environment: dev or staging only.
- Community: a dedicated private test community, not a public country space.
- Suggested display name: `SLD Smoke Test`.
- Suggested namespace/root: a dev-only root controlled by the operator, such as `sldsmoke`.
- Users:
  - one admin/operator
  - member A with wallet
  - member B with wallet
  - one non-member
- Payment rail: Base Sepolia USDC.
- Pricing:
  - standard: `500` cents
  - short premium: `2500` cents
  - premium cutoff: `4`
  - special labels as needed

## Manual Refund Procedure

This procedure covers the v1 paid-race gap: payment can be verified, then the claim can fail because the label became unavailable before the write transaction committed. The system preserves data consistency and leaves the losing quote in `quoted`, but it does not automatically credit or refund the user.

Before running smoke:

1. Identify the operator wallet that receives Base Sepolia USDC.
2. Confirm who controls refund signing for that wallet.
3. Confirm the wallet has enough Base Sepolia ETH for USDC refund gas.
4. Confirm the source of truth for refund approval: the audit artifact plus on-chain tx.
5. Confirm where refund tx hashes will be recorded.

Refund eligibility:

- Claim request used a valid quote for the smoke community.
- Funding tx sent the quoted USDC amount to the configured operator wallet.
- Funding verification logs show the tx was accepted.
- Claim response failed for a non-payment reason, such as `409 conflict` with `availability: taken` or `availability: reserved`.
- No active handle was issued for that quote.

Refund steps:

1. Record the quote id, desired label, user id, wallet attachment id, buyer wallet address, funding tx hash, amount, and claim error.
2. Confirm the quote row is still `quoted`.
3. Confirm no `community_handles` active row exists for that quote id.
4. Send the same USDC amount from the operator wallet back to the buyer wallet on Base Sepolia.
5. Record the refund tx hash in the audit document.
6. Mark the incident as resolved in the smoke notes.

Do not ask the user to submit another payment for the same smoke unless the refund decision is explicitly recorded.

Production gate:

- This procedure must be accepted by the operator before production pilot.
- If automatic refund or credit support is required, do not proceed to production pilot until that work exists.

## CLI Setup

Use the API CLI for namespace and community setup once a staging/dev user session is available.

From the workspace root:

```bash
rtk bun --cwd api/services/cli src/index.ts auth login \
  --base-url https://api-staging.pirate.sc \
  --jwt "<operator-upstream-jwt>"
```

Confirm the stored session:

```bash
rtk bun --cwd api/services/cli src/index.ts auth me
```

Start namespace verification:

```bash
rtk bun --cwd api/services/cli src/index.ts verify namespace start sldsmoke
```

Namespace family is inferred from the submitted root string everywhere:

- `sldsmoke` is HNS.
- `@sldsmoke` is Spaces.

Complete namespace verification after the required HNS/Spaces proof is published:

```bash
rtk bun --cwd api/services/cli src/index.ts verify namespace complete <namespace-session-id>
```

Create the private smoke community through the API. The current CLI `community create` helper creates an open community, so do not use it for this private smoke unless it has been extended with a membership-mode flag.

```bash
curl -sS -X POST https://api-staging.pirate.sc/communities \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <pirate-access-token>" \
  -d '{
    "display_name": "SLD Smoke Test",
    "membership_mode": "request",
    "governance_mode": "centralized",
    "default_age_gate_policy": "none",
    "allow_anonymous_identity": false,
    "handle_policy": {
      "policy_template": "premium",
      "pricing_model": "flat_by_length"
    },
    "namespace": {
      "namespace_verification": "<namespace-verification-id>"
    }
  }'
```

## Preflight

Confirm environment:

- `PIRATE_CHECKOUT_TX_WAIT_TIMEOUT_MS=20000`
- checkout chain id resolves to `84532`
- checkout chain name resolves to `Base Sepolia`
- USDC token address is the intended Base Sepolia USDC
- operator recipient address is correct
- RPC endpoint is healthy
- API and web deployments point at the same environment

Confirm database state:

- control-plane migrations are current
- community DB migrations are current
- `namespace_bindings.status = active`
- `namespace_handle_policies` row exists
- `community_handles` exists
- `community_handle_claim_quotes` exists
- unique indexes exist for active/blocking namespace-label claims

Confirm API state with all accounts:

- admin `/handles/status`: `available: true`, `claims_enabled: true`, namespace present
- member A `/handles/status`: `available: true`, `claims_enabled: true`, namespace present
- member B `/handles/status`: `available: true`, `claims_enabled: true`, namespace present
- non-member `/handles/status`: `available: false`, reason is membership required

Stop here and checkpoint before configuring policy.

## Policy Configuration

Set:

```json
{
  "claims_enabled": true,
  "policy_template": "premium",
  "pricing_model": "flat_by_length",
  "settings": {
    "flat_price_cents": 500,
    "premium_price_cents": 2500,
    "premium_max_length": 4
  }
}
```

Capture the full policy response as the first audit artifact.

## Happy Path Smoke

1. Member A calls `/handles/status`.
2. Member A quotes a standard label, for example `alice`.
3. Confirm:
   - `eligible: true`
   - `price_cents: 500`
   - `pricing_tier: standard`
   - payment instructions use Base Sepolia USDC
   - recipient is the operator wallet
4. Member A sends exact Base Sepolia USDC.
5. Member A claims with `funding_tx_ref`.
6. Confirm:
   - claim returns an active handle
   - quote status is `claimed`
   - handle stores `funding_tx_ref`
   - `/handles/me` returns the same handle
   - admin `GET /handles?status=active` includes the handle
   - admin `GET /handles` includes the handle

## Concurrent Claim Smoke

This validates the two-db-open claim flow and the database uniqueness boundary under real contention.

Use member A and member B with distinct wallets.

1. Member A quotes the same paid label as member B.
2. Member B quotes the same paid label as member A.
3. Both users send exact Base Sepolia USDC for their own quote.
4. Fire both claim requests as close together as practical.
5. Expected result:
   - one claim succeeds
   - one claim returns `409 conflict`
   - losing response has blocking availability such as `taken` or `reserved`
   - losing quote remains `quoted`
   - exactly one active `community_handles` row exists for the label

If the loser paid and received no handle, execute the manual refund procedure above.

## Admin Revoke Smoke

1. Admin revokes the active handle.
2. Confirm revoke response returns `status: revoked`.
3. Re-quote the same label.
4. Expected result:
   - `eligible: true`
   - `availability: available`

Revoked labels are released for re-claim in v1. The claim-blocking set is `active` and `reserved`; revoked handles remain visible in admin lists for audit/history.

## Failure Smoke

Run these in order:

1. Non-member quote:
   - expect `403`
   - reason is membership required
2. Claims disabled:
   - `/handles/status` returns unavailable
   - quote is blocked
3. Bad or underfunded tx:
   - claim fails cleanly
   - quote remains `quoted`
4. Valid payment but non-payment conflict:
   - claim fails with conflict
   - quote remains `quoted`
   - manual refund procedure is followed if funds moved
5. RPC timeout:
   - if safe, temporarily lower `PIRATE_CHECKOUT_TX_WAIT_TIMEOUT_MS` in dev to force timeout
   - otherwise validate from local tests and RPC-health logs
   - restore timeout to `20000`

If a first live claim times out, check RPC health before retrying. A timeout is not evidence of a DB write failure unless logs show write-path errors.

## Audit Artifact Template

```md
# Community SLD Dev Smoke Audit - YYYY-MM-DD

## Scope
- Environment:
- Community id:
- Namespace id/root:
- App-internal SLD only:
- Out of scope:

## Operator Recovery Policy
- Operator wallet:
- Refund signer:
- Refund gas confirmed:
- Required evidence:
- Refund tx recording location:

## Preflight
- Checkout timeout:
- Chain:
- USDC token:
- Operator wallet:
- RPC health:
- Namespace binding:
- Migrations:
- Admin account:
- Member A:
- Member B:
- Non-member:

## Policy
- Request:
- Response:
- Captured at:

## Happy Path
- Quote:
- settings_snapshot_json:
- Payment tx:
- Claim:
- /handles/me:
- Admin list active:
- Admin list all:
- DB quote row:
- DB handle row:

## Concurrent Claim
- Label:
- Member A quote:
- Member B quote:
- Member A tx:
- Member B tx:
- Claim response A:
- Claim response B:
- Winning handle:
- Losing quote status:
- Active row count:
- Refund or recovery action:

## Admin Revoke
- Revoke response:
- Re-quote response:
- Expected blocking behavior confirmed:

## Failure Smoke
- Non-member:
- Claims disabled:
- Bad or underfunded tx:
- Valid payment but non-payment conflict:
- Timeout or RPC behavior:

## Decision
- Pass/fail:
- Blockers:
- Production pilot approved:
- Pilot community:
```

## Production Gate

Only after this dev smoke passes:

1. Choose one real pilot country community.
2. Confirm namespace binding and migrations.
3. Enable claims for that community only.
4. Run one narrow paid smoke with an operator-controlled member.
5. Keep broader rollout blocked until that production smoke passes and refund ownership is confirmed.
