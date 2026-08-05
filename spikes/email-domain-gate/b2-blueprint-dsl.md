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
to store only `HMAC(server_secret, commitment)`.

The precise security cost of option 2 is narrower than operator privacy. Pirate
operators are already able to enumerate likely addresses because the specified
application salt must be available to the prover. Removing that salt leaves
operator deanonymization, database-breach containment, and isolation from
ordinary users/communities unchanged. It adds two risks whenever the raw digest
escapes:

- anyone can dictionary-attack the unsalted digest using candidate email
  addresses; and
- another zk.email application hashing the same extracted From value can join
  its user set with Pirate's.

Consequently, keeping the digest transient and off-chain is a security control,
not merely logging hygiene. It must be sent only in a request body over TLS,
must never appear in URLs/query parameters, logs, traces, analytics, Sentry
events or breadcrumbs, and must never be echoed by the API. The API should
immediately derive `HMAC(server_secret, digest)`, persist only that value, and
discard the digest with the request/proof payload.

### Dedup normalization prerequisite

The generated-project experiment must also establish exactly which bytes
`isHashed` commits to. The API receives only the digest, so it cannot normalize
the mailbox before applying its HMAC. If the circuit hashes the raw header form,
differences in display names, mailbox/domain casing, comments, folding, quoting,
or encoding may create different nullifiers for the same mailbox.
This is an active Sybil vector: a mailbox owner who can make the provider sign
those variants can bind each digest to a different Pirate account.

Before option 2 can support a "one proven mailbox ↔ one Pirate account"
claim, the extraction must demonstrably hash one canonical mailbox value. At a
minimum, the experiment must compare equivalent headers such as
`Alice <A@Acme.com>` and `<A@acme.com>` and document whether local-part casing is
intentionally byte-exact while the domain is canonicalized. If the hosted
circuit cannot perform that canonicalization, its dedup guarantee is only over
the exact extracted byte string and option 2 needs another product/security
decision. The same applies to provider aliases such as plus-addressing: treating
them as distinct is compatible with an affiliation badge, but not with a claim
that the domain proof itself supplies one-person-one-account resistance.

Before blueprint generation, collect same-mailbox work→personal samples with
different permitted From presentations. This cheaply determines whether the
current provider canonicalizes, rejects, or signs the variants. A canonicalized
result narrows risk for that provider/configuration only; arbitrary gated
domains still require an in-circuit rule or an explicit badge-only semantic.

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
inspect its generated project/public signals. Test the normalization-equivalence
cases above, not only one well-formed address. Separately prototype the
lower-level dynamic-domain verification wrapper and prove that changing the
asserted domain makes verification fail.
