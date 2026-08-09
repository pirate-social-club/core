# B1 — Local domain-specific blueprint draft

**Checked:** 2026-08-05  
**Artifact:** `blueprint/draft-blueprint.json`, `@zk-email/sdk@2.0.11`  
**Status:** local draft passes; registry-generated circuit/project still blocked
on registry authentication/submission.

## Ceremony and outputs

The draft models work→personal and deliberately does not extract To. Its three
extractions are:

1. hashed From mailbox for best-effort dedup;
2. public From domain; and
3. public test nonce from `pirate-verify:<nonce>`.

The test nonce wording is spike-only. A final blueprint must use the approved
neutral, non-Pirate-branded subject template.

The draft is fixed to `senderDomain: pirate.sc` only to exercise the existing
Proton custom-domain corpus. This is not a production policy.

## Local validation

- The released `Blueprint.formSchema` accepts the draft.
- All three decomposed regexes match a synthetic canonicalized header.
- `testBlueprint()` accepts the private, cryptographically pre-verified
  Proton→Gmail sample and returns exactly three non-empty outputs.
- Substituting `senderDomain: example.invalid` is rejected locally before
  extraction.
- The two Proton presentation samples produce equal From-digest outputs and
  equal domain outputs, while their nonce outputs differ. No digest or extracted
  value was printed or persisted.

These checks use the released SDK's local parser/input-generation path; raw
email did not leave the machine.

## Duplicate-From result

The official regex documentation states that when multiple matches exist only
the first is used. That does not create the previously suspected unsigned-header
forgery: the regex runs over `status.signedHeaders`, the same canonicalized,
`h=`-selected byte sequence used for RSA verification. Selection walks repeated
headers bottom-up. An unsigned prepended From is absent from the circuit input,
while changing a selected occurrence invalidates the signature.

The released SDK parser also rejects the current duplicate-From mutation with a
multiple-address error. That is separate defense-in-depth. The generated
circuit/project must still exercise duplicate and non-oversigned cases to confirm
the generated artifact preserves the audited input pipeline, but From
oversigning is corpus metadata rather than provider eligibility policy.

## Header canonicalization result

The current samples use relaxed header canonicalization. Their canonicalized
field names are lowercase and whitespace after the colon is removed, matching
the draft regexes. Simple header canonicalization preserves the original header
form, so common forms such as `Subject: pirate-verify:...` do not match the
current lowercase/no-space patterns. Record the header canonicalization mode for
every provider and test any simple-header sample against generated inputs before
claiming compatibility. Do not classify simple mode as a cryptographic failure.

## Dynamic-domain result

Changing `senderDomain` makes local `testBlueprint()` reject the sample. This
confirms ordinary draft validation binds the parsed DKIM sender domain, but it
does not validate the proposed lower-level dynamic verifier wrapper. The
wrapper must still prove that a proof valid for one asserted domain fails when
the verifier substitutes another.

## External blocker

An authenticated registry session successfully saved a minimal private draft on
2026-08-09 before the conductor blueprint API began returning HTTP 500. The
domain-gate blueprint has not compiled, so no generated project is available to
inspect. This is currently an availability blocker rather than evidence that the
blueprint is unsupported. It is tracked upstream in
[`zkemail/registry#320`](https://github.com/zkemail/registry/issues/320).

No raw corpus email was uploaded. Keep the blueprint private and use only a
synthetic fixture if compilation requires an email. When the service recovers,
pin the complete artifact set immediately according to
`blueprint/artifact-pinning.md`.
