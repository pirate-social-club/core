# Self OFAC Spike

Date: 2026-04-22

## Question

Can Pirate reliably mint a `sanctions_clear` capability from a Self verification session when the
session is configured with OFAC screening?

## Local Implementation Findings

- `SelfVerificationDisclosures` already models `ofac?: boolean | null` in the API spec.
- `self-provider.ts` currently never sets `disclosures.ofac`.
- `canonicalizeRequestedCapabilities()` only accepts `unique_human`, `age_over_18`, `nationality`,
  and `gender`. This is correct: `sanctions_clear` should not be added as a Self
  `requested_capability`.
- `verifySelfProof()` currently parses:
  - `minimum_age`
  - `nationality`
  - `gender`
  - `date_of_birth`-derived 18+
- `verifySelfProof()` does not parse any OFAC result.
- The codebase does not currently depend on `@selfxyz/core`; it uses a configured REST endpoint
  at `SELF_API_URL/v1/verify`.

## Self Documentation Findings

Self documentation confirms that `ofac` is a verification requirement in the disclosure/config
object, not a normal disclosed identity attribute:

- `disclosures.ofac: true` enables sanctions checking.
- Self docs say verification requirements must match between frontend launch config and backend
  verification config.
- `SelfBackendVerifier.verify()` returns OFAC-related result fields:
  - `isValidDetails.isOfacValid`
  - `discloseOutput.ofac`
- Technical docs describe `ofac` output as a three-element result:
  - passport number mode
  - name + date of birth mode
  - name + year of birth mode

Sources:

- https://docs.self.xyz/use-self/disclosures
- https://docs.self.xyz/sdk-reference/selfappbuilder
- https://docs.self.xyz/backend-integration/selfbackendverifier-api-reference
- https://docs.self.xyz/technical-docs/verification-in-the-identityverificationhub

## Ambiguity

The docs are not fully consistent about OFAC boolean polarity:

- Current backend verifier docs describe `isOfacValid` as an OFAC sanctions check result and include
  a comment that reads like "true if in OFAC".
- Older/npm examples describe per-mode OFAC booleans as true when the user passed the check.
- Self user-facing docs say `ofac: true` rejects sanctioned users.

Because of this, Pirate should not infer the polarity from docs alone. We need either:

1. A real Self verification response sample from `SELF_API_URL/v1/verify` with `ofac: true`, or
2. A direct SDK integration using `@selfxyz/core` where we can trust `verify()` failure/success and
   map the returned fields with tests.

## Safe Interpretation For Implementation

For a Self session where Pirate requires OFAC:

- Launch config must include `disclosures.ofac = true`.
- Backend verification config must also require OFAC.
- Completion must fail closed if the response does not prove OFAC was part of the verified config.
- Completion must fail closed if the response shape is missing any expected OFAC result field.
- Only after successful verification should Pirate write:

```json
{
  "state": "verified",
  "provider": "self",
  "proof_type": "sanctions_clear",
  "mechanism": "self_ofac",
  "verified_at": "..."
}
```

Pirate must not store raw OFAC inputs, name, DOB, passport number, or watchlist details.

## Recommendation

Proceed with code only after one of these is done:

1. Add an integration script that calls the configured Self verifier endpoint with a known mock
   passport proof using `ofac: true`, then records the sanitized response shape.
2. Replace the current generic REST verifier path with `@selfxyz/core` for backend verification and
   use its typed `VerificationResult` as the authority.

The next implementation step should be the smallest possible Self-provider change:

- Add a session-level internal flag such as `requires_self_ofac`.
- Set `disclosures.ofac = true` from that flag.
- Extend tests against the dev provider and response parser with explicit OFAC pass/fail fixtures.

Do not auto-inject sanctions gates or change composer behavior until the response polarity and
fail-closed parsing are pinned down.
