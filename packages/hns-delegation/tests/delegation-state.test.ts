import { describe, expect, test } from "bun:test";
import {
  applyFailedObservation,
  applySuccessfulObservation,
  DEFAULT_DELEGATION_THRESHOLDS,
  evaluateDelegation,
  isOrphanedDsInvariantViolation,
  resolveRootRoutingMode,
  resolveRootDelegationState,
  type ParentObservationRow,
  type RootDelegationRow,
  type DelegationSecurity,
  type RolloverState,
  type RootDelegationState,
} from "../src/delegation-state";

const NOW = 1_800_000_000_000;
const { maxObservationAgeMs, expiryProximityThresholdMs } = DEFAULT_DELEGATION_THRESHOLDS;

function state(overrides: Partial<RootDelegationState> = {}): RootDelegationState {
  return {
    delegationSecurity: "secure",
    rolloverState: "none",
    parentDsMatchesLiveDnskey: true,
    authoritativeDnssecValid: true,
    lastParentObservationAt: NOW,
    earliestRrsigExpiresAt: NOW + expiryProximityThresholdMs * 4,
    authorityRedundancyOk: true,
    authorityRedundancyEvidenceClass: "external_multi_vantage",
    lastRedundancyObservationAt: NOW,
    canonicalRoutingEligible: false,
    routingHardDenied: false,
    ...overrides,
  };
}

describe("evaluateDelegation freshness boundary", () => {
  test("an observation exactly at max_observation_age is still fresh", () => {
    const result = evaluateDelegation(
      state({ lastParentObservationAt: NOW - maxObservationAgeMs }),
      NOW,
    );
    expect(result.observationFresh).toBe(true);
    expect(result.authenticatedRoutingAllowed).toBe(true);
    expect(result.routingWithheldReason).toBeNull();
  });

  test("one millisecond under the threshold is fresh", () => {
    const result = evaluateDelegation(
      state({ lastParentObservationAt: NOW - (maxObservationAgeMs - 1) }),
      NOW,
    );
    expect(result.observationFresh).toBe(true);
    expect(result.authenticatedRoutingAllowed).toBe(true);
  });

  test("one millisecond over the threshold withholds routing", () => {
    const result = evaluateDelegation(
      state({ lastParentObservationAt: NOW - (maxObservationAgeMs + 1) }),
      NOW,
    );
    expect(result.observationFresh).toBe(false);
    expect(result.authenticatedRoutingAllowed).toBe(false);
    expect(result.routingWithheldReason).toBe("observation_stale");
  });

  test("a stale secure is not downgraded -- the finding stands, it is just not advertised", () => {
    const result = evaluateDelegation(
      state({ lastParentObservationAt: NOW - maxObservationAgeMs * 10 }),
      NOW,
    );
    expect(result.delegationSecurity).toBe("secure");
    expect(result.authenticatedRoutingAllowed).toBe(false);
  });
});

describe("evaluateDelegation expiry-proximity boundary", () => {
  test("expiry exactly at the threshold does not withhold routing", () => {
    const result = evaluateDelegation(
      state({ earliestRrsigExpiresAt: NOW + expiryProximityThresholdMs }),
      NOW,
    );
    expect(result.authenticatedRoutingAllowed).toBe(true);
  });

  test("one millisecond inside the window withholds routing", () => {
    const result = evaluateDelegation(
      state({ earliestRrsigExpiresAt: NOW + (expiryProximityThresholdMs - 1) }),
      NOW,
    );
    expect(result.authenticatedRoutingAllowed).toBe(false);
    expect(result.routingWithheldReason).toBe("signature_expiry_imminent");
  });

  test("already-expired signatures withhold routing", () => {
    const result = evaluateDelegation(state({ earliestRrsigExpiresAt: NOW - 1 }), NOW);
    expect(result.routingWithheldReason).toBe("signature_expiry_imminent");
  });

  test("approaching expiry warns before it withholds", () => {
    const result = evaluateDelegation(
      state({ earliestRrsigExpiresAt: NOW + expiryProximityThresholdMs + 1 }),
      NOW,
    );
    expect(result.signatureExpiryWarning).toBe(true);
    expect(result.authenticatedRoutingAllowed).toBe(true);
  });
});

describe("evaluateDelegation fails closed", () => {
  test("missing root state is unknown with routing withheld", () => {
    const result = evaluateDelegation(null, NOW);
    expect(result.delegationSecurity).toBe("unknown");
    expect(result.authenticatedRoutingAllowed).toBe(false);
    expect(result.routingWithheldReason).toBe("no_root_state");
  });

  test.each<DelegationSecurity>(["unknown", "unsecured", "pending", "bogus", "drifted"])(
    "%s never permits authenticated routing",
    (delegationSecurity) => {
      const result = evaluateDelegation(state({ delegationSecurity }), NOW);
      expect(result.authenticatedRoutingAllowed).toBe(false);
      expect(result.routingWithheldReason).toBe("not_secure");
    },
  );

  test("drift is withheld on the same terms as never-published", () => {
    const drifted = evaluateDelegation(state({ delegationSecurity: "drifted" }), NOW);
    const unsecured = evaluateDelegation(state({ delegationSecurity: "unsecured" }), NOW);
    expect(drifted.authenticatedRoutingAllowed).toBe(unsecured.authenticatedRoutingAllowed);
  });

  test("secure with no successful observation is treated as never observed", () => {
    const result = evaluateDelegation(state({ lastParentObservationAt: null }), NOW);
    expect(result.authenticatedRoutingAllowed).toBe(false);
    expect(result.routingWithheldReason).toBe("never_observed");
    expect(result.observationAgeMs).toBeNull();
  });
});

describe("incoherent rows fail closed", () => {
  test("secure contradicted by parent_ds_matches_live_dnskey does not route", () => {
    const result = evaluateDelegation(state({ parentDsMatchesLiveDnskey: false }), NOW);
    expect(result.authenticatedRoutingAllowed).toBe(false);
    expect(result.routingWithheldReason).toBe("incoherent_state");
  });

  test("secure contradicted by authoritative_dnssec_valid does not route", () => {
    const result = evaluateDelegation(state({ authoritativeDnssecValid: false }), NOW);
    expect(result.authenticatedRoutingAllowed).toBe(false);
    expect(result.routingWithheldReason).toBe("incoherent_state");
  });

  test("an unestablished component is not treated as true", () => {
    for (const override of [
      { parentDsMatchesLiveDnskey: null },
      { authoritativeDnssecValid: null },
    ] as Array<Partial<RootDelegationState>>) {
      const result = evaluateDelegation(state(override), NOW);
      expect(result.authenticatedRoutingAllowed).toBe(false);
      expect(result.routingWithheldReason).toBe("incoherent_state");
    }
  });
});

describe("temporal validity is mandatory", () => {
  test("absent expiry evidence withholds routing", () => {
    const result = evaluateDelegation(state({ earliestRrsigExpiresAt: null }), NOW);
    expect(result.authenticatedRoutingAllowed).toBe(false);
    expect(result.routingWithheldReason).toBe("signature_expiry_unknown");
  });
});

describe("clock skew fails closed", () => {
  test("an observation from the future is not fresh", () => {
    const result = evaluateDelegation(state({ lastParentObservationAt: NOW + 1 }), NOW);
    expect(result.observationFresh).toBe(false);
    expect(result.authenticatedRoutingAllowed).toBe(false);
    expect(result.routingWithheldReason).toBe("observation_in_future");
  });

  test("an explicitly configured tolerance admits small skew", () => {
    const thresholds = { ...DEFAULT_DELEGATION_THRESHOLDS, clockSkewToleranceMs: 5_000 };
    expect(
      evaluateDelegation(state({ lastParentObservationAt: NOW + 5_000 }), NOW, thresholds)
        .authenticatedRoutingAllowed,
    ).toBe(true);
    expect(
      evaluateDelegation(state({ lastParentObservationAt: NOW + 5_001 }), NOW, thresholds)
        .routingWithheldReason,
    ).toBe("observation_in_future");
  });
});

describe("threshold configuration is validated", () => {
  test.each([
    { maxObservationAgeMs: Number.NaN, expiryProximityThresholdMs: 1 },
    { maxObservationAgeMs: -1, expiryProximityThresholdMs: 1 },
    { maxObservationAgeMs: 1, expiryProximityThresholdMs: Number.POSITIVE_INFINITY },
    { maxObservationAgeMs: 1, expiryProximityThresholdMs: 1, clockSkewToleranceMs: -1 },
  ])("rejects %o", (thresholds) => {
    expect(() => evaluateDelegation(state(), NOW, thresholds)).toThrow(TypeError);
  });
});

describe("redundancy policy does not rewrite security", () => {
  const cases: Array<Partial<RootDelegationState> | null> = [
    null,
    {},
    { delegationSecurity: "bogus" },
    { delegationSecurity: "drifted" },
    { lastParentObservationAt: NOW - maxObservationAgeMs - 1 },
    { lastParentObservationAt: null },
    { earliestRrsigExpiresAt: NOW + 1 },
    { earliestRrsigExpiresAt: null },
    { parentDsMatchesLiveDnskey: false },
    { authoritativeDnssecValid: null },
    { lastParentObservationAt: NOW + 60_000 },
  ];

  test("report-only preserves routing while reporting unhealthy", () => {
    const result = evaluateDelegation(
      state({ authorityRedundancyOk: false }),
      NOW,
    );
    expect(result.authorityRedundancyHealthy).toBe(false);
    expect(result.secureDelegationVerified).toBe(true);
    expect(result.authenticatedRoutingAllowed).toBe(true);
  });

  test("enforcing withdraws routing without changing delegation security", () => {
    const result = evaluateDelegation(
      state({ authorityRedundancyOk: false }),
      NOW,
      DEFAULT_DELEGATION_THRESHOLDS,
      { redundancyMode: "enforcing", requiredRedundancyEvidenceClass: "external_multi_vantage" },
    );
    expect(result.delegationSecurity).toBe("secure");
    expect(result.secureDelegationVerified).toBe(true);
    expect(result.authenticatedRoutingAllowed).toBe(false);
    expect(result.routingWithheldReason).toBe("authority_redundancy_unhealthy");
  });

  test("enforcing rejects healthy evidence from only the verifier host", () => {
    const result = evaluateDelegation(
      state({
        authorityRedundancyOk: true,
        authorityRedundancyEvidenceClass: "local_single_vantage",
      }),
      NOW,
      DEFAULT_DELEGATION_THRESHOLDS,
      { redundancyMode: "enforcing" },
    );
    expect(result.authorityRedundancyHealthy).toBe(true);
    expect(result.redundancyEvidenceSufficient).toBe(false);
    expect(result.secureDelegationVerified).toBe(true);
    expect(result.authenticatedRoutingAllowed).toBe(false);
    expect(result.routingWithheldReason).toBe(
      "authority_redundancy_evidence_insufficient",
    );
  });

  test("report-only exposes provenance without withdrawing routing", () => {
    const result = evaluateDelegation(
      state({
        authorityRedundancyOk: true,
        authorityRedundancyEvidenceClass: "local_single_vantage",
      }),
      NOW,
    );
    expect(result.redundancyEvidenceClass).toBe("local_single_vantage");
    expect(result.redundancyEvidenceSufficient).toBe(false);
    expect(result.authenticatedRoutingAllowed).toBe(true);
  });

  test("null is never-observed and distinct from observed-unhealthy", () => {
    const never = evaluateDelegation(state({
      authorityRedundancyOk: null,
      lastRedundancyObservationAt: null,
    }), NOW);
    const unhealthy = evaluateDelegation(state({ authorityRedundancyOk: false }), NOW);
    expect(never.authorityRedundancyHealthy).toBe(false);
    expect(never.redundancyObservationFresh).toBe(false);
    expect(unhealthy.authorityRedundancyHealthy).toBe(false);
    expect(unhealthy.redundancyObservationFresh).toBe(true);
  });

  test("future-dated redundancy evidence is rejected", () => {
    const result = evaluateDelegation(
      state({ lastRedundancyObservationAt: NOW + 1 }),
      NOW,
      DEFAULT_DELEGATION_THRESHOLDS,
      { redundancyMode: "enforcing" },
    );
    expect(result.redundancyObservationFresh).toBe(false);
    expect(result.authenticatedRoutingAllowed).toBe(false);
  });
});

describe("per-root rollout precedence", () => {
  test("deny wins over global flag and eligibility", () => {
    expect(resolveRootRoutingMode({
      globalCanonicalRoutingEnabled: true,
      canonicalRoutingEligible: true,
      routingHardDenied: true,
    })).toBe("denied");
  });

  test("canonical requires global flag and root eligibility", () => {
    expect(resolveRootRoutingMode({
      globalCanonicalRoutingEnabled: true,
      canonicalRoutingEligible: true,
      routingHardDenied: false,
    })).toBe("canonical");
    expect(resolveRootRoutingMode({
      globalCanonicalRoutingEnabled: false,
      canonicalRoutingEligible: true,
      routingHardDenied: false,
    })).toBe("legacy");
    expect(resolveRootRoutingMode({
      globalCanonicalRoutingEnabled: true,
      canonicalRoutingEligible: false,
      routingHardDenied: false,
    })).toBe("legacy");
  });
});

describe("rollover_state is not an input to routing", () => {
  const rolloverStates: RolloverState[] = [
    "none",
    "required",
    "new_key_prepublished",
    "new_ds_pending",
    "overlap",
    "old_ds_removal_pending",
  ];

  test("a rollover in flight neither grants nor withdraws routing", () => {
    for (const rolloverState of rolloverStates) {
      expect(evaluateDelegation(state({ rolloverState }), NOW).authenticatedRoutingAllowed).toBe(
        true,
      );
      expect(
        evaluateDelegation(state({ rolloverState, delegationSecurity: "bogus" }), NOW)
          .authenticatedRoutingAllowed,
      ).toBe(false);
    }
  });
});

describe("observation outcome semantics", () => {
  test("a failed observation retains the last finding", () => {
    expect(applyFailedObservation("secure")).toBe("secure");
    expect(applyFailedObservation("unknown")).toBe("unknown");
  });

  test("a successful observation replaces the security value", () => {
    expect(applySuccessfulObservation("bogus", { everSecure: true })).toBe("bogus");
    expect(applySuccessfulObservation("secure", { everSecure: false })).toBe("secure");
  });

  test("drifted is decided against whether the root was EVER secure", () => {
    expect(applySuccessfulObservation("drifted", { everSecure: true })).toBe("drifted");
    expect(applySuccessfulObservation("drifted", { everSecure: false })).toBe("unsecured");
  });

  test("secure -> bogus -> mismatch is still drift, not unsecured", () => {
    // The immediately previous value is `bogus`, but the root held a secure
    // finding earlier. Reading only the previous enum would lose that.
    expect(applySuccessfulObservation("drifted", { everSecure: true })).toBe("drifted");
  });
});

describe("orphaned DS during overlap is an invariant violation", () => {
  test("both-keys-live stages alarm rather than tolerate", () => {
    expect(isOrphanedDsInvariantViolation("overlap")).toBe(true);
    expect(isOrphanedDsInvariantViolation("old_ds_removal_pending")).toBe(true);
  });

  test("other stages do not", () => {
    for (const rolloverState of [
      "none",
      "required",
      "new_key_prepublished",
      "new_ds_pending",
    ] as RolloverState[]) {
      expect(isOrphanedDsInvariantViolation(rolloverState)).toBe(false);
    }
  });
});

describe("null root state satisfies the full evaluation contract", () => {
  test("componentsSecure is present and false", () => {
    const result = evaluateDelegation(null, NOW);
    expect(result.componentsSecure).toBe(false);
    // Every declared field must be present; a missing one would only surface
    // under typecheck, and bun test transpiles past types.
    for (const key of [
      "delegationSecurity",
      "rolloverState",
      "observationFresh",
      "observationAgeMs",
      "secureDelegationVerified",
      "authenticatedRoutingAllowed",
      "routingWithheldReason",
      "signatureExpiryWarning",
      "componentsSecure",
      "authorityRedundancyHealthy",
      "redundancyObservationFresh",
      "canonicalRoutingEligible",
      "routingHardDenied",
    ]) {
      expect(Object.hasOwn(result, key)).toBe(true);
    }
  });
});

describe("resolveRootDelegationState is the only way to build evaluator input", () => {
  const row: RootDelegationRow = {
    rolloverState: "none",
    lastParentObservationId: "obs_1",
    pendingEvidenceKind: null,
    authorityRedundancyOk: null,
    authorityRedundancyEvidenceClass: null,
    lastRedundancyObservationAtMs: null,
    canonicalRoutingEligible: false,
    routingHardDenied: false,
  };
  const observation: ParentObservationRow = {
    parentObservationId: "obs_1",
    observedDelegationSecurity: "secure",
    parentDsMatchesLiveDnskey: true,
    authoritativeDnssecValid: true,
    observedAtMs: NOW,
    earliestRrsigExpiresAtMs: NOW + expiryProximityThresholdMs * 4,
  };

  test("findings and timestamps come from the observation", () => {
    const resolved = resolveRootDelegationState(row, observation);
    expect(resolved?.lastParentObservationAt).toBe(NOW);
    expect(resolved?.delegationSecurity).toBe("secure");
    expect(evaluateDelegation(resolved, NOW).authenticatedRoutingAllowed).toBe(true);
  });

  test("a stale observation cannot be paired with a fresh-looking row", () => {
    const stale = { ...observation, observedAtMs: NOW - maxObservationAgeMs - 1 };
    const resolved = resolveRootDelegationState(row, stale);
    expect(evaluateDelegation(resolved, NOW).routingWithheldReason).toBe("observation_stale");
  });

  test("an unsecured observation cannot be paired with secure components", () => {
    const unsecured: ParentObservationRow = {
      ...observation,
      observedDelegationSecurity: "unsecured",
      parentDsMatchesLiveDnskey: false,
    };
    const resolved = resolveRootDelegationState(row, unsecured);
    expect(resolved?.delegationSecurity).toBe("unsecured");
    expect(resolved?.parentDsMatchesLiveDnskey).toBe(false);
  });

  test("a mismatched observation is refused rather than silently used", () => {
    expect(() =>
      resolveRootDelegationState(row, { ...observation, parentObservationId: "obs_other" }),
    ).toThrow();
  });

  test("the only never-observed shape is a real row with neither pointer nor observation", () => {
    const resolved = resolveRootDelegationState(
      { ...row, lastParentObservationId: null },
      null,
    );
    expect(resolved?.delegationSecurity).toBe("unknown");
    expect(evaluateDelegation(resolved, NOW).routingWithheldReason).toBe("not_secure");
  });

  test("a missing row with no observation is null", () => {
    expect(resolveRootDelegationState(null, null)).toBeNull();
  });
});

describe("impossible pairings throw rather than degrade", () => {
  const row: RootDelegationRow = {
    rolloverState: "none",
    lastParentObservationId: "obs_1",
    pendingEvidenceKind: null,
    authorityRedundancyOk: null,
    authorityRedundancyEvidenceClass: null,
    lastRedundancyObservationAtMs: null,
    canonicalRoutingEligible: false,
    routingHardDenied: false,
  };
  const observation: ParentObservationRow = {
    parentObservationId: "obs_1",
    observedDelegationSecurity: "secure",
    parentDsMatchesLiveDnskey: true,
    authoritativeDnssecValid: true,
    observedAtMs: NOW,
    earliestRrsigExpiresAtMs: NOW + expiryProximityThresholdMs * 4,
  };

  test("pointer without observation throws instead of reporting never-observed", () => {
    expect(() => resolveRootDelegationState(row, null)).toThrow(/FK guarantees one exists/u);
  });

  test("observation without pointer throws instead of being ignored", () => {
    expect(() =>
      resolveRootDelegationState({ ...row, lastParentObservationId: null }, observation),
    ).toThrow(/no observation pointer/u);
  });

  test("observation without a row throws instead of returning null", () => {
    expect(() => resolveRootDelegationState(null, observation)).toThrow(/no root row/u);
  });

  test("mismatched ids throw", () => {
    expect(() =>
      resolveRootDelegationState(row, { ...observation, parentObservationId: "obs_other" }),
    ).toThrow(/is not the row's referenced observation/u);
  });
});

describe("pending evidence overlays unsecured only", () => {
  const pendingRow: RootDelegationRow = {
    rolloverState: "none",
    lastParentObservationId: "obs_1",
    pendingEvidenceKind: "wallet_transaction_id",
    authorityRedundancyOk: null,
    authorityRedundancyEvidenceClass: null,
    lastRedundancyObservationAtMs: null,
    canonicalRoutingEligible: false,
    routingHardDenied: false,
  };
  const base: ParentObservationRow = {
    parentObservationId: "obs_1",
    observedDelegationSecurity: "unsecured",
    parentDsMatchesLiveDnskey: false,
    authoritativeDnssecValid: true,
    observedAtMs: NOW,
    earliestRrsigExpiresAtMs: NOW + expiryProximityThresholdMs * 4,
  };

  test("unsecured is overlaid as pending while publication is in flight", () => {
    const resolved = resolveRootDelegationState(pendingRow, base);
    expect(resolved?.delegationSecurity).toBe("pending");
    // The overlay changes what we ask the owner to do, never what we claim.
    expect(evaluateDelegation(resolved, NOW).authenticatedRoutingAllowed).toBe(false);
  });

  test.each(["secure", "bogus", "drifted", "unknown"] as const)(
    "%s is never overlaid",
    (observedDelegationSecurity) => {
      const observation: ParentObservationRow = {
        ...base,
        observedDelegationSecurity,
        parentDsMatchesLiveDnskey: observedDelegationSecurity === "secure",
        authoritativeDnssecValid: observedDelegationSecurity === "secure",
      };
      const resolved = resolveRootDelegationState(pendingRow, observation);
      expect(resolved?.delegationSecurity).toBe(observedDelegationSecurity);
    },
  );

  test("pending without any observation is assertable", () => {
    const resolved = resolveRootDelegationState(
      { ...pendingRow, lastParentObservationId: null },
      null,
    );
    expect(resolved?.delegationSecurity).toBe("pending");
  });
});
