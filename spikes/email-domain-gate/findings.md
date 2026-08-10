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

## Passive DNS survey limits and Workspace fallback policy

Known-selector DNS probes are useful for prioritizing corpus collection, but
they cannot measure gate compatibility by themselves. Workspace documents
`google` as the recommended default while allowing a different selector;
therefore a miss is not proof that aligned DKIM is absent. A published record
can be stale or not activated, and records for multiple providers do not reveal
which outbound path is active. M365 documents fixed `selector1` and `selector2`
hostnames, making that fingerprint more complete, but still not proof of active
aligned signing. DMARC publication is not a substitute because DMARC can pass
through SPF alone.

The observed Workspace fallback `d=` embeds a hyphen-mangled representation of
the From domain plus provider-controlled suffixes. It is not accepted as a
launch alignment rule. The convention is undocumented as an authorization
contract, the mangling is not injective across all valid domain spellings, and
there is no published guarantee that allocation and rotation preserve the
binding required by this gate. Accepting it would replace strict DKIM alignment
with provider-specific trust. It remains a possible research compatibility
extension only if the provider documents the invariant or an adversarial study
establishes a safe, collision-resistant rule.

The spike now includes `survey-dkim-dns.mjs` for a labeled, non-identifying
fingerprint survey. A target population and sampling rule must be chosen before
using its aggregates as product evidence. Cryptographically verified messages
remain the provider-matrix ground truth.

The harness reproduced the initial five-domain seed observation on 2026-08-10:
four default Workspace-selector fingerprints, one M365-selector fingerprint,
and five DMARC records, with no resolver errors. This is a tooling check only.
The tiny, recognizable, hand-picked set is not a defined target population and
supports no general compatibility percentage.

## Client-side compatibility pre-flight

The product should invert compatibility discovery at the user boundary rather
than extrapolate from a hand-picked domain survey. Before session issuance, a
user may select an existing raw email for a local advisory check. The browser
must cryptographically verify the authenticated selected headers against DNS
under the same header-only policy as the circuit, then check strict alignment,
signed-field coverage, algorithm, canonicalization, and export fidelity. Body
hash integrity is reported separately and does not gate compatibility. Reusing
only the structural inspector would be insufficient: the Proton export control
already demonstrated that intact-looking DKIM headers can also fail header-only
cryptographic verification.

The result is path-specific, not automatically domain-wide. An externally
delivered email from the same work mailbox through the same sender path,
exported by the intended personal client, is strong evidence. Mail from another
address at the same domain may use different infrastructure; internal delivery
may omit DKIM; forwarding and recipient export can rewrite signed bytes. Those
cases must be labeled weak evidence or inconclusive rather than "unsupported
organization."

The fresh ceremony email receives the same local compatibility check before
the expensive proving step. That is the authoritative compatibility result for
the actual message and prevents a late unexplained proof failure. The optional
old-email pre-flight remains nonce-free and cannot mint a capability. Raw email
never leaves the browser. Failed pre-flight telemetry is off by default because
reporting it would reveal a user's possible affiliation and verification intent
even when they never complete the gate.

The pre-flight, fresh-message check, and future API post-proof enforcement must
consume one shared pure policy module. Only evidence acquisition differs. This
prevents the structural-versus-cryptographic drift already observed in the
corpus from recurring at the product-policy layer. The spike module is an
explicit exception to the no-product-work rule: it remains local and unstyled,
with no gate-builder/API integration or deployment while circuit correctness
and proving cost remain unresolved.

Advisory browser verification necessarily performs a network lookup for the
DKIM key. It must query a neutral public DoH resolver directly rather than a
Pirate endpoint. The resolver learns the user's network address and `{d,s}`
query, while Pirate learns nothing from an abandoned pre-flight. This resolver
is not trusted for authorization: an incorrect answer can only change the local
recommendation, because the real proof path independently resolves and pins the
key server-side.

The installed ZK Email helper's default HTTP resolver queries two public DoH
providers and compares their results. The browser adapter must not inherit that
behavior silently: it would expose the same candidate `{d,s}` query to two
parties. The spike requires explicit resolver injection and one disclosed
neutral resolver for advisory checks. Production resolver selection remains a
reviewed privacy/availability choice, not an SDK default.

Expired signer `x=` is part of the shared conformance suite. Under the committed
record-only policy it remains compatible when the authenticated selected
headers satisfy all other obligations; expiration is a warning, not a failure.

The spike-local pure policy core is now implemented in
`compatibility-policy.mjs`. It owns exact domain comparison, required signed
headers, supported algorithm/canonicalization, record-only signer time,
header-only body handling, and deterministic first-eligible signature
selection. The verifier adapter supplies raw evidence and the post-proof adapter
requires proof verification plus a pinned-key match before policy evaluation.
The module ignores the verifier's older derived `gate_usable` fields so they
cannot become a second policy implementation.

The private corpus harness no longer reads ignored cached result JSON. It
regenerates Python evidence into a restricted temporary directory, runs the
JavaScript adapter over the same raw message and observation time, asserts exact
normalized-evidence equality, evaluates policy, and deletes the temporary
evidence. All six samples currently agree across adapters and produce three
compatible expired-signature cases, one strict-alignment incompatibility, one
invalid-header-signature inconclusive case, and one no-signature inconclusive
case.

A separate fully synthetic expired-signature conformance run generates its
message and key evidence at runtime, compares both adapters, and is runnable
from a clean checkout after installing pinned Python dependencies. Synthetic
tests additionally cover body-only rewriting, missing signed headers,
unsupported algorithm/canonicalization, malformed domains, multi-signature
selection, cross-context consistency, and post-proof fail-closed behavior.

The JavaScript adapter now requires resolver injection, performs header-only and
full-body verification with a per-run DNS cache, extracts raw policy facts, and
offers a single-endpoint HTTPS DoH resolver with sanitized errors. A fresh
Chrome session verified a runtime-generated expired synthetic signature,
returned `compatible` with `signer_expiration_ignored`, made zero unexpected
network requests, and emitted no console errors.

The released helper is not a drop-in browser module. Its Node `crypto` and
`stream` imports require explicit `crypto-browserify` and `stream-browserify`
build mappings, and its parser references a global `Buffer`. Its exported
`writeToStream` helper and the browser writable-stream backpressure path stalled
without completing; calling the same verifier's `writeAsync` and `finish`
parser methods directly completed and preserved exact Python/JavaScript evidence
parity. With those explicit compatibility choices the smoke bundle is
3,043,449 bytes (approximately 3.04 MB) unminified. This records adapter bundle
overhead only; it does not answer the still-blocked proving-time/memory Q3. No
production integration has started.

## Received-mail coverage method

The hand-picked-domain survey cannot support a compatibility percentage. The
spike now has an aggregate-only alternative over a local MBOX export from an
opt-in mailbox. It streams message headers without retaining bodies and uses
only DKIM results stamped contemporaneously by an explicitly trusted receiving
`authserv-id` (`mx.google.com` for Gmail exports). It compares the recorded
passing `header.i`/`header.d` domain with From, reduces repeated correspondence
to one best observed category per From domain, and makes zero network requests.
This is appropriate for a coverage statistic and is never authorization
evidence. No archive has been scanned yet.

A zero-network sanity check over the two existing Gmail-delivered corpus
messages reproduced the cryptographic ground truth exactly: one strictly
aligned case and one Workspace provider-fallback case. The parser uses only the
first matching trusted receiver result, so a lower sender-injected header with
the same `authserv-id` cannot override the receiver's prepended verdict under
the measured Gmail export ordering.

This is a real correspondence distribution but not a census: the mailbox is
sector-, geography-, relationship-, and receiver-biased, and the human-mail
filter is heuristic. A best-observed domain verdict estimates whether at least
one observed path works; it does not prove every mailbox or tenant path works.
The report includes the bulk-inclusive and human-candidate rates side by side so
mass-mail hygiene inflation is measurable rather than assumed. Trusting the
recipient's stored verdict avoids both DKIM-key-rotation false negatives and a
DNS-query correspondence leak. A separately consented small recent subsample
can compare stored verdicts with live cryptographic verification; that networked
validation is not part of the aggregate run.

`Feedback-ID` is deliberately not an automation filter: the measured
human-composed Proton-to-Gmail message carries it. Treating it as bulk would
have removed a known valid correspondence path and biased the filtered rate.

### Provisional six-month Gmail archive result

Observed 2026-08-10 over an explicitly supplied local Gmail Takeout MBOX, with
`since=2026-02-01` and trusted receiver `mx.google.com`. The tool made zero
network requests. The raw ZIP was not modified; its temporary extraction was
deleted after the run. The ignored aggregate result is mode 0600.

| Population | Messages | Unique From domains | Aligned | Workspace fallback | Other unaligned | Alignment rate |
|---|---:|---:|---:|---:|---:|---:|
| All received after date/folder/From validation | 51 | 11 | 9 | 0 | 2 | 81.82% |
| Header-filtered candidate after strong bulk/automation filters | 39 | 8 | 8 | 0 | 0 | 100% |

Of 92 scanned messages, 39 were outside the date window, 2 were excluded by
mailbox folder labels, and 12 recent received messages were removed from the
human-candidate population by strong list/bulk signals. Every included domain
had a trusted receiver DKIM result; there were no missing verdicts, no recorded
DKIM failures, and no no-DKIM cases.

The headline is **8 of 8 header-filtered domains aligned**, not "100% coverage."
Eight domains is too small to distinguish near-universal support from a merely
common configuration: if the true alignment rate were 80%, observing 8 of 8
would still occur about 16.8% of the time. The mailbox is also correspondent-,
sector-, geography-, and receiver-biased. Domain reduction records the best
observed path, so it answers "did at least one observed human-mail path align?"
rather than "will every mailbox/configuration at this organization align?"

The export's 92 total messages over six months is unexpectedly small for a
normally used Gmail mailbox, and the absence of any missing/no-DKIM/failed DKIM
verdict strengthens the possibility that the Takeout was label-restricted or
otherwise partial. Before this rate is cited externally, compare the source
mailbox count for the same window with 92. If materially larger, classify this
run as a partial non-random sample and rerun a complete export. If comparable,
record that the source mailbox itself is low traffic and keep the resulting
population limitation prominent.

In this provisional sample the anticipated bulk-mail hygiene inflation did not
occur: both unaligned domains were in the bulk-inclusive population and
disappeared under the human filter. Reporting both populations remains
necessary because the direction of that bias cannot be assumed.

Provisional interpretation: the sample provides no evidence that strict
alignment is rare, but it is too small and potentially incomplete to establish
a reliable coverage rate. It therefore does not kill either the local-ZK or
attested-dead-drop architecture, does not resolve their employer-disclosure or
vendor-attestation decision axes, and does not replace the planned configured
Workspace/M365 provider matrix.

### One-year Proton archive result

Observed 2026-08-10 over an explicitly supplied Proton Export Tool directory,
with `since=2025-08-10` and trusted receiver `mail.protonmail.ch`. The survey
streamed 5,756 EML files, used Proton sidecar label/reply metadata, made zero
network requests, and emitted aggregate counts only.

| Population | Messages | Unique From domains | Aligned | Workspace fallback | Other unaligned | DKIM not passed | Alignment rate over all domains |
|---|---:|---:|---:|---:|---:|---:|---:|
| All received | 5,686 | 143 | 81 | 2 | 54 | 1 | 56.64% |
| Loose header-filtered | 5,325 | 107 | 61 | 2 | 43 | 1 | 57.01% |
| Replied-to, after header/folder filters | 27 | 7 | 5 | 0 | 1 | 1 | 71.43% |

The folder-aware pass excluded 69 Sent/Draft/Spam/Trash messages, 360 messages
with strong list/bulk signals, 1 automated message, and 1 message with an
ambiguous/missing From domain. The first Gmail-oriented pass incorrectly called
the 5,325-message loose subset "human candidate"; Proton's inbox composition
shows that header exclusions alone are far too weak for that claim. The output
and documentation now call it header-filtered.

The replied-to population is higher precision for person-to-person
correspondence because the mailbox owner actually answered, but it is only 7
domains and is biased toward conversations worth answering. Its 5-of-7 aligned
result demonstrates both real compatibility and a real non-aligned human path;
it cannot establish a general rate. The broad 81-of-143 result is separately
useful: strict alignment is neither rare nor universal across actual received
domains, and a launch must expect a meaningful unsupported-domain population.

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
