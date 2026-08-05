# B2 — Blueprint DSL expressibility desk check

**Checked:** 2026-08-05  
**Artifact:** `@zk-email/sdk@2.0.11` published npm tarball  
**Status:** partial failure — the complete protocol is not expressible as one
ordinary hosted blueprint.

This is a configuration-surface and released-source audit. It does not submit or
compile a registry blueprint.

## What the hosted blueprint can express

The released `BlueprintProps` surface provides:

- one fixed `senderDomain` per blueprint;
- header/body decomposed-regex extraction;
- public/private regex parts;
- `isHashed` on an extracted field;
- named external inputs with maximum lengths; and
- body-hash skipping.

That is sufficient to:

1. extract the signed subject nonce and compare it with the server session after
   proof verification;
2. extract the From domain publicly and compare it after proof verification;
3. extract From and To mailbox values as hashed proof outputs and compare those
   outputs after verification for the self-send ceremony; and
4. use a header-only proof (`ignoreBodyHashCheck`).

The equality checks above need not be in-circuit: equality of proof-bound public
outputs is sound when the backend verifies the proof first.

## What it cannot express

The blueprint schema has no arithmetic/composition constraint connecting a
regex extraction to an external input. In particular, it cannot compute a
stable commitment equivalent to:

```text
Poseidon(normalized_full_from_address, pirate_application_salt)
```

`isHashed` hashes an extracted field, but exposes no salt/composition control.
External inputs are separate circuit inputs; the blueprint schema provides no
operation that hashes an extraction together with one.

The ordinary SDK verification path also takes `senderDomain` from the blueprint
and verifies the proof's DKIM public-key hash against that fixed domain. This is
safe for a domain-specific blueprint, but does not directly provide one hosted
blueprint for arbitrary community-configured domains. The lower-level released
verification implementation accepts a sender-domain argument, so a custom
verifier wrapper may be able to reuse one circuit/vkey; that is outside the
ordinary `blueprint.verifyProof()` contract and requires its own security test.

## B2 verdict

The hosted DSL can support a constrained prototype with either:

- one compiled blueprint per allowed domain; or
- a custom verification wrapper that binds the asserted From domain to the
  proof's DKIM public-key hash.

It cannot implement the specified app-salted mailbox commitment. The product
must therefore choose one of:

1. custom circuit/verifier work for the full protocol;
2. accept the unsalted `isHashed` mailbox output and explicitly weaken the
   cross-application unlinkability guarantee; or
3. remove global mailbox deduplication.

Option 3 changes gate semantics and is not recommended. Option 2 may be
acceptable only if proof outputs remain off-chain/private and the API continues
to store only `HMAC(server_secret, commitment)`; it still permits linkage when
the same proof output is disclosed elsewhere.

## Additional SDK finding: Outlook fetch path

The released SDK's Microsoft login helper fetches selected Graph fields and
constructs a new message containing Message-ID, Date, Subject, MIME-Version,
Content-Type, and body. It does not fetch/preserve the original raw DKIM header.
That helper therefore cannot be assumed to produce a provable `.eml`. Manual
Outlook export remains a separate required corpus test.

## Evidence

- [Official blueprint creation documentation](https://docs.zk.email/zk-email-sdk/create-blueprint)
- [Official regex documentation](https://docs.zk.email/zk-email-sdk/regex)
- [`@zk-email/sdk@2.0.11` npm package](https://www.npmjs.com/package/@zk-email/sdk/v/2.0.11)
- [SDK source repository](https://github.com/zkemail/zk-email-sdk-js)

Released files inspected from the npm source maps/type declarations:

- `src/types/blueprint.ts`
- `src/relayerUtils.ts`
- `src/verify.ts`
- `src/blueprint.ts`
- `src/login_for_email/microsoft.ts`

## Next validation

Before declaring custom-circuit work mandatory, build a tiny domain-specific
draft blueprint using hashed From/To extractions and a public subject nonce, then
inspect its generated project/public signals. Separately prototype the
lower-level dynamic-domain verification wrapper and prove that changing the
asserted domain makes verification fail.
