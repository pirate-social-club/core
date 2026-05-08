# Community SLD Dev Smoke Audit - 2026-05-08

## Scope

- Environment: staging
- Community: `com_cmt_3a69b1b8d40e4bb1be2fac9dadfedfbf` (`SLD Smoke Pesto`)
- Namespace/root: Spaces `@pesto`
- Namespace verification: `nv_nv_09474c31b964482d81e03694070a1b1e`
- Namespace id: `ns_cmt_3a69b1b8d40e4bb1be2fac9dadfedfbf`
- Payment rail: Base Sepolia USDC
- App-internal SLD only: yes

## Infra

- Redeployed `community-provision-operator-staging`.
- Worker version: `0c0080b3-c513-4f08-8556-d2449cbd477b`
- Provisioning retried through `POST /communities`.
- Result: `provisioning_state: active`
- Membership mode: `request`

## Policy

- `policy_template`: `premium`
- `pricing_model`: `flat_by_length`
- `claims_enabled`: `true`
- `flat_price_cents`: `500`
- `premium_price_cents`: `2500`
- `premium_max_length`: `4`
- `quote_ttl_seconds`: `900`

## Preflight

- Admin/member status: `available: true`, `claims_enabled: true`
- Non-member status: `available: false`
- Non-member reason: `Community membership is required to claim names`
- Initial admin list: empty
- Quote instructions:
  - chain id: `84532`
  - token: `0x036CbD53842c5426634e7929541eC2318f3dCF7e`
  - recipient: `0x053228674F055FBb94d1B8118638F61a4a6ee512`

## Happy Path

- Buyer user: `usr_aa7d8af31a6c4cca82d41a27524b5ab0`
- Wallet attachment: `wal_507af1d5e2ca459fb060637d5d23e34a`
- Label: `pestoone`
- Quote: `hcq_c40a57da95af4801b35cc1e92e939c34`
- Price: `500` cents
- Payment tx: `0x8a60ca72014e3f3eb2b78188ef2c3990cbdf3da4c445f0cb9743d906035c882f`
- Claim: `ch_0263998492064f6fb343db56431b3418`
- Claim status: `active`
- `/handles/me`: returned the same handle
- Admin `GET /handles?status=active`: returned the same handle
- Admin `GET /handles`: returned the same handle

## Admin Revoke

- Revoked handle: `ch_0263998492064f6fb343db56431b3418`
- Revoke response status: `revoked`
- Re-quote label: `pestoone`
- Re-quote: `hcq_2ed7be640c0b4bff8043d51f71c9a8c0`
- Re-quote result: `eligible: true`, `availability: available`
- Finding: current deployed v1 releases revoked labels. Source agrees: claim blocking is `active` and `reserved`.

## Concurrent Claim

- Label: `racerone`
- Buyer A: `usr_aa7d8af31a6c4cca82d41a27524b5ab0`
- Buyer A quote: `hcq_3fd0c08870e844c39f7d85fde35db65a`
- Buyer A tx: `0xa0590810b480dbcf8f5cced68fa81a21948270f57a7f090fa23206e5bd6807a9`
- Buyer B: `usr_ca9c8a58ac4049219035ad7893d669c5`
- Buyer B wallet attachment: `wal_ef03547895f347fbb3693414da9fc168`
- Buyer B quote: `hcq_886cc967ef3e4c698350d1704ec0e171`
- Buyer B tx: `0x0b1ccb0d590c752716c6fa99d417cc568a58eb0ef42e2f2020282b5737197f0d`
- Claim response A: HTTP 200, active handle `ch_25616cfe8a8c4436b121368933f09d91`
- Claim response B: HTTP 409 conflict, `availability: taken`
- DB quote status A: `claimed`
- DB quote status B: `quoted`
- Active row count for `racerone`: one active handle
- Recovery: buyer B paid and received no handle.
- Refund tx to buyer B: `0xe550b618c52c4aeb80a91ae0bd0dcc3a0e72195c5b6cafc7d42d68263ad5f631`

## Failure Smoke

- Claims disabled:
  - `/handles/status`: `available: false`
  - reason: `Community name claims are currently disabled`
  - quote response: `eligibility_failed`
- Bad funding:
  - quote: `hcq_ac72e8cf9b974e9c909dd355cf6b00cc`
  - claim response: HTTP 400
  - message: `Funding transaction did not deliver enough USDC to the checkout operator`
- Already has handle:
  - buyer A quote for `secondone`
  - response: HTTP 200
  - `eligible: false`
  - `availability: viewer_has_claim`
  - reason: `You already have an active name in this community`

## Findings

- `cast send` on Base Sepolia returned a receipt deserialization error (`missing field feePayer`) after successful transactions. The receipts showed `status: 0x1`, and API verification accepted the funding txs.
- The pre-existing staging smoke buyer wallet is attached to multiple legacy staging users. The smoke used the latest returned attachment for buyer A rather than creating another duplicate.
- Revoked label semantics in live code are release-for-reclaim, not permanent blocking.

## Decision

- Staging smoke result: pass with findings.
- Production blocker: manual refund ownership must be accepted before any paid pilot.
- Production pilot recommendation: one community, one operator-controlled member, one paid claim, no broader rollout until that passes.
