import { describe, expect, test } from "bun:test";
import { DEFAULT_DELEGATION_THRESHOLDS } from "../src/delegation-state";
import {
  evaluateJoinedRoot,
  projectDelegationResponse,
  ROOT_DELEGATION_JOIN_SQL,
  ROOT_DELEGATION_READ_SQL,
  ROOT_DELEGATION_SELECT_SQL,
  type RootDelegationJoinRow,
} from "../src/delegation-read-model";

const NOW = 1_800_000_000_000;
const { maxObservationAgeMs, expiryProximityThresholdMs } = DEFAULT_DELEGATION_THRESHOLDS;

function joined(overrides: Partial<RootDelegationJoinRow> = {}): RootDelegationJoinRow {
  return {
    delegation_root_label: "dankmeme",
    delegation_rollover_state: "none",
    delegation_pending_evidence_kind: null,
    delegation_authority_redundancy_ok: 1,
    delegation_redundancy_observed_at: new Date(NOW).toISOString(),
    delegation_canonical_routing_eligible: 0,
    delegation_routing_hard_denied: 0,
    delegation_last_parent_observation_id: "obs_1",
    delegation_parent_observation_id: "obs_1",
    delegation_security: "secure",
    delegation_parent_ds_matches_live_dnskey: 1,
    delegation_authoritative_dnssec_valid: 1,
    delegation_observed_at: new Date(NOW).toISOString(),
    delegation_earliest_rrsig_expires_at: new Date(NOW + expiryProximityThresholdMs * 4).toISOString(),
    ...overrides,
  };
}

describe("the canonical join", () => {
  test("exports composable fragments for batch readers", () => {
    expect(ROOT_DELEGATION_SELECT_SQL).toContain("state.normalized_root_label");
    expect(ROOT_DELEGATION_JOIN_SQL).toContain(
      "state.normalized_root_label = nv.normalized_root_label",
    );
    expect(ROOT_DELEGATION_JOIN_SQL).toContain(
      "observation.normalized_root_label = state.normalized_root_label",
    );
  });

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
      joined({
        delegation_last_parent_observation_id: null,
        delegation_parent_observation_id: null,
      }),
      NOW,
    );
    expect(result.routingWithheldReason).toBe("not_secure");
    expect(result.delegationSecurity).toBe("unknown");
    // The rollover state survives, which an INNER JOIN would have discarded.
    expect(result.rolloverState).toBe("none");
  });

  test("a stale observation withholds routing", () => {
    const result = evaluateJoinedRoot(
      joined({ delegation_observed_at: new Date(NOW - maxObservationAgeMs - 1).toISOString() }),
      NOW,
    );
    expect(result.routingWithheldReason).toBe("observation_stale");
  });

  test("accepts Date and integer-boolean column shapes", () => {
    const result = evaluateJoinedRoot(
      joined({
        delegation_observed_at: new Date(NOW),
        delegation_earliest_rrsig_expires_at: new Date(NOW + expiryProximityThresholdMs * 4),
        delegation_parent_ds_matches_live_dnskey: true,
        delegation_authoritative_dnssec_valid: true,
      }),
      NOW,
    );
    expect(result.authenticatedRoutingAllowed).toBe(true);
  });

  test("an orphaned observation pointer throws rather than degrading", () => {
    expect(() =>
      evaluateJoinedRoot(joined({ delegation_parent_observation_id: null }), NOW),
    ).toThrow(/FK guarantees one exists/u);
  });

  test("an unparseable timestamp throws", () => {
    expect(() => evaluateJoinedRoot(joined({ delegation_observed_at: "not-a-date" }), NOW)).toThrow(
      TypeError,
    );
  });

  test("a successful observation missing a finding throws", () => {
    expect(() =>
      evaluateJoinedRoot(joined({ delegation_parent_ds_matches_live_dnskey: null }), NOW),
    ).toThrow(/missing a component finding/u);
  });
});

describe("projectDelegationResponse", () => {
  test("both allow-flags are the same predicate", () => {
    for (const row of [joined(), joined({ delegation_security: "bogus" })]) {
      const projected = projectDelegationResponse(evaluateJoinedRoot(row, NOW));
      expect(projected.pirate_web_routing_allowed).toBe(
        projected.pirate_subdomain_issuance_allowed,
      );
    }
  });

  test("carries the reason, not only a bare false", () => {
    const projected = projectDelegationResponse(
      evaluateJoinedRoot(
        joined({ delegation_observed_at: new Date(NOW - maxObservationAgeMs - 1).toISOString() }),
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
      evaluateJoinedRoot(joined({ delegation_observed_at: new Date(NOW - 61_500).toISOString() }), NOW),
    );
    expect(projected.observation_age_seconds).toBe(61);
  });
});
