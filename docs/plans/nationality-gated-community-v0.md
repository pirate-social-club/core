# Identity-Gated Community v0 — Nationality + Passport Score Implementation Plan

## Product Decision

Lock v0 to **citizenship/nationality**, not residency.

- UI copy says "Nationality" consistently.
- Rule config uses ISO 3166-1 alpha-2 country codes (US, AR, DE, etc.).
- Accepted provider for nationality in v0 is only `self`.
- Do not introduce residency wording, residency fields, or "country" copy that suggests location rather than nationality.

The canonical nationality source is `verification_capabilities.nationality.value`, not `users.nationality`.

This document also owns the follow-on **Human Passport score-gated community** slice for
membership-scoped identity-proof gates. The nationality slice remains interactive and
Self-backed. The wallet-score slice is non-interactive and Passport-backed.

## Human Passport Score Gate Slice

### Product Decision

Support a common v0 community preset that requires a configurable Human Passport score.

- Keep this as `gate_family = identity_proof`, not `token_holding`.
- Use `gate_type = wallet_score`.
- Accepted provider is only `passport`.
- Gate config uses `minimum_score`.
- New communities should default the score input to `20`, but the saved threshold must remain configurable per gate.
- Join remediation for a missing Passport score is non-interactive. Do not route users into Self or Very for this gate.
- `human_verification_lane` stays limited to interactive providers. Do not add `passport` to that field.

Canonical serialized shape:

```json
{
  "scope": "membership",
  "gate_family": "identity_proof",
  "gate_type": "wallet_score",
  "proof_requirements": [
    {
      "proof_type": "wallet_score",
      "accepted_providers": ["passport"],
      "config": {
        "minimum_score": 20
      }
    }
  ]
}
```

### Rollout Order For Passport Score Gates

1. Contracts
2. Backend evaluator
3. Web gate preservation
4. Web create/settings UI
5. Web preview/join copy
6. Tests
7. Passport score API integration later

### Minimum Contract Changes

The wallet-score extension should stay small and targeted.

- Add `minimum_score` to `MembershipGateSummary`.
- Add `wallet_score` to the `JoinEligibility.missing_capabilities` union.
- Add `passport` to `suggested_verification_provider`.

Do not broaden `human_verification_lane` for this slice.

### Backend Behavior

`evaluateMembershipGateRules` should handle `wallet_score` explicitly instead of falling through to
the generic `unsatisfied:*` path.

Expected behavior:

- if the user has no current wallet-score capability, return:
  - `missingCapabilities = ["wallet_score"]`
  - `suggestedVerificationProvider = "passport"`
- if provider is not accepted, return `provider_not_accepted`
- if `passing_score !== true`, return a wallet-score-specific mismatch
- if `minimum_score` is configured and the current score is lower, return a wallet-score-specific mismatch

The low-level proof checker may continue to enforce the numeric comparison. The explicit evaluator
branch exists so join eligibility and UI remediation are structured rather than opaque.

### Web Behavior

The most urgent web fix is preservation.

- community settings must not silently discard existing non-nationality gates
- moderation save must round-trip unrecognized active membership gates as opaque passthrough rules until every common gate has dedicated UI
- the wallet-score gate editor should expose a single numeric score input
- the default score shown in UI is `20`
- the saved gate remains configurable

Join UX rules:

- display threshold copy such as `Requires Human Passport score 20+`
- if `missing_capabilities = ["wallet_score"]`, show a non-interactive remediation state
- do not route wallet-score remediation into Self or Very verification session launch
- below-threshold users should see a threshold failure state such as `Passport score too low`

### Non-Goals For This Slice

- do not model Passport score as an NFT or token-holding gate
- do not add live Passport score API integration as a blocker for create/edit/join enforcement
- do not add `passport` to `human_verification_lane`
- do not replace the existing nationality flow
- do not broaden token-holding self-serve configuration in public v0

---

## Repo Ownership

| Change area | Repo |
|---|---|
| API surface, schemas, examples, generated contracts source | `specs/` |
| Verification session logic, community create/join enforcement, join diagnostics, tests | `pirate-api/` |
| Community creation UI, community preview/join UI, self verification launch flow, retry logic | `pirate-web/` |
| Generated contracts (output) | `pirate-api/services/contracts/src/index.ts` — regenerated from `specs/api/src/**`, never edited directly |

---

## Implementation Order

1. Fix spec/contracts typo and update the existing schemas
2. Regenerate contracts
3. Implement backend API behavior and tests
4. Implement web creation flow
5. Implement public/preview community read flow
6. Implement join eligibility + self launch + retry flow
7. Remove top-level `User.nationality` exposure from contracts/web usage

---

## Part 1: Spec and Contract Changes

### 1A. Fix the `ucommunity_join` typo in source spec files only

**Files to change:**

1. `specs/api/src/components/schemas/verification.yaml:13`
   - Change `- ucommunity_join` to `- community_join`

Do not edit `specs/api/openapi.yaml` or `specs/api/openapi-implemented.yaml` directly. They are generated artifacts. The generated contract at `pirate-api/services/contracts/src/index.ts:179` already has `community_join` (the typo is only in the YAML source). After the source fix and regeneration, the generated outputs will match.

### 1B. Update the existing schemas in `specs/api/src/components/schemas/communities-core.yaml`

These schemas already exist in the source tree. Do not redefine `MembershipGateSummary`,
`CommunityPreview`, `JoinEligibility`, or `GateFailureDetails` from scratch. Make the additive
changes required for the wallet-score slice only:

- add `minimum_score` to `MembershipGateSummary`
- add `wallet_score` to the constrained `missing_capabilities` union in `JoinEligibility`
- add `passport` to `suggested_verification_provider` in `JoinEligibility`
- add the same `wallet_score` / `passport` union expansion where `GateFailureDetails` constrains those fields
- leave `human_verification_lane` unchanged

Target additive patch:

```yaml
MembershipGateSummary:
  type: object
  required:
    - gate_type
  properties:
    minimum_score:
      type: number
      nullable: true
      description: Minimum Human Passport wallet score when gate_type is wallet_score

JoinEligibility:
  type: object
  properties:
    missing_capabilities:
      type: array
      items:
        type: string
        enum:
          - unique_human
          - age_over_18
          - nationality
          - gender
          - wallet_score
    suggested_verification_provider:
      type: string
      enum:
        - self
        - very
        - passport
      nullable: true

GateFailureDetails:
  type: object
  properties:
    suggested_verification_provider:
      type: string
      enum:
        - self
        - very
        - passport
      nullable: true
```

The summary addition is necessary because preview/sidebar/join surfaces need to show threshold copy
such as `Requires Human Passport score 20+`.

### 1C. Add preview and join-eligibility endpoints in source path files

Add paths in `specs/api/src/paths/communities.yaml` for:

```
GET /communities/{community_id}/preview     -> CommunityPreview
GET /communities/{community_id}/join-eligibility -> JoinEligibility
```

Follow the same pattern as the existing `GET /communities/{community_id}` endpoint for path params and auth.

Important:
- Set `x-implemented: true` on both new operations so they survive the implemented-surface filter into `specs/api/openapi-implemented.yaml`.
- Do not hand-edit `specs/api/openapi.yaml` or `specs/api/openapi-implemented.yaml`; regenerate them from `specs/api/src/**`.

### 1D. Add nationality create example to spec

In `specs/api/src/components/schemas/communities-core.yaml`, add an `example` to the `CreateCommunityRequestBase.gate_rules` property:

```yaml
gate_rules:
  type: array
  items:
    $ref: ./communities-core.yaml#/GateRuleInput
  nullable: true
  example:
    - scope: membership
      gate_family: identity_proof
      gate_type: nationality
      proof_requirements:
        - proof_type: nationality
          accepted_providers:
            - self
          config:
            required_value: US
  description: |
    ...
```

### 1E. Remove `User.nationality` from spec

**File:** `specs/api/src/components/schemas/users.yaml:48-51`

Remove:

```yaml
    nationality:
      type: string
      nullable: true
      description: ISO country code when the current accepted identity includes nationality
```

### 1F. Add new type exports to contract generator

**File:** `specs/api/scripts/generate-api-contracts.ts`

Add to `TYPE_EXPORTS` array (after `CreateCommunityRequest`):

```ts
  { name: "MembershipGateSummary", ref: "#/components/schemas/MembershipGateSummary" },
  { name: "CommunityPreview", ref: "#/components/schemas/CommunityPreview" },
  { name: "JoinEligibility", ref: "#/components/schemas/JoinEligibility" },
  { name: "GateFailureDetails", ref: "#/components/schemas/GateFailureDetails" },
```

Add to `ROUTE_EXPORTS` array (after `community`):

```ts
  { name: "communityPreview", path: "/communities/{community_id}/preview" },
  { name: "communityJoinEligibility", path: "/communities/{community_id}/join-eligibility" },
```

### 1G. Regenerate bundled spec and contracts

After editing `specs/api/src/**`, run the full spec verification flow from the workspace root:

```bash
rtk bun specs/api/scripts/verify-openapi.ts
```

Verify that `pirate-api/services/contracts/src/index.ts` now:
- Has `VerificationIntent` with `community_join` (not `ucommunity_join`)
- Exports `MembershipGateSummary`, `CommunityPreview`, `JoinEligibility`, `GateFailureDetails`
- Exports `apiRoutes.communityPreview` and `apiRoutes.communityJoinEligibility`
- No longer has `nationality` on the `User` type
- `ErrorResponse.code` still includes `verification_required` and `gate_failed`

Also review the generated diffs in:
- `specs/api/openapi.yaml`
- `specs/api/openapi-implemented.yaml`
- `pirate-api/services/contracts/src/index.ts`

---

## Part 2: Backend API Changes

### 2A. Nationality gate validation on community create

**File:** `pirate-api/services/api/src/lib/communities/community-service.ts`

The existing `assertCreateRequest` (line 340) already validates provider matrix. Add stricter nationality-specific validation inside the `for (const rule of body.gate_rules ?? [])` loop at line 370, after the provider check:

```ts
      if (rule.gate_type === "nationality") {
        const req = rule.proof_requirements?.[0]
        if (!req || req.proof_type !== "nationality") {
          throw eligibilityFailed(
            "Nationality gate must include exactly one proof requirement with proof_type nationality",
          )
        }
        const acceptedProviders = req.accepted_providers ?? []
        if (acceptedProviders.length !== 1 || acceptedProviders[0] !== "self") {
          throw eligibilityFailed(
            "Nationality gate in v0 only accepts self as provider",
          )
        }
        const config = (req.config ?? rule.gate_config ?? {}) as Record<string, unknown>
        const requiredValue = typeof config.required_value === "string" ? config.required_value : null
        if (!requiredValue || !/^[A-Z]{2}$/.test(requiredValue)) {
          throw eligibilityFailed(
            "Nationality gate requires a valid ISO 3166-1 alpha-2 required_value (e.g. US, AR, DE)",
          )
        }
      }
```

Use `eligibilityFailed(...)`, not `badRequestError(...)`, for these public-v0 rule violations so the new validation remains consistent with the rest of `assertCreateRequest`.

This ensures:
- A nationality gate has exactly one proof requirement with `proof_type: "nationality"`
- `accepted_providers` is `["self"]`
- `required_value` is a valid 2-letter uppercase ISO code
- `excluded_values` is allowed in the backend but not exposed in the v0 web UI

### 2B. Community preview endpoint

**File:** `pirate-api/services/api/src/lib/communities/community-service.ts`

Add new exported function:

```ts
export async function getCommunityPreview(input: {
  env: Env
  bearerToken: string
  communityId: string
  communityRepository: CommunityRepository
}): Promise<CommunityPreview> {
  const session = await verifyPirateAccessToken({ env: input.env, token: input.bearerToken })
  const community = await input.communityRepository.getCommunityById(input.communityId)
  if (!community || community.provisioning_state !== "active" || community.status !== "active") {
    throw notFoundError("Community not found")
  }

  const binding = await input.communityRepository.getPrimaryCommunityDatabaseBinding(input.communityId)
  const local = binding ? await readLocalCommunity(binding.database_url, input.communityId).catch(() => null) : null

  const db = await openCommunityDb(input.communityRepository, input.communityId)
  try {
    const gateRules = await listActiveMembershipGateRules(db.client, input.communityId)
    const membershipState = await getCommunityMembershipState(db.client, input.communityId, session.userId)

    let viewerMembershipStatus: CommunityPreview["viewer_membership_status"]
    if (canAccessCommunity(membershipState)) {
      viewerMembershipStatus = "member"
    } else if (membershipState.membership_status === "banned") {
      viewerMembershipStatus = "banned"
    } else {
      viewerMembershipStatus = "not_member"
    }

    const gateSummaries: MembershipGateSummary[] = gateRules.map(buildGateSummary)

    return {
      community_id: community.community_id,
      display_name: community.display_name,
      description: local?.description ?? null,
      membership_mode: local?.membership_mode === "request" ? "open" : (local?.membership_mode ?? "open"),
      member_count: null,
      membership_gate_summaries: gateSummaries,
      viewer_membership_status,
      created_at: community.created_at,
    }
  } finally {
    db.close()
  }
}
```

Notes:
- `CommunityRow` does not currently contain `description` or `membership_mode`; those values come from the local community snapshot, so preview must load local community state.
- `viewer_membership_status` does not include a `pending` variant in v0. Users with pending membership requests are reported as `not_member`. If pending state is needed later, add a `hasPendingMembershipRequest` helper that reads `membership_requests` and add `pending` back to the contract.

Add helper function:

```ts
function buildGateSummary(rule: CommunityGateRuleRow): MembershipGateSummary {
  const requirements = parseProofRequirements(rule.proof_requirements_json, rule.gate_type)
  const gateConfig = parseGateConfig(rule.gate_config_json)
  const primaryReq = requirements[0]

  const summary: MembershipGateSummary = {
    gate_type: rule.gate_type as MembershipGateSummary["gate_type"],
  }

  if (primaryReq?.accepted_providers?.length) {
    summary.accepted_providers = primaryReq.accepted_providers as MembershipGateSummary["accepted_providers"]
  }

  if (rule.gate_type === "nationality") {
    const config = (primaryReq?.config ?? gateConfig ?? {}) as Record<string, unknown>
    if (typeof config.required_value === "string") {
      summary.required_value = config.required_value
    }
    if (Array.isArray(config.excluded_values)) {
      summary.excluded_values = config.excluded_values.filter((v): v is string => typeof v === "string")
    }
  }

  return summary
}
```

Import `CommunityPreview` and `MembershipGateSummary` from the contract types. They will be available after Part 1G.

**File:** `pirate-api/services/api/src/routes/communities.ts`

Add new route after the existing `GET /:communityId`:

```ts
communities.get("/:communityId/preview", async (c) => {
  try {
    const token = requireBearerToken(c.req.header("authorization"))
    const result = await getCommunityPreview({
      env: c.env,
      bearerToken: token,
      communityId: c.req.param("communityId"),
      communityRepository: getControlPlaneCommunityRepository(c.env),
    })
    return c.json(result, 200)
  } catch (error) {
    const response = errorResponse(error)
    return new Response(JSON.stringify(response.body), {
      status: response.status,
      headers: { "content-type": "application/json" },
    })
  }
})
```

### 2C. Join eligibility endpoint

**File:** `pirate-api/services/api/src/lib/communities/community-service.ts`

Add new exported function:

```ts
export async function getJoinEligibility(input: {
  env: Env
  bearerToken: string
  communityId: string
  userRepository: UserRepository
  communityRepository: CommunityRepository
}): Promise<JoinEligibility> {
  const session = await verifyPirateAccessToken({ env: input.env, token: input.bearerToken })
  const user = await input.userRepository.getUserById(session.userId)
  if (!user) {
    throw internalError("Resolved user row is missing for join eligibility")
  }

  const community = await input.communityRepository.getCommunityById(input.communityId)
  if (!community || community.provisioning_state !== "active" || community.status !== "active") {
    throw notFoundError("Community not found")
  }

  const binding = await input.communityRepository.getPrimaryCommunityDatabaseBinding(input.communityId)
  const local = binding ? await readLocalCommunity(binding.database_url, input.communityId).catch(() => null) : null
  const membershipMode = local?.membership_mode === "request" ? "open" : (local?.membership_mode ?? "open")

  const db = await openCommunityDb(input.communityRepository, input.communityId)
  try {
    const membershipState = await getCommunityMembershipState(db.client, input.communityId, session.userId)

    if (canAccessCommunity(membershipState)) {
      return {
        community_id: input.communityId,
        membership_mode: membershipMode,
        joinable_now: false,
        status: "already_joined",
        membership_gate_summaries: [],
        missing_capabilities: [],
      }
    }

    if (membershipState.membership_status === "banned") {
      return {
        community_id: input.communityId,
        membership_mode: membershipMode,
        joinable_now: false,
        status: "banned",
        membership_gate_summaries: [],
        missing_capabilities: [],
      }
    }

    if (!satisfiesBaselineJoinGate(user)) {
      return {
        community_id: input.communityId,
        membership_mode: membershipMode,
        joinable_now: false,
        status: "verification_required",
        membership_gate_summaries: [],
        missing_capabilities: ["unique_human"],
        suggested_verification_provider: "self",
        suggested_verification_intent: "community_join",
      }
    }

    if (membershipMode === "open") {
      return {
        community_id: input.communityId,
        membership_mode: "open",
        joinable_now: true,
        status: "joinable",
        membership_gate_summaries: [],
        missing_capabilities: [],
      }
    }

    const rules = await listActiveMembershipGateRules(db.client, input.communityId)
    const evaluation = evaluateMembershipGateRules(rules, user)
    const gateSummaries = rules.map(buildGateSummary)

    if (evaluation.satisfied) {
      return {
        community_id: input.communityId,
        membership_mode: "gated",
        joinable_now: true,
        status: "joinable",
        membership_gate_summaries: gateSummaries,
        missing_capabilities: [],
      }
    }

    if (evaluation.missingCapabilities.length > 0) {
      return {
        community_id: input.communityId,
        membership_mode: "gated",
        joinable_now: false,
        status: "verification_required",
        membership_gate_summaries: gateSummaries,
        missing_capabilities: evaluation.missingCapabilities,
        suggested_verification_provider: evaluation.suggestedVerificationProvider,
        suggested_verification_intent: evaluation.missingCapabilities.includes("nationality") ? "community_join" : null,
      }
    }

    return {
      community_id: input.communityId,
      membership_mode: "gated",
      joinable_now: false,
      status: "gate_failed",
      membership_gate_summaries: gateSummaries,
      missing_capabilities: [],
    }
  } finally {
    db.close()
  }
}
```

Note: `CommunityRow` does not contain `membership_mode`. Join eligibility reads it from the local community snapshot via `readLocalCommunity`, same as preview. The `membership_mode === "request"` path is normalized to `"open"` for v0 since request-to-join is not a supported join mode in this version.

### 2D. Refactor gate evaluation from boolean-only to diagnostic result

**File:** `pirate-api/services/api/src/lib/communities/community-membership-store.ts`

Add a new diagnostic evaluator. Keep the existing `satisfiesMembershipGateRules` for backward compatibility but also export:

```ts
export type MembershipGateEvaluation = {
  satisfied: boolean
  missingCapabilities: Array<"unique_human" | "age_over_18" | "nationality" | "gender">
  mismatchReasons: string[]
  summaries: Array<{
    gate_type: string
    required_value?: string | null
  }>
  suggestedVerificationProvider: "self" | "very" | null
}

export function evaluateMembershipGateRules(
  rules: CommunityGateRuleRow[],
  user: User,
): MembershipGateEvaluation {
  if (rules.length === 0) {
    return {
      satisfied: false,
      missingCapabilities: [],
      mismatchReasons: ["no_active_gate_rules"],
      summaries: [],
      suggestedVerificationProvider: null,
    }
  }

  const missingCapabilities: MembershipGateEvaluation["missingCapabilities"] = []
  const mismatchReasons: string[] = []
  const summaries: MembershipGateEvaluation["summaries"] = []
  let suggestedProvider: "self" | "very" | null = null

  for (const rule of rules) {
    if (rule.gate_family !== "identity_proof") {
      mismatchReasons.push(`unsupported_gate_family:${rule.gate_family}`)
      continue
    }

    const gateConfig = parseGateConfig(rule.gate_config_json)
    const requirements = parseProofRequirements(rule.proof_requirements_json, rule.gate_type)

    const summary: MembershipGateEvaluation["summaries"][number] = {
      gate_type: rule.gate_type,
    }

    for (const requirement of requirements) {
      const config = (requirement.config ?? gateConfig ?? {}) as Record<string, unknown>

      switch (requirement.proof_type) {
        case "nationality": {
          const capability = user.verification_capabilities.nationality
          if (typeof config.required_value === "string") {
            summary.required_value = config.required_value
          }
          if (capability.state !== "verified") {
            missingCapabilities.push("nationality")
            if (includesAcceptedProvider(requirement.accepted_providers, "self")) {
              suggestedProvider = "self"
            }
          } else if (!includesAcceptedProvider(requirement.accepted_providers, capability.provider)) {
            mismatchReasons.push("provider_not_accepted")
          } else {
            const requiredValue = typeof config.required_value === "string" ? config.required_value : null
            const excludedValues = Array.isArray(config.excluded_values)
              ? config.excluded_values.filter((v): v is string => typeof v === "string")
              : []
            if (requiredValue && capability.value !== requiredValue) {
              mismatchReasons.push("nationality_mismatch")
            }
            if (capability.value && excludedValues.includes(capability.value)) {
              mismatchReasons.push("nationality_excluded")
            }
          }
          break
        }
        case "unique_human": {
          const capability = user.verification_capabilities.unique_human
          if (capability.state !== "verified") {
            missingCapabilities.push("unique_human")
            if (includesAcceptedProvider(requirement.accepted_providers, "self")) {
              suggestedProvider = suggestedProvider ?? "self"
            }
            if (includesAcceptedProvider(requirement.accepted_providers, "very")) {
              suggestedProvider = suggestedProvider ?? "very"
            }
          } else if (!includesAcceptedProvider(requirement.accepted_providers, capability.provider)) {
            mismatchReasons.push("provider_not_accepted")
          }
          break
        }
        case "age_over_18": {
          const capability = user.verification_capabilities.age_over_18
          if (capability.state !== "verified") {
            missingCapabilities.push("age_over_18")
            if (includesAcceptedProvider(requirement.accepted_providers, "self")) {
              suggestedProvider = suggestedProvider ?? "self"
            }
          } else if (!includesAcceptedProvider(requirement.accepted_providers, capability.provider)) {
            mismatchReasons.push("provider_not_accepted")
          }
          break
        }
        default:
          if (!satisfiesProofRequirement(user, requirement, gateConfig)) {
            mismatchReasons.push(`unsatisfied:${requirement.proof_type}`)
          }
      }
    }

    summaries.push(summary)
  }

  return {
    satisfied: missingCapabilities.length === 0 && mismatchReasons.length === 0,
    missingCapabilities,
    mismatchReasons,
    summaries,
    suggestedVerificationProvider: suggestedProvider,
  }
}
```

### 2E. Improve join endpoint error responses

**File:** `pirate-api/services/api/src/lib/communities/community-service.ts`

Update `joinCommunity` (line 666). Replace the two opaque error paths with diagnostic errors.

**Baseline gate failure (line 679):**

Change from:
```ts
throw gateFailed("A platform trust credential is required to join this community")
```

To:
```ts
throw gateFailedWithDetails("A platform trust credential is required to join this community", {
  membership_gate_summaries: [],
  missing_capabilities: ["unique_human"],
  suggested_verification_provider: "self",
  suggested_verification_intent: "community_join",
  failure_reason: "missing_verification",
})
```

**Membership gate failure (line 733-734):**

Change from:
```ts
if (!satisfiesMembershipGateRules(rules, user)) {
  throw gateFailed("Community membership requirements are not satisfied")
}
```

To:
```ts
const evaluation = evaluateMembershipGateRules(rules, user)
if (!evaluation.satisfied) {
  const gateSummaries = rules.map(buildGateSummary)
  if (evaluation.missingCapabilities.length > 0) {
    throw gateFailedWithDetails(
      "Verification is required to join this community",
      {
        membership_gate_summaries: gateSummaries,
        missing_capabilities: evaluation.missingCapabilities,
        suggested_verification_provider: evaluation.suggestedVerificationProvider,
        suggested_verification_intent: evaluation.missingCapabilities.includes("nationality")
          ? "community_join"
          : null,
        failure_reason: "missing_verification",
      },
    )
  }
  if (evaluation.mismatchReasons.includes("nationality_mismatch")) {
    throw gateFailedWithDetails(
      "Your verified nationality does not satisfy this community requirement",
      {
        membership_gate_summaries: gateSummaries,
        failure_reason: "nationality_mismatch",
      },
    )
  }
  throw gateFailedWithDetails(
    "Community membership requirements are not satisfied",
    {
      membership_gate_summaries: gateSummaries,
      failure_reason: "unsupported",
    },
  )
}
```

### 2F. Add `gateFailedWithDetails` error helper

**File:** `pirate-api/services/api/src/lib/errors.ts`

The current `HttpError` only carries `code` and `message`. We need to carry structured `details` on certain errors.

Option A (preferred — minimal change): Add an optional `details` field to `HttpError`:

```ts
export class HttpError extends Error {
  readonly status: number
  readonly code: string
  readonly retryable: boolean
  readonly details: Record<string, unknown> | null

  constructor(status: number, code: string, message: string, retryable = false, details: Record<string, unknown> | null = null) {
    super(message)
    this.status = status
    this.code = code
    this.retryable = retryable
    this.details = details
  }
}
```

Update `errorResponse` to include details when present:

```ts
export function errorResponse(error: unknown): { status: number; body: { code: string; message: string; retryable?: boolean; details?: Record<string, unknown> | null } } {
  if (error instanceof HttpError) {
    return {
      status: error.status,
      body: {
        code: error.code,
        message: error.message,
        retryable: error.retryable,
        ...(error.details ? { details: error.details } : {}),
      },
    }
  }

  const message = error instanceof Error ? error.message : "Internal server error"
  return {
    status: 500,
    body: {
      code: "internal_error",
      message,
      retryable: false,
    },
  }
}
```

Add convenience helper:

```ts
export function gateFailedWithDetails(message: string, details: Record<string, unknown>): HttpError {
  return new HttpError(403, "gate_failed", message, false, details)
}
```

**Error code decision for join denials:** All join denials use `gate_failed` with structured `details` to distinguish remediable from non-remediable cases. Do not use `verificationRequired` or `eligibilityFailed` for join-time denials. The web client distinguishes intent via `details.failure_reason`:
- `"missing_verification"` → remediable, show "Verify to Join" CTA
- `"nationality_mismatch"` → non-remediable, show blocking message
- `"unsupported"` → generic non-remediable

The `JoinEligibility` endpoint returns `status: "verification_required"` as a *read* response, but the join *mutation* endpoint returns `gate_failed` with `details.failure_reason: "missing_verification"`. This distinction is intentional: eligibility is informational (no side effects), join is a state-changing action that can fail.

Update the `ErrorResponse` contract type in `specs/api/src/components/schemas/common.yaml` (or wherever `Error` schema lives) to include:

```yaml
    details:
      type: object
      nullable: true
      additionalProperties: true
```

Then regenerate contracts.

### 2G. Add preview and join-eligibility routes

**File:** `pirate-api/services/api/src/routes/communities.ts`

Add after the preview route from 2B:

```ts
communities.get("/:communityId/join-eligibility", async (c) => {
  try {
    const token = requireBearerToken(c.req.header("authorization"))
    const result = await getJoinEligibility({
      env: c.env,
      bearerToken: token,
      communityId: c.req.param("communityId"),
      userRepository: getUserRepository(c.env),
      communityRepository: getControlPlaneCommunityRepository(c.env),
    })
    return c.json(result, 200)
  } catch (error) {
    const response = errorResponse(error)
    return new Response(JSON.stringify(response.body), {
      status: response.status,
      headers: { "content-type": "application/json" },
    })
  }
})
```

### 2H. Self verification for community_join — no blocking restriction

The backend verification stack already supports the nationality join path without any hidden restrictions. This has been verified against the source:

- `canonicalizeRequestedCapabilities` in `self-provider.ts:9-19` handles `nationality` correctly (implicitly adds `unique_human` and sorts to canonical order).
- `mapCapabilitiesToDisclosures` in `self-provider.ts:22-34` sets `nationality: true` in disclosures.
- `startVerificationSession` in `control-plane-verification-repository.ts:641-651` passes `verification_intent` through to the DB unchanged. The `very` provider rejects non-`unique_human` caps at line 625, but that guard is on `provider === "very"`, not `self`.
- `completeVerificationSession` in `control-plane-verification-repository.ts:968-987` mints the nationality capability from `selfClaims.nationality` when `capsToMint` includes `"nationality"` and `row.provider === "self"`.
- `VALID_PUBLIC_V0_PROVIDERS_BY_PROOF_TYPE` in `community-service.ts:40-47` already includes `nationality: new Set(["self"])`.

No backend change is required to unblock `provider: "self", requested_capabilities: ["nationality"], verification_intent: "community_join"`. The only work is the typo fix (Part 1A) and adding tests (Part 2I).

### 2I. Remove top-level `User.nationality` from serializer

**File:** `pirate-api/services/api/src/lib/auth/control-plane-auth-serializers.ts:52-65`

In `serializeUser`, the old top-level row field was removed:

```ts
    // removed: nationality was folded into verification_capabilities.nationality
```

The `User` type from the regenerated contracts will no longer have `nationality` after Part 1E/1G, so the TypeScript compiler will catch this if you forget to remove it.

### 2J. Backend test plan

**File:** Create or extend `pirate-api/services/api/tests/community-routes.test.ts`

Tests to add (using `setSelfProviderForTests` for realistic nationality claims):

1. **Create nationality-gated community with valid rule**
   - POST `/communities` with `gate_rules: [{ scope: "membership", gate_family: "identity_proof", gate_type: "nationality", proof_requirements: [{ proof_type: "nationality", accepted_providers: ["self"], config: { required_value: "US" } }] }]`
   - Assert 202, community returned, gate rule stored

2. **Create nationality-gated community missing `required_value`**
   - POST `/communities` with nationality gate but no `config.required_value`
   - Assert 403 with `eligibility_failed` code

3. **Create nationality-gated community with invalid provider**
   - POST `/communities` with nationality gate and `accepted_providers: ["very"]`
   - Assert 403 with `eligibility_failed`

4. **Create nationality-gated community with invalid ISO code**
   - POST `/communities` with `required_value: "USA"` (3 chars)
   - Assert 403 with `eligibility_failed` code

5. **Community preview returns gate summaries**
   - GET `/communities/:id/preview` for nationality-gated community
   - Assert `membership_gate_summaries` includes `{ gate_type: "nationality", accepted_providers: ["self"], required_value: "US" }`

6. **Join eligibility: missing nationality returns `verification_required`**
   - User without verified nationality
   - GET `/communities/:id/join-eligibility`
   - Assert `status: "verification_required"`, `missing_capabilities: ["nationality"]`, `suggested_verification_provider: "self"`, `suggested_verification_intent: "community_join"`

7. **Join eligibility: nationality mismatch returns `gate_failed`**
   - User with verified nationality "AR" from self
   - Community requires "US"
   - GET `/communities/:id/join-eligibility`
   - Assert `status: "gate_failed"`, `missing_capabilities: []`

8. **Join eligibility: matching nationality returns `joinable`**
   - User with verified nationality "US" from self
   - Community requires "US"
   - GET `/communities/:id/join-eligibility`
   - Assert `status: "joinable"`, `joinable_now: true`

9. **Join denied before nationality proof**
   - User without verified nationality
   - POST `/communities/:id/join`
   - Assert 403 with `gate_failed`, `details.missing_capabilities` includes "nationality", `details.suggested_verification_provider: "self"`, `details.suggested_verification_intent: "community_join"`

10. **Join allowed after self nationality proof with matching value**
    - Set `setSelfProviderForTests` to return `nationality: "US"`
    - Start and complete a self verification session with `requested_capabilities: ["nationality"]`, `verification_intent: "community_join"`
    - POST `/communities/:id/join`
    - Assert 200, `status: "joined"`

11. **Join denied after self nationality proof with non-matching value**
    - Set `setSelfProviderForTests` to return `nationality: "AR"`
    - Complete verification
    - POST `/communities/:id/join` for community requiring "US"
    - Assert 403 with `gate_failed`, `details.failure_reason: "nationality_mismatch"`

12. **Join eligibility: already joined returns `already_joined`**
    - User already a member
    - GET `/communities/:id/join-eligibility`
    - Assert `status: "already_joined"`, `joinable_now: false`

**Testing self nationality locally:**

Use `setSelfProviderForTests` with a mock that returns specific nationality claims:

```ts
import { setSelfProviderForTests } from "../lib/verification/self-provider"

const mockSelfProvider = {
  async startSession() { /* ... */ },
  async getSessionOutcome() {
    return {
      status: "verified" as const,
      claims: { age_over_18: true, nationality: "US" },
    }
  },
}
setSelfProviderForTests(mockSelfProvider)
```

Do not rely on the default dev stub that returns `nationality: null`.

---

## Part 3: Web Create Flow

### 3A. Replace `Set<GateType>` with typed gate drafts

**File:** `pirate-web/src/components/compositions/create-community-composer/create-community-composer.types.ts`

Replace the current types with:

```ts
import type { CommunityMembershipMode } from "@/lib/community-membership"

export type { CommunityMembershipMode }
export type CommunityDefaultAgeGatePolicy = "none" | "18_plus"

export type AnonymousIdentityScope = "community_stable" | "thread_stable" | "post_ephemeral"

export type NationalityGateDraft = {
  gateType: "nationality"
  acceptedProviders: ["self"]
  requiredValue: string
}

export type GenderGateDraft = {
  gateType: "gender"
  acceptedProviders: ["self"]
  requiredValue: "M" | "F"
}

export type WalletScoreGateDraft = {
  gateType: "wallet_score"
  acceptedProviders: ["passport"]
  minimumScore: number
}

export type EditableGateDraft =
  | NationalityGateDraft
  | GenderGateDraft
  | WalletScoreGateDraft

export type PassthroughMembershipGateRule = {
  gateRuleId: string
  rule: Record<string, unknown>
}

export type GateDraft = EditableGateDraft

export type ComposerStep = 1 | 2 | 3

export interface CreatorVerificationState {
  uniqueHumanVerified: boolean
  ageOver18Verified: boolean
}

export interface CreateCommunityComposerProps {
  displayName?: string
  description?: string
  membershipMode?: CommunityMembershipMode
  defaultAgeGatePolicy?: CommunityDefaultAgeGatePolicy
  allowAnonymousIdentity?: boolean
  anonymousIdentityScope?: AnonymousIdentityScope
  creatorVerificationState?: CreatorVerificationState
  initialStep?: ComposerStep
  onCreate?: (input: {
    displayName: string
    description: string | null
    membershipMode: CommunityMembershipMode
    defaultAgeGatePolicy: CommunityDefaultAgeGatePolicy
    allowAnonymousIdentity: boolean
    anonymousIdentityScope: AnonymousIdentityScope
    gateDrafts: GateDraft[]
    passthroughMembershipGateRules?: PassthroughMembershipGateRule[]
  }) => Promise<{
    communityId: string
  }>
}
```

Key differences from current:
- `gateTypes: Set<GateType>` replaced with `gateDrafts: GateDraft[]`
- `NationalityGateDraft` requires `requiredValue` (ISO alpha-2 code)
- `WalletScoreGateDraft` is first-class and carries `minimumScore`
- `PassthroughMembershipGateRule[]` preserves active gates the current UI cannot edit yet
- `GateFamily` and `GateType` string-union types removed (they were only used for the chip matrix)
- `onCreate` input type uses `gateDrafts` instead of `gateTypes`

### 3B. Update composer component

**File:** `pirate-web/src/components/compositions/create-community-composer/create-community-composer.tsx`

#### Replace chip matrix with nationality-specific UI

Remove:
- `gateTypeMeta` constant (lines 61-70)
- `identityGateTypes` array (line 72)
- `activeGateTypes` state (line 206)
- `toggleGateType` callback (lines 234-244)

Replace with:
- `activeGateDrafts` state: `const [activeGateDrafts, setActiveGateDrafts] = React.useState<GateDraft[]>([])`
- `selectedNationality` derived state: `const selectedNationality = activeGateDrafts.find((d): d is NationalityGateDraft => d.gateType === "nationality")`
- A `NationalityPicker` component (see 3C below)
- When membership mode is "gated", show:
  - A "Nationality" option card (or similar) that, when selected, shows the country picker
  - A "Human Passport score" option card (or similar) that, when selected, shows a numeric threshold input defaulted to `20`
  - Existing gender controls if they remain in scope for the same surface
  - No generic chip matrix fallback for common v0 identity-proof gates

#### Update `handleCreate`

Replace the current `handleCreate` (line 246) to pass `gateDrafts`:

```ts
const handleCreate = React.useCallback(() => {
  if (!onCreate) return

  setSubmitting(true)
  void onCreate({
    displayName: activeDisplayName.trim(),
    description: activeDescription.trim() || null,
    membershipMode: activeMembershipMode,
    defaultAgeGatePolicy: activeDefaultAgeGatePolicy,
    allowAnonymousIdentity: activeAllowAnonymousIdentity,
    anonymousIdentityScope: activeAnonymousScope,
    gateDrafts: activeGateDrafts,
  })
    .catch((error: unknown) => {
      toast.error(error instanceof Error ? error.message : "Could not create community")
    })
    .finally(() => {
      setSubmitting(false)
    })
}, [
  onCreate,
  activeDisplayName,
  activeDescription,
  activeMembershipMode,
  activeDefaultAgeGatePolicy,
  activeAllowAnonymousIdentity,
  activeAnonymousScope,
  activeGateDrafts,
])
```

#### Update validation

The `canProceed` and `canCreateCommunity` checks need to validate that:
- If membership mode is "gated", `activeGateDrafts.length > 0`
- If a nationality draft is present, `requiredValue` is non-empty
- A nationality draft without a selected country is invalid

```ts
const hasValidGateDrafts = React.useMemo(() => {
  if (activeMembershipMode !== "gated") return true
  if (activeGateDrafts.length === 0) return false
  return activeGateDrafts.every((draft) => {
    if (draft.gateType === "nationality") return draft.requiredValue.length === 2
    return true
  })
}, [activeMembershipMode, activeGateDrafts])
```

Update `canProceed` case 2 and `canCreateCommunity` to use `hasValidGateDrafts` instead of `activeGateTypes.size > 0`.

#### Update review step

Replace the generic "Membership gates" review field with specific output for each draft type.

For nationality:
- Label: "Membership gate"
- Value: "Nationality: United States (US)" (human-readable country name + code)

Remove the old `Array.from(activeGateTypes).map(...)` rendering.

### 3C. Add nationality picker component

**File:** Create `pirate-web/src/components/compositions/create-community-composer/nationality-picker.tsx`

This component should:

Props:
```ts
interface NationalityPickerProps {
  value: string | null
  onChange: (code: string | null) => void
}
```

Implementation:
- Searchable dropdown/combobox of ISO 3166-1 alpha-2 countries
- Stores the 2-letter code, not the display label
- Shows human-readable country name in the trigger/display
- Validates that the selected code is a real ISO alpha-2 code

Country data source:
- Use a compact static dataset. Do not add an npm dependency for this. Create a `pirate-web/src/lib/countries.ts` file that exports `COUNTRIES: Array<{ code: string; name: string }>` sorted alphabetically by name.
- Use the standard ISO 3166-1 alpha-2 list. There are ~250 entries. This is small enough to embed.

Follow existing UI patterns: use the project's existing Select/Combobox primitives if available, otherwise use a controlled Input with a filtered dropdown.

### 3D. Serialize `gate_rules` on create

**File:** `pirate-web/src/app/pages.tsx`

Update `handleCreate` (line 974) to convert `gateDrafts` into the API `gate_rules` shape:

```ts
const handleCreate = React.useCallback(async (input: {
  displayName: string
  description: string | null
  membershipMode: "open" | "gated"
  defaultAgeGatePolicy: "none" | "18_plus"
  allowAnonymousIdentity: boolean
  anonymousIdentityScope: "community_stable" | "thread_stable" | "post_ephemeral"
  gateDrafts: GateDraft[]
  passthroughMembershipGateRules?: PassthroughMembershipGateRule[]
}) => {
  try {
    const gateRules = input.gateDrafts.map((draft): Record<string, unknown> => {
      if (draft.gateType === "nationality") {
        return {
          scope: "membership",
          gate_family: "identity_proof",
          gate_type: "nationality",
          proof_requirements: [
            {
              proof_type: "nationality",
              accepted_providers: ["self"],
              config: { required_value: draft.requiredValue },
            },
          ],
        }
      }
      if (draft.gateType === "gender") {
        return {
          scope: "membership",
          gate_family: "identity_proof",
          gate_type: "gender",
          proof_requirements: [
            {
              proof_type: "gender",
              accepted_providers: ["self"],
              config: { required_value: draft.requiredValue },
            },
          ],
        }
      }
      if (draft.gateType === "wallet_score") {
        return {
          scope: "membership",
          gate_family: "identity_proof",
          gate_type: "wallet_score",
          proof_requirements: [
            {
              proof_type: "wallet_score",
              accepted_providers: ["passport"],
              config: { minimum_score: draft.minimumScore },
            },
          ],
        }
      }
      throw new Error(`Unsupported gate type: ${(draft as { gateType: string }).gateType}`)
    })

    const mergedGateRules = [
      ...gateRules,
      ...(input.passthroughMembershipGateRules?.map((entry) => entry.rule) ?? []),
    ]

    const result = await api.communities.create({
      display_name: input.displayName,
      description: input.description,
      membership_mode: input.membershipMode,
      default_age_gate_policy: input.defaultAgeGatePolicy,
      allow_anonymous_identity: input.allowAnonymousIdentity,
      anonymous_identity_scope: input.anonymousIdentityScope,
      handle_policy: { policy_template: "standard" },
      governance_mode: "centralized",
      gate_rules: mergedGateRules.length > 0 ? mergedGateRules : undefined,
    })

    navigate(`/c/${result.community.community_id}`)
    return { communityId: result.community.community_id }
  } catch (e: unknown) {
    const apiError = e as ApiError
    throw new Error(apiError?.message ?? "Community creation failed")
  }
}, [api, navigate])
```

After regenerating contracts, update `api.communities.create` in `pirate-web/src/lib/api/client.ts:226` to use the generated `GateRuleInput[]` type instead of `unknown[] | null` for the `gate_rules` parameter. The current `unknown[]` typing bypasses the contract; the regenerated `CreateCentralizedCommunityRequest` will carry `gate_rules?: Array<GateRuleInput>`, and the API client should reflect that.

For wallet-score gates specifically:

- serialize `accepted_providers: ["passport"]`
- serialize `config.minimum_score`
- do not use `required_value`
- preserve opaque active membership rules that the current UI cannot edit yet

### 3E. Wallet score composer UI and preservation path

The wallet-score gate is a first-class common gate, not an opaque admin-only edge case.

**Files to update:**

- `pirate-web/src/components/compositions/create-community-composer/create-community-composer.types.ts`
- `pirate-web/src/components/compositions/create-community-composer/create-community-composer.tsx`
- `pirate-web/src/app/authenticated-routes/create-community-route.tsx`
- `pirate-web/src/app/authenticated-routes/moderation-helpers.ts`
- `pirate-web/src/app/authenticated-routes/moderation-state.tsx`
- `pirate-web/src/lib/identity-gates.ts`
- `pirate-web/src/app/authenticated-routes/community-sidebar-helpers.ts`

#### Composer / settings UI

Add a dedicated wallet-score gate row beside the existing identity-gate controls.

- label: `Human Passport score`
- control: numeric input
- default value for new drafts: `20`
- stored value: `minimumScore`
- provider is fixed to `passport`

Do not hide this behind a generic advanced JSON editor. It should be selectable through the same
top-level gate UI the user uses for nationality and gender.

#### Preservation in moderation

This is the most urgent web fix for the Passport-score slice.

`moderation-helpers.ts` currently rehydrates only nationality and gender drafts. That behavior
silently destroys any active wallet-score gate on save. Fix this before or alongside the new UI.

Expected approach:

- parse supported editable rules into typed drafts
- collect all other active membership rules into `PassthroughMembershipGateRule[]`
- save `serializedEditableDrafts + passthroughRules`
- do not mutate or normalize passthrough rules beyond preserving their stored contract shape

#### Preview / join copy files

Update the explicit copy helpers, not just acceptance criteria:

1. `pirate-web/src/lib/identity-gates.ts`
   - `formatGateRequirement` must include threshold copy for wallet score
   - example: `Requires Human Passport score 20+`
   - `getVerificationPromptCopy` needs a non-interactive Passport branch
   - do not reuse the Self/Very `Verify with ID` copy for wallet-score remediation
   - `getGateFailureMessage` needs wallet-score-specific failure reasons such as `score_below_minimum`

2. `pirate-web/src/app/authenticated-routes/community-sidebar-helpers.ts`
   - `formatSidebarRequirement` must include the threshold instead of plain `Passport score`
   - example: `Passport score 20+`

3. `pirate-web/src/app/authenticated-routes/community-route.tsx`
   - when `missing_capabilities = ["wallet_score"]`, show a non-interactive remediation state
   - do not route into Self or Very verification session launch

#### Passport remediation branch

The current `VerificationProvider` flow is interactive and only models `self | very`.
Wallet score needs a third branch in product behavior, even if the implementation chooses a
different type name than `VerificationProvider`.

Expected UX:

- title: `Passport score required`
- description: `This community requires a Human Passport score of 20+`
- state: non-interactive
- CTA: optional external/manage-later affordance, but not a Self/Very verification launch

---

## Part 4: Web Community Preview and Join Flow

### 4A. Add API client methods

**File:** `pirate-web/src/lib/api/client.ts`

Add to `communities` object:

```ts
preview: (communityId: string): Promise<CommunityPreview> => {
  return this.request<CommunityPreview>(
    `/communities/${encodeURIComponent(communityId)}/preview`,
  )
},

joinEligibility: (communityId: string): Promise<JoinEligibility> => {
  return this.request<JoinEligibility>(
    `/communities/${encodeURIComponent(communityId)}/join-eligibility`,
  )
},
```

Import `CommunityPreview` and `JoinEligibility` from `@pirate/api-contracts` (available after Part 1G).

Also update the `join` method to return the full error response with details. Currently it only returns `{ community_id: string; status: string }` on success. On failure, the `ApiError` already carries `code`, `message`, and `status`. The `details` field from the new error shape will need to be surfaced.

**Update `ApiError` to carry details:**

**File:** `pirate-web/src/lib/api/client.ts`

```ts
export class ApiError extends Error {
  readonly code: string
  readonly status: number
  readonly retryable: boolean
  readonly details: Record<string, unknown> | null

  constructor(code: string, message: string, status: number, retryable = false, details: Record<string, unknown> | null = null) {
    super(message)
    this.name = "ApiError"
    this.code = code
    this.status = status
    this.retryable = retryable
    this.details = details
  }
}
```

Update the error parsing in `request` method (line 85-98) to extract `details`:

```ts
if (!res.ok) {
  let code = "internal_error"
  let message = `Request failed with status ${res.status}`
  let retryable = false
  let details: Record<string, unknown> | null = null

  try {
    const body: JsonErrorResponse & { details?: Record<string, unknown> } = await res.json()
    if (body.code) code = body.code
    if (body.message) message = body.message
    if (body.retryable) retryable = body.retryable
    if (body.details) details = body.details
  } catch {}

  throw new ApiError(code, message, res.status, retryable, details)
}
```

### 4B. Community preview page

**File:** `pirate-web/src/app/pages.tsx`

Update `CommunityPage` (line 203) to use the preview endpoint instead of the owner-only `get`:

```ts
function CommunityPage({ communityId }: { communityId: string }) {
  const api = useApi()
  const [preview, setPreview] = React.useState<CommunityPreview | null>(null)
  const [eligibility, setEligibility] = React.useState<JoinEligibility | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [loading, setLoading] = React.useState(true)

  React.useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const p = await api.communities.preview(communityId)
        if (cancelled) return
        setPreview(p)
        try {
          const e = await api.communities.joinEligibility(communityId)
          if (!cancelled) setEligibility(e)
        } catch {}
      } catch (e: unknown) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load community")
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [api, communityId])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Spinner className="size-6" />
      </div>
    )
  }

  if (error || !preview) {
    return <NotFoundPage path={`/c/${communityId}`} />
  }

  return (
    <StackPageShell title={preview.display_name} description={preview.description ?? undefined}>
      <CommunitySidebar
        createdAt={preview.created_at}
        description={preview.description ?? ""}
        displayName={preview.display_name}
        membershipMode={preview.membership_mode}
        memberCount={preview.member_count ?? 0}
        gateSummaries={preview.membership_gate_summaries}
        viewerMembershipStatus={preview.viewer_membership_status}
      />
      <CommunityJoinPanel
        eligibility={eligibility}
        onJoin={() => handleJoin(api, communityId)}
        onVerifyToJoin={() => handleVerifyToJoin(api, communityId, eligibility)}
      />
    </StackPageShell>
  )
}
```

### 4C. Update CommunitySidebar to show gate details

**File:** `pirate-web/src/components/compositions/community-sidebar/community-sidebar.tsx`

**File:** `pirate-web/src/components/compositions/community-sidebar/community-sidebar.types.ts`

Add props for `gateSummaries` and `viewerMembershipStatus`.

Update the access label section (lines 67-99) to:

```ts
const AccessIcon = membershipMode === "open" ? Globe : Lock

const accessLabel = membershipMode === "open" ? "Open" : "Gated"

const nationalitySummary = gateSummaries?.find((s) => s.gate_type === "nationality")
```

In the render, after the access label, show gate-specific copy when gated:

```tsx
{membershipMode === "gated" && nationalitySummary && (
  <div className="text-base text-muted-foreground">
    {nationalitySummary.required_value
      ? `Requires ${countryName(nationalitySummary.required_value)} nationality`
      : "Nationality verification required"}
  </div>
)}
```

Where `countryName` is a helper that looks up the ISO code in the country list from 3C.

### 4D. Community join panel

Create a new component that handles join CTA behavior.

**File:** Create `pirate-web/src/components/compositions/community-join-panel/community-join-panel.tsx`

Props:
```ts
interface CommunityJoinPanelProps {
  eligibility: JoinEligibility | null
  onJoin: () => Promise<void>
  onVerifyToJoin: () => Promise<void>
}
```

Button states:

| Eligibility status | Button label | Action | Disabled |
|---|---|---|---|
| `joinable` | Join | `onJoin` | No |
| `verification_required` | Verify to Join | `onVerifyToJoin` | No |
| `already_joined` | Joined | None | Yes |
| `gate_failed` (nationality_mismatch) | Join Unavailable | None | Yes |
| `banned` | Join Unavailable | None | Yes |
| `null` (loading) | Join | None | Yes |

For `gate_failed` with `failure_reason: "nationality_mismatch"`, show a concise blocking message like:

> Your verified nationality does not match this community requirement.

No self relaunch CTA. The user already has a verified nationality; it simply doesn't match.

### 4E. Self verification launch flow for community join

**File:** Create `pirate-web/src/lib/self-verification-flow.ts`

This is a reusable helper for starting a self verification session and managing its lifecycle:

```ts
import type { ApiClient } from "./api/client"

export async function startSelfNationalityVerification(
  api: ApiClient,
  verificationIntent: "community_join" = "community_join",
): Promise<{
  sessionId: string
  launch: SelfVerificationLaunch
}> {
  const session = await api.verification.startSession({
    provider: "self",
    requested_capabilities: ["nationality"],
    verification_intent: verificationIntent,
  })

  if (!session.launch?.self_app) {
    throw new Error("Self launch payload missing from verification session")
  }

  return {
    sessionId: session.verification_session_id,
    launch: session.launch.self_app,
  }
}

export async function completeSelfVerification(
  api: ApiClient,
  sessionId: string,
  proof?: string,
): Promise<void> {
  await api.verification.completeSession(sessionId, {
    proof: proof ?? undefined,
  })
}
```

Important: the client must call `completeSession` with proof material. This is not a passive poll or webhook-driven flow. The self integration layer in the browser obtains proof after the user completes the self app flow, then calls `completeSelfVerification(api, sessionId, proof)`.

### 4F. Self QR/deeplink rendering

The self launch payload contains `endpoint`, `session_id`, `user_id`, `disclosures`, etc. The web client needs to render this as a QR code or deeplink.

**File:** Create `pirate-web/src/components/compositions/self-qr-launch/self-qr-launch.tsx`

Props:
```ts
interface SelfQrLaunchProps {
  launch: SelfVerificationLaunch
  sessionId: string
  api: ApiClient
  onComplete: () => void
  onError: (error: string) => void
}
```

Implementation:
- Render the self launch payload as a QR code using a QR library already in the project, or a lightweight one
- Show the deeplink URL as a clickable fallback
- After the user scans and completes in the self app, the frontend must obtain proof material and call `api.verification.completeSession(sessionId, { proof })` explicitly. This is a client-driven completion flow, not a webhook or server-poll flow.
- On successful completion, call `onComplete()`
- On failure or error, call `onError(failureReason)`

**How self completion works in this codebase:** The client calls `api.verification.completeSession(sessionId, { proof })` with proof material obtained from the self integration layer. The backend's `completeVerificationSession` passes the proof into `getSelfProvider().getSessionOutcome()`, which returns pending if no proof was provided and returns verified claims (including nationality) if proof is valid. `getVerificationSession` is just a DB read; it does not poll upstream or advance state on its own. Do not describe this as webhook-based or passive-polling; those are not how this code works.

Check if the project already has a QR code dependency. If not, add `qrcode.react` or similar lightweight library. Check `pirate-web/package.json` first.

### 4G. Join + verify + retry orchestration

**File:** `pirate-web/src/app/pages.tsx`

Add these handlers in the `CommunityPage` component or at the page level:

```ts
const [joinLoading, setJoinLoading] = React.useState(false)
const [selfSessionId, setSelfSessionId] = React.useState<string | null>(null)
const [selfLaunch, setSelfLaunch] = React.useState<SelfVerificationLaunch | null>(null)

const handleJoin = React.useCallback(async () => {
  setJoinLoading(true)
  try {
    await api.communities.join(communityId)
    const e = await api.communities.joinEligibility(communityId)
    setEligibility(e)
  } catch (e: unknown) {
    const apiError = e as ApiError
    if (apiError.code === "gate_failed" && apiError.details?.failure_reason === "nationality_mismatch") {
      toast.error("Your verified nationality does not match this community requirement")
    } else {
      toast.error(apiError.message || "Failed to join community")
    }
  } finally {
    setJoinLoading(false)
  }
}, [api, communityId])

const handleVerifyToJoin = React.useCallback(async () => {
  try {
    const result = await startSelfNationalityVerification(api, "community_join")
    setSelfSessionId(result.sessionId)
    setSelfLaunch(result.launch)
  } catch (e: unknown) {
    toast.error(e instanceof Error ? e.message : "Could not start verification")
  }
}, [api])

const handleSelfComplete = React.useCallback(async () => {
  setSelfSessionId(null)
  setSelfLaunch(null)

  const e = await api.communities.joinEligibility(communityId)
  setEligibility(e)

  if (e.joinable_now) {
    await handleJoin()
  } else {
    toast.error("Verification completed but join eligibility has not changed")
  }
}, [api, communityId, handleJoin])

const handleSelfError = React.useCallback((error: string) => {
  setSelfSessionId(null)
  setSelfLaunch(null)
  toast.error(error || "Verification failed")
}, [])
```

When `selfLaunch` is non-null, render the `SelfQrLaunch` component as a modal or overlay.

---

## Part 5: Remove Top-Level `User.nationality`

### 5A. Spec (done in Part 1E)

`specs/api/src/components/schemas/users.yaml` — `nationality` field removed.

### 5B. Contracts (done in Part 1G)

After regenerating, `User` type no longer has `nationality`.

### 5C. Serializer (done in Part 2H)

`pirate-api/services/api/src/lib/auth/control-plane-auth-serializers.ts` — top-level nationality removed from `serializeUser`.

### 5D. Web usage

Search `pirate-web/` for any code reading `user.nationality` and replace with `user.verification_capabilities.nationality.value` if needed. The generated `User` type will no longer have `nationality` after contract regeneration, so TypeScript will flag any remaining references.

### 5E. Database column

The `users.nationality` database column was removed after the API stopped exposing top-level `User.nationality`. The canonical source is `verification_capabilities_json.nationality.value`.

---

## Part 6: File-Level Change List

### specs/ — source files (edit these)

| File | Change |
|---|---|
| `specs/api/src/components/schemas/verification.yaml:13` | Fix `ucommunity_join` → `community_join` |
| `specs/api/src/components/schemas/communities-core.yaml` | Update existing `MembershipGateSummary`, `JoinEligibility`, and `GateFailureDetails` schemas; add `minimum_score`, `wallet_score` missing-capability support, and `passport` provider support |
| `specs/api/src/components/schemas/users.yaml:48-51` | Remove `nationality` field |
| `specs/api/src/components/schemas/common.yaml` (or `Error` schema location) | Add `details` field to error response |
| `specs/api/src/paths/communities.yaml` | Add `GET /communities/{community_id}/preview` and `GET /communities/{community_id}/join-eligibility` operations with `x-implemented: true` |
| `specs/api/scripts/generate-api-contracts.ts` | Add new type exports and route exports |

### specs/ — generated outputs (review after running `rtk bun specs/api/scripts/verify-openapi.ts`)

Do not edit these files directly. Verify that regeneration produces the expected diffs.

| File | Expected change |
|---|---|
| `specs/api/openapi.yaml` | `ucommunity_join` → `community_join`; new preview/join-eligibility paths appear |
| `specs/api/openapi-implemented.yaml` | Same typo fix; new operations present (requires `x-implemented: true`) |
| `pirate-api/services/contracts/src/index.ts` | New exported types (`MembershipGateSummary`, `CommunityPreview`, `JoinEligibility`, `GateFailureDetails`); new route entries (`communityPreview`, `communityJoinEligibility`); `User` type no longer has `nationality`; `VerificationIntent` has `community_join` |

### pirate-api/

| File | Change |
|---|---|
| `pirate-api/services/api/src/lib/errors.ts` | Add `details` to `HttpError`, update `errorResponse`, add `gateFailedWithDetails` |
| `pirate-api/services/api/src/lib/communities/community-service.ts` | Add nationality validation in `assertCreateRequest`; add `getCommunityPreview`, `getJoinEligibility`; update `joinCommunity` with diagnostic errors; add `buildGateSummary` helper |
| `pirate-api/services/api/src/lib/communities/community-membership-store.ts` | Add `MembershipGateEvaluation` type, `evaluateMembershipGateRules` function |
| `pirate-api/services/api/src/routes/communities.ts` | Add preview and join-eligibility routes |
| `pirate-api/services/api/src/lib/auth/control-plane-auth-serializers.ts:62` | Remove top-level nationality from `serializeUser` |
| `pirate-api/services/contracts/src/index.ts` | Regenerated from specs (do not edit directly) |
| Tests (new or extended) | 12 tests described in Part 2I |

### pirate-web/

| File | Change |
|---|---|
| `pirate-web/src/components/compositions/create-community-composer/create-community-composer.types.ts` | Replace `Set<GateType>` with `GateDraft[]`; add `NationalityGateDraft`, `GenderGateDraft`, `WalletScoreGateDraft`, and passthrough rule support |
| `pirate-web/src/components/compositions/create-community-composer/create-community-composer.tsx` | Replace chip matrix with nationality picker; update state, validation, review step, `handleCreate` |
| `pirate-web/src/components/compositions/create-community-composer/nationality-picker.tsx` | New: searchable country picker component |
| `pirate-web/src/lib/countries.ts` | New: static ISO 3166-1 alpha-2 country list |
| `pirate-web/src/app/pages.tsx` | Update `CommunityPage` to use preview + eligibility; add join/verify handlers; update `handleCreate` to serialize `gate_rules` |
| `pirate-web/src/lib/api/client.ts` | Add `preview`, `joinEligibility` methods; add `details` to `ApiError`; update error parsing |
| `pirate-web/src/components/compositions/community-sidebar/community-sidebar.tsx` | Add gate summary display; add nationality-specific copy |
| `pirate-web/src/components/compositions/community-sidebar/community-sidebar.types.ts` | Add `gateSummaries`, `viewerMembershipStatus` props |
| `pirate-web/src/lib/self-verification-flow.ts` | New: self session start/complete helpers |
| `pirate-web/src/components/compositions/self-qr-launch/self-qr-launch.tsx` | New: QR code rendering + polling for self verification |
| `pirate-web/src/components/compositions/community-join-panel/community-join-panel.tsx` | New: join CTA with state management |
| `pirate-web/src/app/authenticated-routes/moderation-helpers.ts` | Rehydrate editable gates and preserve unsupported active membership gates as passthrough |
| `pirate-web/src/app/authenticated-routes/moderation-state.tsx` | Save editable gate drafts plus passthrough gate rules without destroying wallet-score gates |
| `pirate-web/src/lib/identity-gates.ts` | Add wallet-score threshold copy, non-interactive Passport remediation copy, and wallet-score failure messaging |
| `pirate-web/src/app/authenticated-routes/community-sidebar-helpers.ts` | Include wallet-score threshold in sidebar requirement copy |

---

## Part 7: Things Not To Do

- Do not keep `Set<GateType>` as the main source of truth for gate configuration
- Do not show a Nationality gate option without a selected country
- Do not keep join failures as generic opaque messages
- Do not implement residency semantics under the name nationality
- Do not read `user.nationality` as the canonical nationality source
- Do not silently loosen owner-only community reads without checking every caller of `getCommunity` and `requireOwnedCommunity`
- Do not wire Very into the join flow for nationality — self is the only accepted provider
- Do not add `excluded_values` to the v0 web UI — keep it backend-only for now
- Do not add a `users.nationality` dual-write path
- Do not start multiple heavy processes (dev server + build + browser automation) at once — follow the resource safety rules in AGENTS.md

---

## Part 8: Acceptance Criteria

The work is done when all of the following are true:

1. Creating a nationality-gated community from the web sends a real `gate_rules` payload with `proof_requirements` including `accepted_providers: ["self"]` and `config.required_value`
2. The backend stores and enforces the nationality rule with ISO code validation
3. A viewer can open a community preview page without being the owner (via `GET /communities/:id/preview`)
4. The preview page shows the required nationality and provider clearly (e.g., "Requires United States (US) nationality")
5. The join flow can determine whether the user is immediately joinable (via `GET /communities/:id/join-eligibility`)
6. A missing nationality proof launches self with `verification_intent: "community_join"` and `requested_capabilities: ["nationality"]`
7. A matching nationality proof allows join
8. A non-matching verified nationality blocks join with a clear message and `failure_reason: "nationality_mismatch"`
9. No product code depends on top-level `User.nationality`
10. The `ucommunity_join` typo is fixed everywhere in specs and generated output
11. Relevant spec, API, and web tests pass
12. `rtk bun run types` passes in `pirate-web`
13. `rtk bun specs/api/scripts/generate-api-contracts.ts` produces contracts without errors

### Passport Score Slice Acceptance Criteria

The Human Passport score gate slice is done when all of the following are true:

1. Creating a Passport-score-gated community from the web sends a real `gate_rules` payload with `accepted_providers: ["passport"]` and `config.minimum_score`
2. The score is configurable in the web UI and defaults to `20` for new wallet-score gates
3. `MembershipGateSummary` exposes `minimum_score` so preview and join surfaces can show the threshold
4. `JoinEligibility.missing_capabilities` can return `wallet_score`
5. `suggested_verification_provider` can return `passport`
6. `evaluateMembershipGateRules` returns a structured missing-capability result for absent wallet-score capability instead of an opaque `unsatisfied:wallet_score` mismatch
7. A user whose `wallet_score.score` is at or above the configured `minimum_score` and whose `passing_score = true` can join a wallet-score-gated community
8. A user whose wallet score is below the configured threshold is rejected with clear wallet-score-specific copy
9. A user missing wallet-score capability sees non-interactive remediation copy and is not routed into Self or Very session launch
10. Community settings preserve existing unrecognized membership gates instead of dropping them on save
11. Editing a community with an existing wallet-score gate does not destroy or rewrite that gate incorrectly
12. Relevant spec, API, and web tests pass for the wallet-score path

### Deferred Follow-On

The following work is explicitly deferred and should not block the wallet-score gate slice above:

- live Human Passport score read endpoint
- live Human Passport score refresh endpoint
- production Passport provider integration beyond test or seeded development capability data
