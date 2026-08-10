# Email-domain gate spike

Phase A tooling for `specs/domain/email-domain-gate-spike.md`.

The proposed attested SMTP dead-drop alternative is an unresolved architecture
fork, not authorized product work. See
[`architecture-fork-local-zk-vs-tee.md`](architecture-fork-local-zk-vs-tee.md)
for the privacy/trust comparison and decision record. Continue DKIM alignment
coverage work because it gates both architectures.

Raw email is sensitive. Put samples only in `corpus/`; Git ignores everything
there except its handling instructions. The tools emit sanitized metadata only:
they never emit an address, subject, body, signature, DNS key, input path, or
filename. Structural inspection is triage only; every provider verdict requires
cryptographic verification against DNS.

Inspect one sample:

```bash
rtk node inspect-eml.mjs --label proton-self --file corpus/proton-self.eml
```

Save a result locally (the `results/` directory is also ignored):

```bash
rtk node inspect-eml.mjs --label proton-self --file corpus/proton-self.eml \
  --out results/proton-self.json
```

Run the focused synthetic tests:

```bash
rtk node --test inspect-eml.test.mjs
```

Create an isolated verifier environment:

```bash
rtk python3 -m venv .venv
rtk .venv/bin/pip install -r requirements.txt
```

Cryptographically verify a positive sample:

```bash
rtk .venv/bin/python verify-dkim.py \
  --label proton-to-gmail \
  --file corpus/proton-to-gmail.eml \
  --expect pass \
  --signature-time-policy record-only \
  --out results/proton-to-gmail.crypto.json
```

`--expect fail` records a message containing DKIM signatures that do not verify;
`--expect no-signature` records a message with no DKIM signature. The command
fails if the observed cryptographic result differs from the declared corpus
expectation.

`--signature-time-policy` is required so timestamp semantics cannot be implicit:

- `enforce` applies dkimpy's current-time checks to signer `t=`/`x=` and reports
  expiration as `signature_expired`, distinct from bad signature bytes.
- `record-only` verifies the signed bytes while recording timestamp, expiration,
  validity-window length, and current expiration status separately. This is the
  domain-gate policy and archived-corpus mode: a fresh signed session nonce plus
  server expiry is the authoritative freshness/replay control.

`--expect pass` requires at least one signature that verifies cryptographically,
is strictly aligned (`d=` equals the single parsed From domain), and signs From,
and Subject. Oversigning From is recorded as provider metadata but is not a gate
requirement: ZK Email passes only the canonicalized, `h=`-selected signed header
sequence into the circuit. To is intentionally neither a signed-header
requirement nor a proof output in the work→personal ceremony because recipient
ownership is not proven and the nonce already binds the session. A valid but
unaligned forwarder or mailing-list signature does not pass the gate.

The inspector records both header and body canonicalization modes. The draft
blueprint regexes have been exercised only against relaxed header
canonicalization; a simple-header sample is a compatibility test, not an
automatic security failure.

For a failed sample, add `--ignore-body-hash` to diagnose whether the signed
headers still verify independently. This diagnostic never converts an invalid
DKIM message into a pass:

```bash
rtk .venv/bin/python verify-dkim.py \
  --label gmail-to-proton \
  --file corpus/gmail-to-proton.eml \
  --expect fail \
  --signature-time-policy record-only \
  --ignore-body-hash \
  --out results/gmail-to-proton.crypto.json
```

## Passive DNS fingerprint survey

`survey-dkim-dns.mjs` probes the default Workspace selector, both documented
M365 selectors, and DMARC without collecting email. Keep the input file
gitignored and use non-identifying labels:

```json
[
  { "label": "target-001", "domain": "engineering.example" },
  { "label": "target-002", "domain": "research.example" }
]
```

```bash
rtk node survey-dkim-dns.mjs \
  --file survey-targets/employers.json \
  --out results/employer-dkim-survey.json
```

The output never contains input domains or DNS values. It is a fingerprint
survey, not a compatibility verdict:

- Workspace permits a non-default selector, so absence at `google` is
  inconclusive.
- Published selector records may be stale or not activated.
- Multiple provider fingerprints do not identify the active outbound route.
- DMARC may pass through SPF alone and does not prove aligned DKIM.
- Only a cryptographically verified message establishes gate compatibility.

The target population and sampling rule must be fixed before running a survey;
an ad-hoc list of recognizable domains cannot support a general coverage rate.

## Local received-mail coverage survey

`survey-mail-archive.mjs` measures the actual domains represented in a local
MBOX export. It streams headers and discards bodies, trusts only an explicitly
named receiving provider's contemporaneous `Authentication-Results`, and makes
no DNS or HTTP requests. Repeated correspondents collapse to one best observed
verdict per From domain. This is observational coverage evidence, never gate
authorization evidence.

Use a recent, inbox-scoped export where possible. Keep it outside the repository
or under ignored `survey-archives/`, and write results under ignored `results/`:

```bash
rtk node survey-mail-archive.mjs \
  --mbox /absolute/path/to/recent-inbox.mbox \
  --since 2026-02-01 \
  --authserv-id mx.google.com \
  --out results/received-mail-coverage.json
```

For a Proton Export Tool directory, use the same survey with Proton's receiving
authentication service identifier:

```bash
rtk node survey-mail-archive.mjs \
  --eml-dir /absolute/path/to/proton-mail-backup \
  --since 2026-02-01 \
  --authserv-id mail.protonmail.ch \
  --out results/received-mail-coverage-proton.json
```

The run is fully local and records `network_requests: 0`. It compares all
received mail with a loose header-filtered subset. Proton sidecars additionally
produce a higher-precision replied-to population. Reporting all tiers makes
filter and interaction bias visible. The receiving provider's result was
computed when the message arrived, so removed/rotated DKIM keys do not create
archive-age false negatives. The output contains no domain, address, subject,
identifier, path, or header value. A separate, explicitly consented small
recent-message re-verification may validate this method, but is not part of the
archive survey.

The aggregate records the configured receiver identifier (for example,
`mx.google.com`) as methodology. It emits no sender domain.

Run its synthetic tests with:

```bash
rtk node --test survey-mail-archive.test.mjs
```

## Shared compatibility policy

`compatibility-policy.mjs` is the single spike policy for advisory pre-flight,
fresh-message pre-proof validation, and future API post-proof enforcement. Each
path supplies normalized evidence; none reimplements strict alignment, signed
header coverage, algorithm, canonicalization, deterministic signature
selection, or signer-time policy.

The Python verifier's derived `gate_usable` and `--expect` values remain Phase A
corpus diagnostics for backward compatibility. They are not consumed by the
shared module and are not product policy. The corpus conformance command below
is the drift gate between cryptographic evidence and compatibility decisions.

Run the self-contained policy tests:

```bash
rtk node --test compatibility-policy.test.mjs
```

Run the clean-checkout synthetic cross-adapter conformance after installing the
pinned Python requirements:

```bash
rtk node compatibility-policy.synthetic.mjs --python .venv/bin/python
```

The private corpus cannot exist in a clean checkout by design. When it is
available locally, run the six-sample conformance suite with:

```bash
rtk node compatibility-policy.corpus.mjs --python .venv/bin/python
```

That command regenerates Python evidence in a new mode-0700 temporary directory,
runs the JavaScript adapter against the same raw messages and observation time,
asserts exact normalized-evidence equality, evaluates the shared policy, and
deletes the temporary evidence. It never reads `results/*.crypto.json` caches.

Run the browser-adapter unit/blueprint tests and the clean-checkout synthetic
cross-adapter check:

```bash
rtk bun run --cwd blueprint test
rtk node compatibility-policy.synthetic.mjs --python .venv/bin/python
```

Prepare the real-browser smoke artifact in a restricted temporary directory,
then open the emitted `index.html` in a fresh browser session and require a
`status: pass` result with zero console errors:

```bash
rtk bun blueprint/prepare-browser-runtime-smoke.mjs \
  --python .venv/bin/python \
  --out-dir /tmp/email-domain-browser-smoke
```

The smoke build deliberately aliases the helper's Node `crypto` and `stream`
imports to pinned browser polyfills. The adapter bypasses the helper's
browser-stalling writable-stream wrapper and calls the same verifier's async
parser methods directly. The current unminified bundle is approximately 3.04
MB; this is not the proving bundle or a Q3 memory measurement.

This module is spike-only. It has no production UI, gate-builder integration,
API provider plumbing, or deployment authorization.
