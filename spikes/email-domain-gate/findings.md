# Phase A findings

Only manually reviewed sanitized metadata belongs in this file. Raw messages,
addresses, subjects, signatures, paths, and DNS keys must remain private.

Structural inspection is triage only. A sample is not a pass until its DKIM
signature verifies cryptographically against the published DNS key, including
the body hash.

## Proton custom-domain self-send

Observed 2026-07-20 from an exported same-mailbox message:

- exactly one From mailbox: yes
- exactly one To mailbox: yes
- To equals From under byte-exact-local-part and canonical-domain comparison: yes
- `DKIM-Signature` header count: **0**
- structurally complete DKIM signature: **no**

Interim conclusion: this self-send export cannot support the specified ZK proof
(no DKIM signature present). The CAUSE is not yet isolated — two confounded
explanations:

1. internal-delivery gap: same-mailbox delivery never traversed the outbound
   DKIM-signing gateway (the spec §2 hypothesis); or
2. export-fidelity gap: Proton reconstructs exports from its encrypted store and
   may strip/lose DKIM material even when the wire message was signed (zk.email
   docs warn about exactly this for Proton-received mail).

Two controls were collected:

- **Control 1 (outbound signing):** Proton custom-domain → external Gmail,
  exported from Gmail. **PASS:** one strictly aligned RSA-SHA256 DKIM signature
  covers From, To, and Subject and verifies cryptographically against the
  published DNS key, including its body hash. This proves the intended
  work→personal ceremony end-to-end for this provider pair.
- **Control 2 (export fidelity):** Gmail → the Proton custom-domain address,
  exported from Proton. **FAIL:** the exported artifact retains a structurally
  complete, aligned Gmail DKIM header covering From, To, and Subject, but
  cryptographic verification fails with a body-hash mismatch. Verification also
  fails when body-hash checking is bypassed for diagnosis, indicating that at
  least one signed header value was rewritten as well. Proton is therefore
  disqualified as the exporting/personal mailbox for this ceremony.

### Decision table

| Artifact | Header canonicalization | Signer validity window | Structural result | Cryptographic result | Decision |
|---|---|---:|---|---|---|
| Proton custom-domain self-send, exported from Proton | not applicable | not applicable | no DKIM header | not applicable | self-send ceremony fails for this provider |
| Proton custom-domain → Gmail, exported from Gmail | relaxed | 72 hours | pass | **pass** | work→personal ceremony viable for this provider pair |
| Gmail → Proton custom-domain, exported from Proton | relaxed | 7 days | pass | **fail** | Proton export is not byte-faithful enough for proving received mail |
| Workspace custom-domain → Gmail, exported from Gmail | relaxed | 7 days | pass | signature **valid**, strict alignment **fails** | tenant uses a Google fallback signing domain; enable custom-domain DKIM and recollect |

Header presence proves only that a DKIM-shaped header survived export; it does
not establish message fidelity. The self-send artifact contains no signature at
all, while Proton does preserve a DKIM header when one existed on an externally
received message. Internal delivery bypass remains the leading explanation for
the self-send result, but it is not direct wire-level proof. This Proton result
does not resolve M365 behavior or Workspace internal delivery.

## Workspace fallback-signing control

Observed 2026-08-10 from a Workspace custom-domain → Gmail message exported
by Gmail. The artifact contains one RSA-SHA256 signature with relaxed/relaxed
canonicalization and a seven-day signer validity window. The signature and body
hash verify against live DNS, From and Subject are signed, and the draft relaxed
header-regex assumption is met.

The signature is not gate-usable because its `d=` is a Google-managed fallback
signing domain rather than the custom From domain. This is evidence that the
tenant has not enabled custom-domain DKIM, not a Workspace incompatibility.
After the tenant administrator publishes the generated DKIM TXT record and
starts authentication, recollect the work→personal sample. A passing Workspace
provider result remains open until that replacement has strict `d=`/From
alignment. No identifying domain or mailbox value is recorded here.

## Proton same-mailbox From-presentation variation

Observed 2026-08-05 from two distinct Proton custom-domain → Gmail messages,
exported by Gmail. One used the account's canonical sender presentation and one
attempted a different presentation. Only sanitized comparisons are recorded:

- both messages have one strictly aligned, gate-usable DKIM signature covering
  From, To, and Subject;
- both signatures verify cryptographically against DNS, including body hashes;
- the messages are distinct (different Message-ID, Date, and Subject values);
- the signed From header values are byte-for-byte identical;
- parsed display-name presence/value and addr-spec are identical; and
- local-part bytes and canonical domains are identical.

Conclusion: this attempted variation does **not** create a second prospective
nullifier because the variant never appeared in the emitted message. This is
evidence about the Proton Web compose path only, not evidence that Proton's
signing gateway canonicalizes attacker-authored From headers. The UI may simply
have provided no per-message control. SMTP submission, Bridge, aliases, other
Proton interfaces, Workspace/M365 tenants, and arbitrary allowed domains remain
untested, so A1c remains open for Proton and globally.

Both presentation samples use relaxed header and body canonicalization. No
simple-header provider sample has been measured. The Workspace fallback control
uses relaxed/relaxed canonicalization and a seven-day signer validity window;
the custom-domain-aligned Workspace replacement and M365 sample must still be
measured before the draft regexes and provider matrix are treated as portable.
Both presentation samples use the same 72-hour signer validity window as the
primary Proton outbound sample.

## Signed To decision

To coverage was deliberately removed when the ceremony changed from self-send
to work→personal. The proof establishes no ownership of the personal recipient,
To is not extracted or disclosed, and binding it would add no claim beyond the
fresh signed session nonce. Required signed-header coverage is therefore From +
Subject. Revisit To only if a future protocol makes a recipient claim.

## Corpus expectation replay

All five recorded expectations were rerun after removing oversigning from gate
eligibility under the explicit `record-only` signature-time policy: three
passes, one cryptographic failure, and one no-signature case remain unchanged.
Present-time `enforce` mode records the three Proton positives as
`signature_expired`; it does not collapse expiration into generic signature
failure. All four signed artifacts report `relaxed/relaxed` canonicalization.

The product policy is record-only for DKIM `t=`/`x=`. The ZK circuit verifies
the signed bytes but does not parse those tags, and the fresh nonce can only be
produced after session issuance. Server session expiry therefore supplies the
actual completion deadline and prevents an archived email from being reused.

## Registry availability

On 2026-08-09, a minimal private blueprint saved successfully and advanced past
the initial registry editor before the conductor API began returning HTTP 500.
The registry frontend continued serving HTTP 200 while the unauthenticated
blueprint-list endpoint returned HTTP 500. This is currently evidence of an
availability failure, not a demonstrated blueprint capability failure.
The outage is reported upstream as
[`zkemail/registry#320`](https://github.com/zkemail/registry/issues/320).

The hosted route therefore remains the preferred compile-time experiment. It
must not become a production runtime dependency. If compilation succeeds, all
generated source, manifests, WASM, verification keys, proving-key chunks, and
their hashes must be pinned locally before offline proving is evaluated. No real
corpus email may be uploaded to the registry.
