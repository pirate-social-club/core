# Email-domain gate spike

Phase A tooling for `specs/domain/email-domain-gate-spike.md`.

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
