import { describe, expect, test } from "bun:test";
import { DEFAULT_DELEGATION_THRESHOLDS } from "./delegation-state";
import {
  evaluateJoinedRoot,
  projectDelegationResponse,
  ROOT_DELEGATION_READ_SQL,
  type RootDelegationJoinRow,
} from "./delegation-read-model";

const NOW = 1_800_000_000_000;
const { maxObservationAgeMs, expiryProximityThresholdMs } = DEFAULT_DELEGATION_THRESHOLDS;

function joined(overrides: Partial<RootDelegationJoinRow> = {}): RootDelegationJoinRow {
  return {
    normalized_root_label: "dankmeme",
    rollover_state: "none",
    pending_evidence_kind: null,
    last_parent_observation_id: "obs_1",
    parent_observation_id: "obs_1",
    observed_delegation_security: "secure",
    parent_ds_matches_live_dnskey: 1,
    authoritative_dnssec_valid: 1,
    observed_at: new Date(NOW).toISOString(),
    earliest_rrsig_expires_at: new Date(NOW + expiryProximityThresholdMs * 4).toISOString(),
    ...overrides,
  };
}

describe("the canonical join", () => {
  test("is a LEFT JOIN so never-observed roots still return", () => {
    expect(ROOT_DELEGATION_READ_SQL).toContain("LEFT JOIN");
    expect(ROOT_DELEGATION_READ_SQL).not.toContain("INNER JOIN");
  });

  test("pairs on root label as well as observation id", () => {
    expect(ROOT_DELEGATION_READ_SQL).toContain(
      "observation.normalized_root_label = state.normalized_root_label",
    );
  });

  test("selects no findings from the state table", () => {
    // Regression guard: the state table holds no security findings, and a
    // future edit that reintroduces one should fail here first.
    for (const forbidden of [
      "state.delegation_security",
      "state.parent_ds_matches_live_dnskey",
      "state.authoritative_dnssec_valid",
      "state.last_parent_observation_at",
      "state.earliest_rrsig_expires_at",
    ]) {
      expect(ROOT_DELEGATION_READ_SQL).not.toContain(forbidden);
    }
  });
});

describe("evaluateJoinedRoot", () => {
  test("a secure, fresh root routes", () => {
    const result = evaluateJoinedRoot(joined(), NOW);
    expect(result.authenticatedRoutingAllowed).toBe(true);
    expect(result.delegationSecurity).toBe("secure");
  });

  test("no row at all fails closed", () => {
    const result = evaluateJoinedRoot(null, NOW);
    expect(result.authenticatedRoutingAllowed).toBe(false);
    expect(result.routingWithheldReason).toBe("no_root_state");
  });

  test("a row with no observation is never-observed, not missing", () => {
    const result = evaluateJoinedRoot(
      joined({ last_parent_observation_id: null, parent_observation_id: null }),
      NOW,
    );
    expect(result.routingWithheldReason).toBe("not_secure");
    expect(result.delegationSecurity).toBe("unknown");
    // The rollover state survives, which an INNER JOIN would have discarded.
    expect(result.rolloverState).toBe("none");
  });

  test("a stale observation withholds routing", () => {
    const result = evaluateJoinedRoot(
      joined({ observed_at: new Date(NOW - maxObservationAgeMs - 1).toISOString() }),
      NOW,
    );
    expect(result.routingWithheldReason).toBe("observation_stale");
  });

  test("accepts Date and integer-boolean column shapes", () => {
    const result = evaluateJoinedRoot(
      joined({
        observed_at: new Date(NOW),
        earliest_rrsig_expires_at: new Date(NOW + expiryProximityThresholdMs * 4),
        parent_ds_matches_live_dnskey: true,
        authoritative_dnssec_valid: true,
      }),
      NOW,
    );
    expect(result.authenticatedRoutingAllowed).toBe(true);
  });

  test("an orphaned observation pointer throws rather than degrading", () => {
    expect(() =>
      evaluateJoinedRoot(joined({ parent_observation_id: null }), NOW),
    ).toThrow(/FK guarantees one exists/u);
  });

  test("an unparseable timestamp throws", () => {
    expect(() => evaluateJoinedRoot(joined({ observed_at: "not-a-date" }), NOW)).toThrow(
      TypeError,
    );
  });

  test("a successful observation missing a finding throws", () => {
    expect(() =>
      evaluateJoinedRoot(joined({ parent_ds_matches_live_dnskey: null }), NOW),
    ).toThrow(/missing a component finding/u);
  });
});

describe("projectDelegationResponse", () => {
  test("both allow-flags are the same predicate", () => {
    for (const row of [joined(), joined({ observed_delegation_security: "bogus" })]) {
      const projected = projectDelegationResponse(evaluateJoinedRoot(row, NOW));
      expect(projected.pirate_web_routing_allowed).toBe(
        projected.pirate_subdomain_issuance_allowed,
      );
    }
  });

  test("carries the reason, not only a bare false", () => {
    const projected = projectDelegationResponse(
      evaluateJoinedRoot(
        joined({ observed_at: new Date(NOW - maxObservationAgeMs - 1).toISOString() }),
        NOW,
      ),
    );
    expect(projected.pirate_web_routing_allowed).toBe(false);
    // "not verified" and "not observed lately" are different claims.
    expect(projected.routing_withheld_reason).toBe("observation_stale");
    expect(projected.delegation_security).toBe("secure");
  });

  test("does not project attachment", () => {
    const projected = projectDelegationResponse(evaluateJoinedRoot(joined(), NOW));
    expect(Object.hasOwn(projected, "club_attach_allowed")).toBe(false);
  });

  test("reports observation age in whole seconds", () => {
    const projected = projectDelegationResponse(
      evaluateJoinedRoot(joined({ observed_at: new Date(NOW - 61_500).toISOString() }), NOW),
    );
    expect(projected.observation_age_seconds).toBe(61);
  });
});
