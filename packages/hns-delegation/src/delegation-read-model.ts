/**
 * Read-time adapter over the state-to-observation join.
 *
 * Slice 1 step 3. This module owns the *only* supported way to read root
 * delegation state: one query joining `hns_root_delegation_state` to its
 * referenced `hns_root_parent_observations` row, fed through
 * `resolveRootDelegationState` and then `evaluateDelegation`.
 *
 * It lives in core rather than in a consumer because the readers span repos.
 * Two independent implementations of this join would be two places for the
 * freshness rule to drift, which is the failure mode the whole slice exists to
 * prevent.
 *
 * The adapter is read-only by construction: it exposes no writer, and it never
 * projects into `namespace_verification_assertions`. DNSSEC delegation state
 * has exactly one authority, and it is these tables.
 */

import {
  DEFAULT_DELEGATION_THRESHOLDS,
  DEFAULT_DELEGATION_POLICY,
  evaluateDelegation,
  resolveRootDelegationState,
  type DelegationEvaluation,
  type DelegationPolicy,
  type DelegationThresholdsInput,
  type ParentObservationRow,
  type RootDelegationRow,
} from "./delegation-state";

/**
 * The canonical join. LEFT JOIN, not INNER: a root with no successful
 * observation yet must still return its row, so the reader can distinguish
 * "never observed" from "no such root". An INNER JOIN would silently turn the
 * former into the latter and lose the rollover and pending state with it.
 *
 * The join predicate carries `normalized_root_label` as well as the id so a
 * malformed query cannot pair a row with another root's observation -- the same
 * pairing the composite FK forbids at write time.
 */
export const ROOT_DELEGATION_SELECT_SQL = `
    state.normalized_root_label AS delegation_root_label,
    state.rollover_state AS delegation_rollover_state,
    state.pending_evidence_kind AS delegation_pending_evidence_kind,
    state.authority_redundancy_ok AS delegation_authority_redundancy_ok,
    state.authority_redundancy_evidence_class AS delegation_authority_redundancy_evidence_class,
    state.last_redundancy_observation_at AS delegation_redundancy_observed_at,
    state.canonical_routing_eligible AS delegation_canonical_routing_eligible,
    state.routing_hard_denied AS delegation_routing_hard_denied,
    state.last_parent_observation_id AS delegation_last_parent_observation_id,
    observation.parent_observation_id AS delegation_parent_observation_id,
    observation.observed_delegation_security AS delegation_security,
    observation.parent_ds_matches_live_dnskey AS delegation_parent_ds_matches_live_dnskey,
    observation.authoritative_dnssec_valid AS delegation_authoritative_dnssec_valid,
    observation.observed_at AS delegation_observed_at,
    observation.earliest_rrsig_expires_at AS delegation_earliest_rrsig_expires_at
`.trim();

export const ROOT_DELEGATION_JOIN_SQL = `
LEFT JOIN hns_root_delegation_state AS state
    ON state.normalized_root_label = nv.normalized_root_label
LEFT JOIN hns_root_parent_observations AS observation
    ON observation.parent_observation_id = state.last_parent_observation_id
    AND observation.normalized_root_label = state.normalized_root_label
`.trim();

export const ROOT_DELEGATION_READ_SQL = `
SELECT
    ${ROOT_DELEGATION_SELECT_SQL}
FROM hns_root_delegation_state AS state
LEFT JOIN hns_root_parent_observations AS observation
    ON observation.parent_observation_id = state.last_parent_observation_id
    AND observation.normalized_root_label = state.normalized_root_label
WHERE state.normalized_root_label = $1
`.trim();

/** One joined row, with the observation columns null when there is none. */
export interface RootDelegationJoinRow {
  readonly delegation_root_label: string;
  readonly delegation_rollover_state: RootDelegationRow["rolloverState"];
  readonly delegation_pending_evidence_kind: RootDelegationRow["pendingEvidenceKind"];
  readonly delegation_authority_redundancy_ok: number | boolean | null;
  readonly delegation_authority_redundancy_evidence_class:
    | RootDelegationRow["authorityRedundancyEvidenceClass"];
  readonly delegation_redundancy_observed_at: string | Date | null;
  readonly delegation_canonical_routing_eligible: number | boolean;
  readonly delegation_routing_hard_denied: number | boolean;
  readonly delegation_last_parent_observation_id: string | null;
  readonly delegation_parent_observation_id: string | null;
  readonly delegation_security:
    | ParentObservationRow["observedDelegationSecurity"]
    | null;
  readonly delegation_parent_ds_matches_live_dnskey: number | boolean | null;
  readonly delegation_authoritative_dnssec_valid: number | boolean | null;
  readonly delegation_observed_at: string | Date | null;
  readonly delegation_earliest_rrsig_expires_at: string | Date | null;
}

function toMs(value: string | Date | null): number | null {
  if (value === null) {
    return null;
  }
  const ms = value instanceof Date ? value.getTime() : Date.parse(value);
  if (Number.isNaN(ms)) {
    throw new TypeError(`unparseable timestamp in root delegation row: ${String(value)}`);
  }
  return ms;
}

function toBool(value: number | boolean | null): boolean {
  // Column is INTEGER CHECK (…IN (0,1)) and NOT NULL whenever the observation
  // succeeded, which is the only kind of observation this join can reach.
  if (value === null) {
    throw new TypeError("successful observation is missing a component finding");
  }
  if (typeof value === "boolean") {
    return value;
  }
  // Anything other than exactly 0 or 1 means a malformed driver result or a
  // query returning the wrong column. Coercing it -- 2 quietly becoming false --
  // would turn that into a silent security downgrade.
  if (value !== 0 && value !== 1) {
    throw new TypeError(`expected a 0/1 component finding, got ${String(value)}`);
  }
  return value === 1;
}

function toNullableBool(value: number | boolean | null): boolean | null {
  return value === null ? null : toBool(value);
}

/**
 * Evaluate a root from its joined row.
 *
 * Pass `null` when the query returned no row at all. Every inconsistent shape
 * throws by way of `resolveRootDelegationState`; nothing degrades quietly.
 */
export function evaluateJoinedRoot(
  row: RootDelegationJoinRow | null,
  nowMs: number,
  thresholds: DelegationThresholdsInput = DEFAULT_DELEGATION_THRESHOLDS,
  policy?: DelegationPolicy,
): DelegationEvaluation {
  if (row === null) {
    return evaluateDelegation(
      null,
      nowMs,
      thresholds,
      policy ?? DEFAULT_DELEGATION_POLICY,
    );
  }

  const stateRow: RootDelegationRow = {
    rolloverState: row.delegation_rollover_state,
    lastParentObservationId: row.delegation_last_parent_observation_id,
    pendingEvidenceKind: row.delegation_pending_evidence_kind,
    authorityRedundancyOk: toNullableBool(row.delegation_authority_redundancy_ok),
    authorityRedundancyEvidenceClass:
      row.delegation_authority_redundancy_evidence_class,
    lastRedundancyObservationAtMs: toMs(row.delegation_redundancy_observed_at),
    canonicalRoutingEligible: toBool(row.delegation_canonical_routing_eligible),
    routingHardDenied: toBool(row.delegation_routing_hard_denied),
  };

  const observation: ParentObservationRow | null =
    row.delegation_parent_observation_id === null
      ? null
      : {
          parentObservationId: row.delegation_parent_observation_id,
          observedDelegationSecurity: requireObservedSecurity(row),
          parentDsMatchesLiveDnskey: toBool(row.delegation_parent_ds_matches_live_dnskey),
          authoritativeDnssecValid: toBool(row.delegation_authoritative_dnssec_valid),
          observedAtMs: requireObservedAt(row),
          earliestRrsigExpiresAtMs: toMs(row.delegation_earliest_rrsig_expires_at),
        };

  return evaluateDelegation(
    resolveRootDelegationState(stateRow, observation),
    nowMs,
    thresholds,
    policy ?? DEFAULT_DELEGATION_POLICY,
  );
}

function requireObservedSecurity(
  row: RootDelegationJoinRow,
): ParentObservationRow["observedDelegationSecurity"] {
  if (row.delegation_security === null) {
    throw new TypeError(
      `observation ${String(row.delegation_parent_observation_id)} has no security finding; ` +
        "the outcome CHECK guarantees a successful observation carries one",
    );
  }
  return row.delegation_security;
}

function requireObservedAt(row: RootDelegationJoinRow): number {
  const ms = toMs(row.delegation_observed_at);
  if (ms === null) {
    throw new TypeError(
      `observation ${String(row.delegation_parent_observation_id)} has no observed_at`,
    );
  }
  return ms;
}

/**
 * The existing API response shape, as far as DNSSEC delegation affects it.
 *
 * This is a *projection*, computed per request. It is never written back to
 * `namespace_verification_assertions`: those rows carry ownership and
 * attachment facts, and a security value stored there would become a second
 * authority no matter how it were labelled.
 *
 * `club_attach_allowed` is deliberately absent. Attachment is granted at
 * ownership proof and is not a function of delegation state -- withholding it
 * until an on-chain DS lands would strand every import behind a second wallet
 * action. Callers keep reading that field from the verification record.
 */
export interface DelegationResponseProjection {
  readonly pirate_web_routing_allowed: boolean;
  readonly pirate_subdomain_issuance_allowed: boolean;
  readonly delegation_security: DelegationEvaluation["delegationSecurity"];
  readonly rollover_state: DelegationEvaluation["rolloverState"];
  readonly observation_fresh: boolean;
  readonly observation_age_seconds: number | null;
  readonly routing_withheld_reason: DelegationEvaluation["routingWithheldReason"];
  readonly signature_expiry_warning: boolean;
  readonly authority_redundancy_healthy: boolean;
  readonly redundancy_evidence_sufficient: boolean;
  readonly redundancy_evidence_class: DelegationEvaluation["redundancyEvidenceClass"];
  readonly redundancy_observation_fresh: boolean;
  readonly canonical_routing_eligible: boolean;
  readonly routing_hard_denied: boolean;
}

/**
 * Project an evaluation into the response shape.
 *
 * Both allow-flags are the same predicate, because both are authenticated
 * resolution: issuing a subdomain certificate for a root whose delegation does
 * not validate advertises exactly the claim the gate exists to withhold.
 *
 * The reason is included in the response, not only the UI, so other surfaces
 * cannot accidentally imply the stronger claim -- a bare `false` reads as "not
 * verified", which is wrong when the truth is "we have not observed it lately".
 */
export function projectDelegationResponse(
  evaluation: DelegationEvaluation,
): DelegationResponseProjection {
  return {
    pirate_web_routing_allowed: evaluation.authenticatedRoutingAllowed,
    pirate_subdomain_issuance_allowed: evaluation.authenticatedRoutingAllowed,
    delegation_security: evaluation.delegationSecurity,
    rollover_state: evaluation.rolloverState,
    observation_fresh: evaluation.observationFresh,
    observation_age_seconds:
      evaluation.observationAgeMs === null
        ? null
        : Math.floor(evaluation.observationAgeMs / 1000),
    routing_withheld_reason: evaluation.routingWithheldReason,
    signature_expiry_warning: evaluation.signatureExpiryWarning,
    authority_redundancy_healthy: evaluation.authorityRedundancyHealthy,
    redundancy_evidence_sufficient: evaluation.redundancyEvidenceSufficient,
    redundancy_evidence_class: evaluation.redundancyEvidenceClass,
    redundancy_observation_fresh: evaluation.redundancyObservationFresh,
    canonical_routing_eligible: evaluation.canonicalRoutingEligible,
    routing_hard_denied: evaluation.routingHardDenied,
  };
}
