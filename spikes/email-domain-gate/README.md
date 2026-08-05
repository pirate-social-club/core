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
  --out results/proton-to-gmail.crypto.json
```

`--expect fail` records a message containing DKIM signatures that do not verify;
`--expect no-signature` records a message with no DKIM signature. The command
fails if the observed cryptographic result differs from the declared corpus
expectation.

`--expect pass` requires at least one signature that verifies cryptographically,
is strictly aligned (`d=` equals the single parsed From domain), and signs From,
To, and Subject. A valid but unaligned forwarder or mailing-list signature does
not pass the gate.

For a failed sample, add `--ignore-body-hash` to diagnose whether the signed
headers still verify independently. This diagnostic never converts an invalid
DKIM message into a pass:

```bash
rtk .venv/bin/python verify-dkim.py \
  --label gmail-to-proton \
  --file corpus/gmail-to-proton.eml \
  --expect fail \
  --ignore-body-hash \
  --out results/gmail-to-proton.crypto.json
```
