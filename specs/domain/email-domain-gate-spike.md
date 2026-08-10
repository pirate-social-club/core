# Email-Domain Gate via ZK Email — Feasibility Spike Spec

**Status:** SPIKE APPROVED — no provider plumbing, no gate UI until go/no-go passes.
**Date:** 2026-07-20 (audit converged over three review rounds)
**Owner:** TBD
**Scope:** Prove or refute that Pirate can gate communities on "member controls a mailbox at `acme.com`" using a DKIM-based ZK proof (`@zk-email/sdk` + a custom registry blueprint), without the address ever reaching Pirate.

**Architecture fork (decision pending):** an attested SMTP dead drop could
replace the export/local-proof ceremony, improve operator privacy with a
TEE-held HMAC, and eliminate proving/export risks. It would also disclose a
verification-service recipient to employer logs and make vendor attestation
plus always-online SMTP a trust root. This is not authorized as an
implementation or launch fallback. Decide one path using
[`architecture-fork-local-zk-vs-tee.md`](../../spikes/email-domain-gate/architecture-fork-local-zk-vs-tee.md);
do not ship a hybrid.

---

## 1. What the gate asserts

A new gate atom (future work, not this spike):

```ts
| { type: "email_domain"; provider: "zk_email"; allowed_domains: string[] }
```

The proof establishes, at verification time only:
- the prover can **send** from some mailbox whose From-domain is exactly `D` (DKIM `d=` == From domain, strict alignment);
- a deterministic mailbox digest for best-effort global deduplication; this is
  defense-in-depth, not the gate's anti-Sybil boundary (see §3 and Q4);
- freshness and intent, via a server-issued single-use challenge.

It does **not** assert current employment (point-in-time only; mitigated by capability TTL, default 90d) and does **not** hide the mailbox from every adversary (see §3).

## 2. Protocol (converged)

**Optional advisory pre-flight (before session start).** A user may select an
existing raw email locally to learn whether the observed sending/export path is
likely compatible before beginning the ceremony. The browser must parse and
cryptographically verify the DKIM header signature against DNS under the same
header-only policy as the circuit, then check strict `d=`/From
alignment, From/Subject coverage, supported key algorithm, export fidelity, and
canonicalization compatibility. Body-hash integrity is reported separately but
does not gate a header-only proof. Header presence or a matching unverified
`d=` is insufficient. No nonce or proof is required because this step mints no
capability and has no security authority. Confidence is explicit: an old
external message from the same work mailbox, sent through the same outbound
path and exported by the intended personal client is strong path evidence; a
message from another mailbox at the domain is only weak domain evidence;
internal delivery, forwarding, mailing lists, and rewriting exporters can cause
false negatives. Return `compatible`, `incompatible`, or `inconclusive` with a
local explanation, never an organization-wide claim. Raw email stays in the
browser. Do not send pre-flight results or domains as product telemetry by
default; any future aggregate measurement requires separate privacy review and
explicit consent because failed attempts reveal affiliation and intent.

**One policy, three evidence adapters.** Compatibility predicates and
deterministic signature selection live in one pure shared policy module. The
optional pre-flight adapter supplies locally verified email evidence; the fresh
ceremony adapter supplies the same evidence before proving; the future API
adapter supplies verified proof outputs plus the pinned circuit/session facts.
Adapters may establish facts differently, but must not reimplement alignment,
signed-header, algorithm, canonicalization, or signer-time policy. The same
normalized evidence must produce the same verdict in every path, and the private
corpus plus synthetic fixtures are the shared module's conformance suite.

**Advisory DNS privacy.** Browser verification requires a DKIM key lookup. The
pre-flight uses one explicitly selected neutral public DNS-over-HTTPS resolver
directly from the browser, not a Pirate endpoint, so Pirate does not learn candidate domains from
users who abandon verification. The resolver observes the user's network
address and the queried `{d,s}` name; disclose that dependency. A poisoned or
incorrect advisory response can only misrecommend compatibility and cannot mint
a capability. The real ceremony still resolves and pins the key server-side
under §4 before accepting a proof. Do not inherit the installed helper's default
dual-resolver lookup, which discloses the query to two providers; the adapter
must inject the selected resolver explicitly.

1. **Session start.** API issues an opaque random nonce (≥128 bit) + server-side session record `{user_id, session_id, audience/env, purpose, expires_at}`. All transcript binding is via this server-side mapping — **no user/account-linkable data is ever embedded in the email** (subjects transit and are archived by employer mail infrastructure).
2. **Ceremony: work→personal.** User sends an email from the work mailbox to a personal mailbox they can export from, using a fresh nonce in the subject, then exports the raw `.eml` from the receiving client. This is the measured viable path: external delivery traverses the DKIM signer and Gmail export preserved the signed message. The proof does not establish ownership of the recipient mailbox, so To is neither extracted nor disclosed; the session nonce already supplies freshness, intent, audience, and replay binding.
   **Why not self-send:** the measured Proton self-send contained no DKIM signature, while Proton→Gmail verified end-to-end. Internal delivery may bypass outbound DKIM signing on other providers too. Self-send remains corpus data, not the launch ceremony.
   **Delegation limit:** work→personal requires only active participation by someone able to send from the work mailbox; they could send a nonce to another person's inbox. This cannot be cryptographically prevented by To binding because recipient ownership is not proven. Document the claim honestly as "active mailbox participation," not employment identity.
   **Subject wording:** phishing-resistance wants an explicit subject; employer-privacy forbids naming Pirate in archived corporate mail. Use explicit-but-unattributed wording, e.g. `Account verification code — only send this if it's for your own account: <nonce>`. Never name Pirate or embed Pirate-account identifiers in the email. The spike may retain `pirate-verify:<nonce>` as a test-only regex while the final blueprint must match the approved neutral template and extract the subject from the signed canonicalized header form.
3. **Local parse.** Browser parses candidate `DKIM-Signature` headers, extracts `{d=, s=}` pairs. Deterministic selection policy required when multiple signatures exist (spike must define it — e.g. first signature satisfying strict alignment whose `h=` covers all required headers).
4. **Post-email key pinning.** Browser calls a session-scoped resolution endpoint with `{d, s}` **only** (never the address or raw headers). API resolves the DKIM key from DNS and pins `{d, s, key_hash, resolution_evidence, resolved_at}` into the session. Note keys cannot be pinned at session start — the selector isn't known until the email exists.
5. **Local proving.** Browser generates the proof against the pinned key via `@zk-email/sdk` against a pinned blueprint version. **Raw email never leaves the device.** Remote proving, if ever offered, is a separately consented labeled fallback (it ships the `.eml` to zk.email infra).
6. **Circuit obligations.** Valid DKIM signature against the pinned key; `h=` provably covers From and Subject; From and subject extraction operate on the exact canonicalized, DKIM-selected header sequence authenticated by that signature; exactly one author address is parsed from the selected signed From value; subject matches the approved nonce template with nonce public; `d=` exactly equals the From domain (no relaxed/organizational alignment at launch — that requires a maintained PSL). Public outputs: From-domain, nonce, hashed From for best-effort dedup. To is deliberately neither required in `h=` nor extracted or exposed: work→personal proves no recipient ownership, and the signed nonce supplies session binding. Header-only circuit; body ignored. The draft regexes assume relaxed header canonicalization; simple header canonicalization remains a measured compatibility case until tested against generated-circuit inputs.
7. **Atomic finalization.** In one transaction the API: verifies the proof against pinned blueprint/verifying key + pinned DKIM key; checks nonce is unconsumed and session unexpired (server expiry authoritative — email `Date:` is sender-controlled, sanity-check only); checks domain ∈ policy; inserts `HMAC(server_secret, commitment)` into `identity_nullifiers` (provider `zk_email`, mechanism `dkim-domain-proof-v1`); mints the `email_domain` capability; consumes the nonce. DKIM `t=` and `x=` are recorded during the provider spike but are **not product eligibility inputs**: they are optional/signer-defined, the circuit does not expose them, and a fresh signed session nonce plus server expiry already proves contemporaneous participation and prevents archived-message replay. Raw email and proof inputs are discarded; minimal audit metadata only.

**Capability shape** (single scalar, minimal retention):

```ts
email_domain: {
  state: "verified"; provider: "zk_email"; value: "acme.com";
  mechanism: "dkim-domain-proof-v1"; verified_at: string; expires_at: string;
}
```

**Normalization:** dedicated domain utility (do NOT reuse `normalizeLabelWithIdna` in `global-handle-policy.ts:28` — private, single-label, handle-coupled). UTS-46/IDNA → ASCII, lowercase, trailing-dot strip, length caps, exact canonical comparison. Local-part casing, plus aliases, display names, quoting, comments, and folding remain known ways one underlying mailbox/person may produce different digests. Because `email_domain` is an affiliation badge rather than an anti-Sybil primitive, canonical mailbox extraction improves best-effort deduplication but is not a security boundary.

## 3. Threat model — per-adversary guarantees (document, don't oversell)

| Adversary | Guarantee |
|---|---|
| Other users / communities | Never see address or commitment; see only domain + anonymous byline. Tiny-domain re-identification remains (cf. country-boards small-population risk) — surface a warning to gate authors. |
| Database reader (breach) | Sees only `HMAC(server_secret, commitment)`; cannot enumerate without the HMAC key. |
| Other zk.email applications | The hosted `isHashed` path is not cryptographically app-scoped. If a raw digest escapes, another application hashing the same extracted From bytes can link it. Transient/off-chain handling is a security control. |
| **Pirate operators** | **NOT address-private.** The verifier can enumerate likely addresses against the unsalted digest before HMAC. The HMAC provides at-rest breach containment, not operator-blindness. Operator-blindness would need threshold-OPRF / external evaluation — out of scope. |
| Employer (mail admin, outbound logs, archives) | Sees an email to the user's chosen personal mailbox with an opaque, non-Pirate-branded verification subject. This leaks the personal recipient to the employer, but no Pirate account identifier or Pirate-controlled recipient. |
| Public DoH resolver (optional pre-flight) | Sees the user's network address and queried DKIM `{d,s}` name, but never the mailbox, raw email, subject, or Pirate account. It is advisory only and is not trusted for grants. |
| Replay / cross-deployment attacker | Nonce is single-use, server-mapped to `{user, session, audience, purpose, expiry}`, consumed atomically. A third party holding an old `.eml` from the target cannot produce the fresh nonce. |

**Dedup scope and resolved product semantics:** keep the nullifier global (matching existing `identity_nullifiers`) as best-effort defense-in-depth, but classify `email_domain` as an **affiliation badge**, not an anti-Sybil primitive. It proves ability to send from the domain at verification time; it does not establish one person or one underlying mailbox. Communities needing one-person-one-account properties must compose it with an existing personhood gate such as Self or ZKPassport. The builder should make that composition the obvious default and must not imply that the email-domain atom alone provides Sybil resistance. PoW/browser checks may add abuse friction but are not equivalent to identity-backed personhood nullifiers.

## 4. DKIM key trust policy (launch)

Pin-at-verification from live DNS, resolved by the API at step 4. The spike must specify concretely:
- [ ] resolver/provider (e.g. Cloudflare DoH from the worker) + timeout/failure policy
- [ ] DNSSEC behavior: validate when present; decide policy for unsigned zones (most DKIM zones are unsigned — pinning makes verification reproducible, it does not authenticate a poisoned answer; consider ≥2 independent resolver observations as cheap mitigation)
- [ ] cache rules and TTL handling for pinned keys
- [ ] deterministic multi-signature selection policy (see §2.3)
- [ ] key algorithm support (RSA sizes; ed25519 likely unsupported by circuits — confirm)
- [ ] blueprint + verifying-key versioning: pinned per gate policy version, retirement story for revoked/rotated blueprint versions
- [ ] revocation: what happens to already-minted capabilities if a domain's key is later known-compromised (recommendation: nothing automatic; capabilities are point-in-time + TTL)
- [x] DKIM signature-time policy: record signer `t=`/`x=` and validity-window prevalence, but do not enforce them for the product gate. Session expiry and the fresh signed nonce are authoritative. Corpus tooling must distinguish expiration from invalid signature bytes and offer explicit `enforce` versus `record-only` verification modes.

## 5. Go / no-go questions

The spike answers all five; any hard failure kills or reshapes the feature.

1. **Provider matrix:** can ONE circuit/policy (strict `d=` == From) handle real Google Workspace AND Microsoft 365 corporate mail? What fraction of the target population fails strict alignment?
2. **Signed-field coverage:** are From and Subject demonstrably covered across the matrix (incl. multiple-signature messages)? Does the circuit extract only from the same canonicalized, DKIM-selected sequence that signature verification authenticates? Are duplicate-From attempts harmless, and do the blueprint regexes handle the observed header canonicalization modes?
3. **Proving cost:** does local in-browser proving meet targets — desktop ≤ 60s / ≤ 4GB, mid-range Android phone ≤ 3min without OOM? (Numbers are targets to refine, but must be measured, not estimated.)
4. **Dedup and gate semantics — RESOLVED:** `email_domain` is an affiliation badge. Global digest/HMAC dedup is best-effort defense-in-depth; aliases and presentation variants are not treated as a personhood boundary. Gate-author UX must recommend composition with Self/ZKPassport when Sybil resistance matters, and the digest-handling controls must satisfy the §3 per-adversary limits.
5. **Ceremony completion rate:** can a non-expert complete optional local pre-flight → nonce → work→personal send → recipient export `.eml` → local validation → prove, per receiving client, following written instructions? (Gmail "Show original → Download", Outlook varies — document per-client paths; compare Gmail-query-based `.eml` acquisition from the SDK docs.)

## 6. Spike tasks

Isolation rule: everything lives in a scratch repo / `spike/` directory — **zero product-code changes**. (This also removes any sequencing dependency on `asset_balance` landing end-to-end first; that ordering is organizational preference only.)

**Deliberate carve-out:** A2b may implement a browser-compatible pure policy
module and spike-local adapter because it directly measures Q1/Q5 and prevents
policy drift. It is not authorization for production UI, styling, gate-builder
integration, API provider plumbing, or deployment. Q3 proving cost remains
unmeasured and can still kill the feature; no product build starts before all
go/no-go questions pass.

### Phase A — corpus + ground truth
- [ ] A1. Collect real `.eml` corpus: Google Workspace (custom domain), Microsoft 365 (custom domain), consumer Gmail/Outlook (should FAIL domain gates — `d=gmail.com` control case), forwarded mail (should FAIL nonce binding/alignment as applicable), mailing-list mail (should FAIL), plus-addressed sends, multi-`DKIM-Signature` messages, delegated-subdomain senders (`d=mail.acme.com` vs `From @acme.com` — expect FAIL under strict alignment; measure prevalence).
- [ ] A1b. **Three-axis provider check:** measure independently whether (1) external outbound mail is DKIM-signed and strictly aligned, (2) same-tenant/self delivery traverses the DKIM signer, and (3) each supported personal-mailbox export is byte-faithful enough for full cryptographic DKIM verification. Test Workspace, M365, and Proton custom-domain as senders; test Gmail and Outlook as exporting personal mailboxes. Header presence is structural triage only. Optional starter lane while Workspace/M365 mailboxes are unavailable: Proton custom-domain (a `@proton.me` address only proves `proton.me`).
- [ ] A1c. **Same-mailbox presentation/alias Sybil check:** from one work mailbox, send fresh-nonce work→personal samples while varying only permitted From presentation (display name present/absent and casing where the provider UI/API allows it), then compare the exact signed/extracted From bytes and prospective digests. Separately test supported-provider aliases such as plus-addressing. Record whether the provider canonicalizes, rejects, or signs each variant. Provider canonicalization is evidence for that provider/configuration, not a circuit guarantee or a safe assumption for every allowed domain.
- [ ] A2. For each: record `d=`, `s=`, full `h=` list including the number/position of `from` occurrences, header/body canonicalization (`c=`), signer timestamp/expiration (`t=`/`x=`) and validity-window length, key alg/size, and From/Subject coverage, then cryptographically verify the signature and body hash against the published DNS key. Oversigning remains useful corpus metadata but is not an eligibility requirement: the circuit receives only the canonicalized headers selected by `h=`. Record whether each canonicalized header form matches the draft regexes. Structural inspection is triage only. Produce the alignment/canonicalization/signature-window/verification pass-rate table → feeds go/no-go Q1/Q2.
- [ ] A2a. **Passive DNS fingerprint survey:** pre-register a target population and sampling rule, then probe the default Workspace selector (`google`), both documented M365 selectors (`selector1`/`selector2`), and DMARC. Report this separately from message compatibility. A positive selector is only evidence that a record is published (it may be stale/inactive); a negative Workspace default-selector probe is inconclusive because administrators can choose another selector; dual-provider records do not identify the active outbound path; DMARC may pass through SPF. Actual compatibility still requires a cryptographically verified, strictly aligned message. Use `survey-dkim-dns.mjs`; keep labeled domain inputs ignored and publish only reviewed aggregate metadata.
- [ ] A2c. **Received-mail archive coverage survey:** run `survey-mail-archive.mjs` over a recent, local MBOX export from an opt-in mailbox. Stream headers only and make no network requests. Require an explicit trusted receiving `authserv-id` (Gmail export: `mx.google.com`), use only its contemporaneous `Authentication-Results` DKIM pass plus `header.i`/`header.d` identity for alignment coverage, and never treat this observational evidence as gate authorization. Report both bulk-inclusive and human-candidate populations; the latter excludes list/bulk/automated and sent-folder messages. Collapse repeated correspondents to one best observed verdict per From domain and commit counts only. Record the date window, filter counts, missing trusted verdicts, and correspondent/sector/receiver bias. Validate the method separately against a small explicitly consented recent cryptographic subsample; do not perform DNS during the archive run. This estimates compatibility for the mailbox's actual correspondence, not a population census or organization-wide claim. A provisional six-month Gmail MBOX run is recorded in `spikes/email-domain-gate/findings.md`; reconcile its 92-message archive count against the source mailbox and rerun a complete export if materially different before marking this task complete or citing its rates externally.
- [x] A2b1. **Shared compatibility-policy core:** one browser-compatible pure module accepts normalized evidence and returns `compatible`/`incompatible`/`inconclusive` plus confidence and sanitized reason codes. It owns exact alignment, signed-header coverage, supported algorithm/canonicalization, record-only signer time, header-only body handling, and deterministic first-eligible signature selection. Verifier and future post-proof adapters feed evidence without consulting legacy `gate_usable` fields. Synthetic tests and the six-sample private corpus conformance run cover invalid header signatures, body/signed-header rewriting, no-signature mail, unsupported algorithms/canonicalization, unaligned `d=`, malformed domains, multi-signature selection, and expired `x=`. Keep it spike-local with no production UI or integration.
- [x] A2b2. **JavaScript cryptographic/DoH evidence adapter:** accepts an `.eml`, requires resolver injection, verifies header-only and full-body DKIM with cached lookups, extracts raw policy facts, and feeds A2b1. Its HTTPS DoH constructor targets exactly one explicitly supplied endpoint and emits sanitized errors; it does not use the installed helper's dual-resolver default, a Pirate endpoint, or telemetry. A clean-checkout synthetic expired-signature run and the six-sample private corpus assert exact Python/JavaScript normalized-evidence equality. The private harness regenerates temporary evidence every run rather than trusting ignored caches. Browser-target bundling succeeds.
- [x] A2b3. **Actual browser runtime smoke:** a fresh Chrome session verified a runtime-generated, expired synthetic signature with an injected resolver, returned the A2b1 `compatible` verdict plus `signer_expiration_ignored`, made zero unexpected network requests, and emitted no console errors. The released helper requires explicit browser mappings for Node `crypto` and `stream`, a bundled `Buffer` global, and direct use of its async parser methods because its `writeToStream`/writable backpressure path stalls in the browser. The resulting spike bundle is approximately 3.04 MB unminified; this is adapter overhead, not proving-memory evidence. No production UI or integration.
- [ ] A3. Corpus handling: raw `.eml` files stay in a gitignored, access-restricted local directory; are never committed, uploaded, logged, or attached to issues; use dedicated test mailboxes where possible; publish only manually reviewed/redacted metadata and synthetic fixtures; document retention and securely delete raw samples when the spike ends.

### Phase B — blueprint
- [ ] B1. Author registry blueprint (docs: zk-email-sdk/creating-a-new-pattern): DKIM verify, `h=` coverage assertions, extraction from the authenticated canonicalized header sequence tested adversarially with duplicate and non-oversigned From cases, observed canonicalization-mode compatibility, subject nonce public, From-domain public, unsalted hashed From output for best-effort dedup, header-only. Do not extract To.
- [x] B2 desk check. `@zk-email/sdk@2.0.11` can expose/hash regex extractions for the subject nonce, From domain, and best-effort From digest. However, the ordinary blueprint fixes one `senderDomain`, and the schema cannot compose an extracted mailbox with an application salt. Its lack of raw-From cardinality constraints is not itself a forgery surface because extraction consumes the canonicalized, `h=`-selected signed sequence. Q4's badge-only decision makes the hosted unsalted `isHashed` output acceptable if it is immediately HMACed and never logged, returned, or placed in a URL. Any escaped raw digest remains universally enumerable and cross-application linkable. Generated-project validation must document exactly what `isHashed` commits to, verify the signed-sequence binding with duplicate and non-oversigned From attempts, exercise observed header canonicalization modes, and test the lower-level dynamic-domain wrapper. Canonical mailbox extraction is a dedup-quality property rather than a launch security blocker. See `spikes/email-domain-gate/b2-blueprint-dsl.md`.
- [ ] B3. Compile one private blueprint using only a synthetic fixture, then pin the complete generated artifact set locally: normalized blueprint properties and version/ID, generated source, build manifest and lockfiles, compiler/SDK versions, WASM, R1CS or equivalent constraint artifact when available, verification key, every proving-key chunk, and SHA-256 hashes for every file. See `spikes/email-domain-gate/blueprint/artifact-pinning.md`.

### Phase C — generated artifacts + circuit correctness
- [ ] C1. Confirm the pinned artifact set is complete and hash-stable; no artifact may be fetched by mutable slug or unpinned URL after this point.
- [ ] C2. Prove and verify locally from the pinned artifacts with registry, archive, and remote prover access disabled. Raw corpus email remains local.
- [ ] C3. Inspect generated source and public signals: document whether any sender-domain constant exists, the exact public-signal layout, what `isHashed` commits to, and that regex constraints consume the authenticated `emailHeader` buffer.
- [ ] C4. Circuit correctness suite before benchmarking: wrong nonce, wrong pinned key, wrong From domain, unsigned duplicate From, valid non-oversigned From, observed canonicalization modes, and deterministic multi-signature selection.

### Phase D — server-side mock (spike-local, no product code)
- [ ] D1. Mock nonce issuance + server-side session map; single-use atomic consumption.
- [ ] D2. Mock `{d,s}` → DNS resolution + pinning endpoint (record `{d, s, key_hash, evidence, resolved_at}`); implement multi-signature selection policy from §2.3.
- [ ] D3. Prototype the dynamic-domain verifier wrapper: verify the Groth16 proof with the pinned verification key, compare its DKIM public-key hash with the session-pinned DNS key, and compare the extracted From domain with pinned `d=`. Prove that substituting either domain or key fails.
- [ ] D4. Public-output validation (nonce match, domain ∈ allowlist, commitment extraction) + HMAC + fake-ledger insert, all in one transaction shape.
- [ ] D5. Negative suite: replayed proof (consumed nonce), expired session, tampered public outputs, unpinned/substituted key, substituted domain, and alignment-violating corpus cases.

### Phase E — proving bench (after correctness)
- [ ] E1. Browser bench from pinned local artifacts: time + peak memory, desktop Chrome/Firefox + mid-range Android Chrome → go/no-go Q3.
- [ ] E2. Measure remote-proving latency once, for the labeled-fallback comparison only (raw `.eml` disclosure noted). Remote proving remains out of launch scope.

### Phase F — write-ups (gate the go/no-go)
- [ ] F1. Threat-model note = §3 table finalized, incl. explicit "not operator-blind" statement + OPRF future-work note.
- [ ] F2. Key-trust policy note = §4 checklist answered.
- [ ] F3. Ceremony UX note: optional pre-flight confidence/explanations, per-client `.eml` export instructions, fresh-email validation before proving, and observed completion friction → Q5.
- [ ] F4. Go/no-go memo answering Q1–Q5 with data.

## 7. Test matrix (spike acceptance)

| # | Case | Expected |
|---|---|---|
| T0a | Existing external email from the same work mailbox/path, valid aligned DKIM | Advisory `compatible`; no capability or authoritative organization-wide claim |
| T0b | Existing email from another mailbox at the domain, valid aligned DKIM | Advisory `compatible` with weak domain-evidence confidence |
| T0c | Internal/forwarded/header-rewritten existing email with absent or invalid header signature | Advisory `inconclusive` unless a verified unaligned signature establishes incompatibility for the sampled path |
| T0d | Body rewritten but authenticated selected headers still verify | Advisory `compatible` under header-only circuit policy; report body-hash mismatch separately |
| T0e | Existing email has valid aligned header signature but signer `x=` is past | Advisory `compatible`; record expiration warning but do not change policy |
| T1 | Workspace corp→personal, fresh nonce | PASS; outputs domain + digest |
| T2 | M365 corp→personal, fresh nonce | PASS |
| T3 | Consumer gmail.com→personal | PASS proof, FAIL gate (domain not in allowlist) — control |
| T4 | `d=mail.acme.com` / From `@acme.com` | FAIL (strict alignment) — count prevalence |
| T5 | Old `.eml` from target's real correspondence (no nonce) | FAIL (subject regex) |
| T6 | Correct nonce sent work→personal (`To ≠ From`) | PASS; To is neither extracted nor disclosed |
| T7 | Same mailbox, same account, second session/new nonce | PASS proof; dedup insert is idempotent |
| T8 | Same mailbox, different Pirate account | PASS proof; finalization FAILS on active global nullifier conflict |
| T9 | `alice+x@` vs `alice@` from one underlying account | Record whether commitments differ; distinct values are an accepted best-effort-dedup limitation, not a proof failure |
| T9a | Same mailbox with varied display name/casing/quoting | Record whether commitments differ and where variation is introduced; distinct values are an accepted best-effort-dedup limitation |
| T10 | Replay of already-consumed proof | FAIL atomically |
| T11 | Expired session, valid proof | FAIL (server expiry authoritative; email `Date:` ignored) |
| T11a | Valid signature bytes after signer `x=` | PASS proof/gate only with a fresh unexpired session nonce; record `x=` as expired but do not use it as eligibility policy |
| T12 | Multi-signature email | Deterministic selection; PASS iff selected sig meets all obligations |
| T13 | Subject or From not in `h=` | FAIL |
| T13a | Unsigned From prepended to otherwise valid signed content | Forged occurrence never reaches the circuit input; proof output remains bound to the `h=`-selected signed occurrence, or verification FAILS |
| T13b | Valid non-oversigned From signature | PASS if all other obligations hold; confirm extraction remains bound to the selected signed occurrence |
| T13c | Simple header canonicalization | Record provider prevalence; PASS only after generated-input regex compatibility is demonstrated |
| T14 | Unicode domain (IDN) | Normalized UTS-46 canonical compare |
| T15 | ed25519-signed DKIM (if found) | Documented behavior (likely unsupported → FAIL cleanly) |
| T16 | Self-send exported from same tenant (diagnostic only) | Record whether the copy contains a cryptographically valid `DKIM-Signature`; this does not change the work→personal launch ceremony |

## 8. Out of scope (post-spike implementation checklist, for reference only)

Touch map verified against canonical trees 2026-07-20 — do NOT start until go/no-go passes:
- `GateAtom` union `api/.../membership/gate-types.ts:15` + validation/evaluation/failure/summary switches; regen `@pirate/api-contracts`
- `VerificationProvider` union duplicated at `verification-repository.ts:27` AND `verification-session-service.ts:59` (+ contracts) — every copy, plus new provider mode (`proof_upload`), own dispatch branches in start/complete
- `VerificationCapabilities` + explicit enumerations in `verification-capabilities.ts:28` (default builder + lazy expiry)
- Migration extending 0103 CHECK constraints — **two copies**: `core/db/control-plane/migrations/` + `api/services/api/test-fixtures/db/control-plane/migrations/`
- New domain-normalization utility (dedicated, not `global-handle-policy.ts`)
- Web: `RuleKind`/dropdown/`defaultGateForKind`/`getRuleKind`/label switches in `gate-tree-builder.tsx`, `gate-requirement-groups.ts`, `gate-atom-validation.ts`, sidebar, `use-zk-email-verification.tsx`; `{label}` binding → "anonymous @ acme.com" byline via identity-presentation qualifiers
- Logging hygiene: `.eml`, headers, addresses, commitments excluded from logs/Sentry by construction; client-side file-size caps
- Dark flag + tiny-domain re-identification warning in gate author UI
