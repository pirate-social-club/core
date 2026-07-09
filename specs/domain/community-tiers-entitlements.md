# Community Tiers and Entitlements

Status: current working spec — direction agreed in design review; not yet implemented

Related docs:

- [community-gate-builder.md](./community-gate-builder.md)
- [community.md](./community.md)
- [handles.md](./handles.md)
- [identity-presentation.md](./identity-presentation.md)

## Purpose

Map gate outcomes to durable entitlements — name claims
(`name.hnstld1` / `name@space1`), member badges, labels — via first-class
tiers. Today join is strictly boolean: evaluation produces
`satisfied` + trace, and nothing records WHICH branch admitted a member.
Encoding tiers inside one boolean expression cannot work: enforce-mode OR
short-circuits at the first passing child, so "which branch passed" is
order-dependent and unreliable.

Motivating case: a community whose members hold tiered NFTs — Charizard
holders claim `name.hnstld1` and a Charizard badge; Gengar holders claim
`name.hnstld2` — with different labels inside the same community.

## Model

```
tier = {
  id,
  version,
  label,
  priority,
  expression,     // a GateExpression — same vocabulary as gate policies
  entitlements[]
}
```

- The tier system is agnostic to rule kinds. A tier granted by a Courtyard
  trait rule, a BAYC collection rule, a personhood proof, or a wallet score
  is structurally identical. If a tier design needs to know its expression
  contains a specific atom type, eligibility and entitlements have been
  tangled again.
- Tiers are evaluated independently, in priority order; highest priority
  passing tier wins. This is why tiers are separate expressions rather than
  branches of one tree.
- Join eligibility = any tier passes (whether tiers fully replace the base
  gate policy or compose with it is open).
- The awarded tier is recorded on the membership row.

## Entitlements

- Name-claim template (Handshake TLD / spaces form) — integrates the handles
  rail.
- Member badge / label rendered within the community.
- The list is extensible; entitlements are declarative data on the tier.

## Validity is tier-specific, not asset-specific

Renewal asks "does the member still satisfy the tier expression?" — never
"do they still hold the same token ID?" Selling one Charizard and buying
another must not break a claim. Normal collecting behavior is not hostile.

## Liveness: revalidate-on-renewal (default policy)

Enforcement cost and attack surface scale with entitlement durability. For
scarce, durable, visible entitlements (names):

- **Keep-forever: rejected.** Zero infra but gameable — borrow or briefly
  hold a qualifying asset, claim the name, dispose of the asset
  (flash-claim; NFT rental markets make this cheap).
- **Revoke-on-loss: rejected.** Requires continuous watchers per asset class
  plus a revocation flow for an actively-used identity (mid-cycle identity
  rug). Operationally heavy, socially nasty.
- **Revalidate-on-renewal: default.** Re-evaluate the tier expression at the
  renewal epoch. Bounded staleness (one renewal period), no watchers, no
  mid-cycle revocation. Precedent already in the system: `unique_human`
  capabilities expire after 90 days into `reverification_required`.

Grace period on failed revalidation: the name does not release instantly —
N-day notice window to re-qualify, then the name returns to the tier's pool
(N open). Courtyard physical redemption (token burned/moved on withdrawal)
needs no special case: it fails the next revalidation exactly like a sale.

## Provenance snapshot (recorded at claim time)

Recorded for every entitlement grant; cheap to record now, impossible to
reconstruct later; required for policy changes and disputes:

- tier id + tier version
- expression version used at claim time
- evaluator/provider used
- timestamp
- minimal qualifying evidence summary

Evidence minimality: for on-chain NFTs, token IDs are public anyway. For
custody assets (Courtyard), store a provider proof id or hashed evidence
blob — do NOT expose raw token IDs or full inventory in app payloads.

## Open questions

- Mid-cycle upgrades: member acquires a higher tier's qualifying asset —
  on-demand re-evaluation, or wait for renewal?
- Tier expression edits: versioning semantics; are existing members
  grandfathered until their next renewal?
- Relationship to existing handle pricing tiers (`HandleUpgradeQuote`) —
  reuse, integrate, or keep orthogonal?
- Tiers-only communities vs tiers composing with a base gate policy.
- Migration path for existing single-policy communities.
- Renewal epoch source: Handshake-style name renewal cycle vs a
  platform-defined revalidation interval for non-name entitlements (badges).
