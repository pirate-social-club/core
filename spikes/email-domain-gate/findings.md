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

| Artifact | Structural result | Cryptographic result | Decision |
|---|---|---|---|
| Proton custom-domain self-send, exported from Proton | no DKIM header | not applicable | self-send ceremony fails for this provider |
| Proton custom-domain → Gmail, exported from Gmail | pass | **pass** | work→personal ceremony viable for this provider pair |
| Gmail → Proton custom-domain, exported from Proton | pass | **fail** | Proton export is not byte-faithful enough for proving received mail |

Header presence proves only that a DKIM-shaped header survived export; it does
not establish message fidelity. The self-send artifact contains no signature at
all, while Proton does preserve a DKIM header when one existed on an externally
received message. Internal delivery bypass remains the leading explanation for
the self-send result, but it is not direct wire-level proof. This Proton result
does not resolve Workspace or M365 behavior.

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
