# Email-Domain Gate via ZK Email — Feasibility Spike Spec

**Status:** SPIKE APPROVED — no provider plumbing, no gate UI until go/no-go passes.
**Date:** 2026-07-20 (audit converged over three review rounds)
**Owner:** TBD
**Scope:** Prove or refute that Pirate can gate communities on "member controls a mailbox at `acme.com`" using a DKIM-based ZK proof (`@zk-email/sdk` + a custom registry blueprint), without the address ever reaching Pirate.

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

1. **Session start.** API issues an opaque random nonce (≥128 bit) + server-side session record `{user_id, session_id, audience/env, purpose, expires_at}`. All transcript binding is via this server-side mapping — **no user/account-linkable data is ever embedded in the email** (subjects transit and are archived by employer mail infrastructure).
2. **Ceremony: self-send.** User sends an email from their work mailbox **to themselves** with subject `pirate-verify:<nonce>`, then exports the raw `.eml`. Self-send is deliberate: a Pirate-controlled recipient would announce the verification to employer outbound-mail logs. The circuit binds parsed `To == From`.
   **Known risk — internal-delivery DKIM gap:** DKIM signing happens at the outbound gateway; a self-send delivered *internally* within the same tenant/provider (M365 intra-tenant especially; Proton internal delivery) may carry **no** `DKIM-Signature` at all, even with DKIM correctly configured for external mail. Phase A must measure this per provider (go/no-go Q1). Fallback ceremony if it bites: send corp → a personal mailbox the user controls (e.g. Gmail) and export there — this preserves the nonce and DKIM but breaks `To == From`; the replacement binding would be committing to (not disclosing) the signed To in-circuit. Decide only with Phase A data.
   **Ceremony ordering:** self-send stays preferred where providers support it — it requires *mailbox access*, while work→personal requires only *one favor from an employee* (delegation/relay: attacker obtains a session nonce and persuades an employee to email it to the attacker's inbox). Delegation cannot be cryptographically prevented in any possession-based check; document the claim honestly as "active mailbox participation," not employment identity.
   **Subject-wording tension (work→personal only):** phishing-resistance wants an explicit subject; employer-privacy forbids naming Pirate in archived corporate mail. Resolution: explicit-but-unattributed wording, e.g. `Account verification code — only send this if it's for your own account: <nonce>`. Never name Pirate in the email; the subject-regex blueprint must match this template. Circuit must extract the subject from the signed *canonicalized* header form (spike validates).
3. **Local parse.** Browser parses candidate `DKIM-Signature` headers, extracts `{d=, s=}` pairs. Deterministic selection policy required when multiple signatures exist (spike must define it — e.g. first signature satisfying strict alignment whose `h=` covers all required headers).
4. **Post-email key pinning.** Browser calls a session-scoped resolution endpoint with `{d, s}` **only** (never the address or raw headers). API resolves the DKIM key from DNS and pins `{d, s, key_hash, resolution_evidence, resolved_at}` into the session. Note keys cannot be pinned at session start — the selector isn't known until the email exists.
5. **Local proving.** Browser generates the proof against the pinned key via `@zk-email/sdk` against a pinned blueprint version. **Raw email never leaves the device.** Remote proving, if ever offered, is a separately consented labeled fallback (it ships the `.eml` to zk.email infra).
6. **Circuit obligations.** Valid DKIM signature against the pinned key; `h=` provably covers From, To, Subject; exactly one author address parsed from the signed canonicalized From; `To == From`; subject matches `pirate-verify:<nonce>` with nonce public; `d=` exactly equals the From domain (no relaxed/organizational alignment at launch — that requires a maintained PSL). Public outputs: From-domain, nonce, mailbox commitment. Header-only circuit; body ignored.
7. **Atomic finalization.** In one transaction the API: verifies the proof against pinned blueprint/verifying key + pinned DKIM key; checks nonce is unconsumed and session unexpired (server expiry authoritative — email `Date:` is sender-controlled, sanity-check only); checks domain ∈ policy; inserts `HMAC(server_secret, commitment)` into `identity_nullifiers` (provider `zk_email`, mechanism `dkim-domain-proof-v1`); mints the `email_domain` capability; consumes the nonce. Raw email and proof inputs are discarded; minimal audit metadata only.

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
| Employer (mail admin, outbound logs, archives) | Sees a self-addressed email with an opaque nonce subject. No Pirate-identifying recipient, no account-linkable data. This is why self-send beats a Pirate-controlled inbox. |
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

## 5. Go / no-go questions

The spike answers all five; any hard failure kills or reshapes the feature.

1. **Provider matrix:** can ONE circuit/policy (strict `d=` == From) handle real Google Workspace AND Microsoft 365 corporate mail? What fraction of the target population fails strict alignment?
2. **Signed-field coverage:** are From, To, Subject demonstrably inside `h=` across the matrix (incl. multiple-signature messages)? Is single-author-address parsing from the signed canonicalized header robust?
3. **Proving cost:** does local in-browser proving meet targets — desktop ≤ 60s / ≤ 4GB, mid-range Android phone ≤ 3min without OOM? (Numbers are targets to refine, but must be measured, not estimated.)
4. **Dedup and gate semantics — RESOLVED:** `email_domain` is an affiliation badge. Global digest/HMAC dedup is best-effort defense-in-depth; aliases and presentation variants are not treated as a personhood boundary. Gate-author UX must recommend composition with Self/ZKPassport when Sybil resistance matters, and the digest-handling controls must satisfy the §3 per-adversary limits.
5. **Ceremony completion rate:** can a non-expert complete nonce → self-send → export `.eml` → prove, per provider, following written instructions? (Gmail "Show original → Download", Outlook varies — document per-client paths; compare Gmail-query-based `.eml` acquisition from the SDK docs.)

## 6. Spike tasks

Isolation rule: everything lives in a scratch repo / `spike/` directory — **zero product-code changes**. (This also removes any sequencing dependency on `asset_balance` landing end-to-end first; that ordering is organizational preference only.)

### Phase A — corpus + ground truth
- [ ] A1. Collect real `.eml` corpus: Google Workspace (custom domain), Microsoft 365 (custom domain), consumer Gmail/Outlook (should FAIL domain gates — `d=gmail.com` control case), forwarded mail (should FAIL nonce/To binding), mailing-list mail (should FAIL), plus-addressed self-send, multi-`DKIM-Signature` messages, delegated-subdomain senders (`d=mail.acme.com` vs `From @acme.com` — expect FAIL under strict alignment; measure prevalence).
- [ ] A1b. **Three-axis provider check:** measure independently whether (1) external outbound mail is DKIM-signed and strictly aligned, (2) same-tenant/self delivery traverses the DKIM signer, and (3) each supported personal-mailbox export is byte-faithful enough for full cryptographic DKIM verification. Test Workspace, M365, and Proton custom-domain as senders; test Gmail and Outlook as exporting personal mailboxes. Header presence is structural triage only. Optional starter lane while Workspace/M365 mailboxes are unavailable: Proton custom-domain (a `@proton.me` address only proves `proton.me`).
- [ ] A1c. **Same-mailbox presentation/alias Sybil check:** from one work mailbox, send fresh-nonce work→personal samples while varying only permitted From presentation (display name present/absent and casing where the provider UI/API allows it), then compare the exact signed/extracted From bytes and prospective digests. Separately test supported-provider aliases such as plus-addressing. Record whether the provider canonicalizes, rejects, or signs each variant. Provider canonicalization is evidence for that provider/configuration, not a circuit guarantee or a safe assumption for every allowed domain.
- [ ] A2. For each: record `d=`, `s=`, `h=` list, canonicalization (`c=`), key alg/size, whether From/To/Subject are signed, then cryptographically verify the signature and body hash against the published DNS key. Structural inspection is triage only and cannot support a provider verdict. Produce the alignment-and-verification pass-rate table → feeds go/no-go Q1/Q2.
- [ ] A3. Corpus handling: raw `.eml` files stay in a gitignored, access-restricted local directory; are never committed, uploaded, logged, or attached to issues; use dedicated test mailboxes where possible; publish only manually reviewed/redacted metadata and synthetic fixtures; document retention and securely delete raw samples when the spike ends.

### Phase B — blueprint
- [ ] B1. Author registry blueprint (docs: zk-email-sdk/creating-a-new-pattern): DKIM verify, `h=` coverage assertions, single-From parse, `To == From`, subject regex `pirate-verify:(.+)` with nonce public, From-domain public, unsalted hashed From output for best-effort dedup, header-only.
- [x] B2 desk check. `@zk-email/sdk@2.0.11` can expose/hash regex extractions, so proof-bound From-domain comparison and hashed From/To equality can be enforced after proof verification. However, the ordinary blueprint fixes one `senderDomain`, and the schema cannot compose an extracted mailbox with an application salt. Q4's badge-only decision makes the hosted unsalted `isHashed` output acceptable for best-effort dedup if it is immediately HMACed and never logged, returned, or placed in a URL. Any escaped raw digest remains universally enumerable and cross-application linkable. Generated-project validation must document exactly what `isHashed` commits to and test equivalent presentations, but canonical mailbox extraction is now a dedup-quality property rather than a launch security blocker. See `spikes/email-domain-gate/b2-blueprint-dsl.md`; generated-project and dynamic-domain-wrapper validation remain required.
- [ ] B3. Pin blueprint version; document verifying-key extraction for server-side `verifyProof`.

### Phase C — proving bench
- [ ] C1. Node harness: `initZkEmailSdk() → getBlueprint(slug) → createProver() → generateProof(eml)` over the Phase A corpus; assert expected pass/fail per case.
- [ ] C2. Browser bench (Vite page): time + peak memory, desktop Chrome/Firefox + mid-range Android Chrome → go/no-go Q3.
- [ ] C3. Measure remote-proving latency once, for the labeled-fallback comparison only (raw `.eml` disclosure noted).

### Phase D — server-side mock (spike-local, no product code)
- [ ] D1. Mock nonce issuance + server-side session map; single-use atomic consumption.
- [ ] D2. Mock `{d,s}` → DNS resolution + pinning endpoint (record `{d, s, key_hash, evidence, resolved_at}`); implement multi-signature selection policy from §2.3.
- [ ] D3. `blueprint.verifyProof()` off-chain + public-output validation (nonce match, domain ∈ allowlist, commitment extraction) + HMAC + fake-ledger insert, all in one transaction shape.
- [ ] D4. Negative suite: replayed proof (consumed nonce), expired session, wrong audience salt, tampered public outputs, unpinned key, alignment-violating corpus cases.

### Phase E — write-ups (gate the go/no-go)
- [ ] E1. Threat-model note = §3 table finalized, incl. explicit "not operator-blind" statement + OPRF future-work note.
- [ ] E2. Key-trust policy note = §4 checklist answered.
- [ ] E3. Ceremony UX note: per-client `.eml` export instructions + observed completion friction → Q5.
- [ ] E4. Go/no-go memo answering Q1–Q5 with data.

## 7. Test matrix (spike acceptance)

| # | Case | Expected |
|---|---|---|
| T1 | Workspace corp self-send, fresh nonce | PASS; outputs domain + commitment |
| T2 | M365 corp self-send, fresh nonce | PASS |
| T3 | Consumer gmail.com self-send | PASS proof, FAIL gate (domain not in allowlist) — control |
| T4 | `d=mail.acme.com` / From `@acme.com` | FAIL (strict alignment) — count prevalence |
| T5 | Old `.eml` from target's real correspondence (no nonce) | FAIL (subject regex) |
| T6 | Correct nonce, `To ≠ From` | FAIL |
| T7 | Same mailbox, same account, second session/new nonce | PASS proof; dedup insert is idempotent |
| T8 | Same mailbox, different Pirate account | PASS proof; finalization FAILS on active global nullifier conflict |
| T9 | `alice+x@` vs `alice@` from one underlying account | Record whether commitments differ; distinct values are an accepted best-effort-dedup limitation, not a proof failure |
| T9a | Same mailbox with varied display name/casing/quoting | Record whether commitments differ and where variation is introduced; distinct values are an accepted best-effort-dedup limitation |
| T10 | Replay of already-consumed proof | FAIL atomically |
| T11 | Expired session, valid proof | FAIL (server expiry authoritative; email `Date:` ignored) |
| T12 | Multi-signature email | Deterministic selection; PASS iff selected sig meets all obligations |
| T13 | Subject/From/To not in `h=` | FAIL |
| T14 | Unicode domain (IDN) | Normalized UTS-46 canonical compare |
| T15 | ed25519-signed DKIM (if found) | Documented behavior (likely unsupported → FAIL cleanly) |
| T16 | Self-send exported from same tenant (per provider) | Exported copy contains a cryptographically valid `DKIM-Signature`; header presence alone is insufficient. If absent or invalid, record per-provider and evaluate the corp→personal fallback ceremony |

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
