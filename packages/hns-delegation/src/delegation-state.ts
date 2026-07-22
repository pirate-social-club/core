/**
 * Root-scoped DNSSEC delegation evaluation.
 *
 * See core `specs/domain/hns-ds-delegation-lifecycle.md`. This module is pure:
 * it takes persisted root state plus a clock reading and returns the derived
 * security posture. Nothing here reads or writes storage, so the routing gate
 * and every read-time adapter share one implementation.
 *
 * The central rule is that `secureDelegationVerified` and
 * `authenticatedRoutingAllowed` are one evaluation with two names, never two
 * checks. They are returned from a single function for that reason.
 */

/** The present, observed authentication status of a root. */
export type DelegationSecurity =
  | "unknown"
  | "unsecured"
  | "pending"
  | "secure"
  | "bogus"
  | "drifted";

/** Progress of a key change, independent of present security. */
export type RolloverState =
  | "none"
  | "required"
  | "new_key_prepublished"
  | "new_ds_pending"
  | "overlap"
  | "old_ds_removal_pending";

/**
 * The persisted root row, reduced to what evaluation needs.
 *
 * `secureDelegationVerified` is deliberately absent: it is derived and
 * time-varying, so a stored copy would go stale without any write. There is no
 * field to pass in because there is no field to store.
 */
export interface RootDelegationState {
  readonly delegationSecurity: DelegationSecurity;
  readonly rolloverState: RolloverState;
  /** NULL/undefined means never established -- distinct from established-false. */
  readonly parentDsMatchesLiveDnskey: boolean | null;
  readonly authoritativeDnssecValid: boolean | null;
  /** Timestamp of the last *successful* parent observation, ms since epoch. */
  readonly lastParentObservationAt: number | null;
  /** Earliest RRSIG expiry across the zone's required RRsets, ms since epoch. */
  readonly earliestRrsigExpiresAt: number | null;
}

export interface DelegationThresholds {
  /**
   * How old a successful parent observation may be while still supporting an
   * authenticated-routing claim. Derived from the deployed zone TTLs (300s):
   * three TTL cycles, so one failed poll plus a retry does not withdraw a root,
   * while genuine drift stops being advertised inside ~15 minutes.
   */
  readonly maxObservationAgeMs: number;
  /**
   * How close to RRSIG expiry a zone may get before `secure` is withdrawn
   * rather than merely warned about. Twice `maxObservationAgeMs`, so we can
   * never advertise a signature that expires before the next observation could
   * have caught it.
   */
  readonly expiryProximityThresholdMs: number;
}

export interface DelegationThresholdsInput extends DelegationThresholds {
  /**
   * How far in the future a stored observation timestamp may sit before it is
   * treated as a broken clock rather than a fresh reading. Defaults to zero:
   * an observation from the future is not evidence of anything.
   */
  readonly clockSkewToleranceMs?: number;
}

export const DEFAULT_DELEGATION_THRESHOLDS: Required<DelegationThresholdsInput> = {
  maxObservationAgeMs: 900_000,
  expiryProximityThresholdMs: 1_800_000,
  clockSkewToleranceMs: 0,
};

/**
 * Validate and normalize threshold configuration at the boundary, returning the
 * filled-in shape. A NaN or negative threshold would otherwise silently make
 * every comparison false and every root permanently unroutable -- or, worse,
 * permanently routable.
 *
 * This returns rather than asserting: validation does not add the optional
 * `clockSkewToleranceMs` property, so an assertion to `Required<...>` would be
 * claiming something untrue of the input.
 */
export function normalizeThresholds(
  thresholds: DelegationThresholdsInput,
): Required<DelegationThresholdsInput> {
  const normalized: Required<DelegationThresholdsInput> = {
    maxObservationAgeMs: thresholds.maxObservationAgeMs,
    expiryProximityThresholdMs: thresholds.expiryProximityThresholdMs,
    clockSkewToleranceMs: thresholds.clockSkewToleranceMs ?? 0,
  };
  for (const [name, value] of Object.entries(normalized)) {
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
      throw new TypeError(
        `delegation threshold ${name} must be a finite non-negative number, got ${String(value)}`,
      );
    }
  }
  return normalized;
}

/** Why authenticated routing is withheld. `null` when it is allowed. */
export type RoutingWithheldReason =
  | "no_root_state"
  | "never_observed"
  | "observation_stale"
  | "observation_in_future"
  | "not_secure"
  /** `delegation_security = secure` contradicted by its own component observations. */
  | "incoherent_state"
  | "signature_expiry_unknown"
  | "signature_expiry_imminent";

export interface DelegationEvaluation {
  readonly delegationSecurity: DelegationSecurity;
  readonly rolloverState: RolloverState;
  readonly observationFresh: boolean;
  /** Age of the last successful observation in ms, or `null` if never observed. */
  readonly observationAgeMs: number | null;
  /**
   * The assertion vocabulary's name for the derived condition. Identical to
   * `authenticatedRoutingAllowed` by construction -- see the module header.
   */
  readonly secureDelegationVerified: boolean;
  /** The routing gate's name for the same condition. */
  readonly authenticatedRoutingAllowed: boolean;
  readonly routingWithheldReason: RoutingWithheldReason | null;
  /** Expiry is close enough to warn about, but not yet close enough to withhold. */
  readonly signatureExpiryWarning: boolean;
  /** Both persisted observations are established-true. */
  readonly componentsSecure: boolean;
}

/**
 * Evaluate a root's delegation posture at a point in time.
 *
 * Pass `null` for a root with no state row at all. That fails closed as
 * `unknown` with routing withheld -- it must never fall back to legacy
 * session-scoped assertions, which describe ownership rather than DNSSEC and
 * would answer a question they were never evidence for.
 */
export function evaluateDelegation(
  state: RootDelegationState | null,
  nowMs: number,
  thresholds: DelegationThresholdsInput = DEFAULT_DELEGATION_THRESHOLDS,
): DelegationEvaluation {
  const { maxObservationAgeMs, expiryProximityThresholdMs, clockSkewToleranceMs } =
    normalizeThresholds(thresholds);

  if (state === null) {
    return {
      delegationSecurity: "unknown",
      rolloverState: "none",
      observationFresh: false,
      observationAgeMs: null,
      secureDelegationVerified: false,
      authenticatedRoutingAllowed: false,
      routingWithheldReason: "no_root_state",
      signatureExpiryWarning: false,
      componentsSecure: false,
    };
  }

  const observationAgeMs =
    state.lastParentObservationAt === null ? null : nowMs - state.lastParentObservationAt;

  // An observation timestamped in the future is a broken clock, not a fresh
  // reading. Treating it as fresh would let a skewed writer hold a root
  // advertised indefinitely, so it fails closed outside the configured
  // tolerance.
  const observationInFuture =
    observationAgeMs !== null && observationAgeMs < -clockSkewToleranceMs;

  // Boundary: an observation exactly `maxObservationAgeMs` old is still fresh.
  // The spec writes `<=`, and a strict `<` would withdraw a root one tick early
  // on every cycle boundary.
  const observationFresh =
    observationAgeMs !== null &&
    !observationInFuture &&
    observationAgeMs <= maxObservationAgeMs;

  const msUntilExpiry =
    state.earliestRrsigExpiresAt === null ? null : state.earliestRrsigExpiresAt - nowMs;

  // Boundary: expiry exactly `expiryProximityThresholdMs` away is not yet
  // imminent, matching the `<=`/`<` split above -- withdrawal begins strictly
  // inside the window.
  const expiryImminent =
    msUntilExpiry !== null && msUntilExpiry < expiryProximityThresholdMs;

  // Authenticated resolution requires temporal validity, so absent expiry
  // evidence is not the same as distant expiry. We cannot claim a zone
  // validates now if we do not know when its signatures stop being valid.
  const expiryUnknown = msUntilExpiry === null;

  // `delegation_security` is a stored summary of the two persisted
  // observations. Trusting the summary alone would let one incoherent row --
  // written by a bug, a partial update, or a hand-edit -- route on a zone whose
  // own evidence says it does not validate. Require all three to agree.
  const componentsSecure =
    state.parentDsMatchesLiveDnskey === true && state.authoritativeDnssecValid === true;
  const summarySecure = state.delegationSecurity === "secure";

  let routingWithheldReason: RoutingWithheldReason | null = null;
  if (!summarySecure) {
    routingWithheldReason = "not_secure";
  } else if (!componentsSecure) {
    routingWithheldReason = "incoherent_state";
  } else if (observationAgeMs === null) {
    routingWithheldReason = "never_observed";
  } else if (observationInFuture) {
    routingWithheldReason = "observation_in_future";
  } else if (!observationFresh) {
    routingWithheldReason = "observation_stale";
  } else if (expiryUnknown) {
    routingWithheldReason = "signature_expiry_unknown";
  } else if (expiryImminent) {
    routingWithheldReason = "signature_expiry_imminent";
  }

  const allowed = routingWithheldReason === null;

  return {
    delegationSecurity: state.delegationSecurity,
    rolloverState: state.rolloverState,
    observationFresh,
    observationAgeMs,
    // One evaluation, two names.
    secureDelegationVerified: allowed,
    authenticatedRoutingAllowed: allowed,
    routingWithheldReason,
    signatureExpiryWarning:
      msUntilExpiry !== null &&
      !expiryImminent &&
      msUntilExpiry < expiryProximityThresholdMs * 2,
    componentsSecure,
  };
}

/**
 * Apply a *successful* parent observation: the security value is replaced
 * outright.
 */
export function applySuccessfulObservation(
  observed: DelegationSecurity,
  history: RootSecurityHistory,
): DelegationSecurity {
  // `drifted` is a claim about history -- previously secure, now anchoring no
  // live key. It must be decided against whether the root was EVER secure, not
  // against the immediately previous value: secure -> bogus -> DS mismatch is a
  // genuine drift, and reading only the previous enum would call it
  // `unsecured` and lose the fact that a working delegation was lost.
  if (observed === "drifted" && !history.everSecure) {
    return "unsecured";
  }
  return observed;
}

/**
 * Whether the root has ever held a `secure` finding.
 *
 * This is a property of the observation log, not of the current state row, and
 * must be supplied by the caller from `hns_root_parent_observations` (or an
 * equivalent durable record). It is a separate input precisely so it cannot be
 * approximated from the current value.
 */
export interface RootSecurityHistory {
  readonly everSecure: boolean;
}

/**
 * Apply a *failed* parent observation: the last finding stands.
 *
 * The failure is recorded separately as an outage, and `observation_fresh`
 * lapses on its own. A transient provider outage must never erase a useful
 * last-known `secure` finding, nor be reinterpreted as a security result.
 */
export function applyFailedObservation(previous: DelegationSecurity): DelegationSecurity {
  return previous;
}

/**
 * Rollover stages during which both keys must be published and both DS records
 * must therefore still match.
 *
 * An orphaned old DS during these stages is not rollover noise -- it means the
 * old key was retired before the old DS was removed, which is the exact failure
 * the ordering exists to prevent. Callers must alarm rather than tolerate it.
 */
const BOTH_KEYS_LIVE_STAGES: ReadonlySet<RolloverState> = new Set<RolloverState>([
  "overlap",
  "old_ds_removal_pending",
]);

export function requiresBothKeysPublished(rolloverState: RolloverState): boolean {
  return BOTH_KEYS_LIVE_STAGES.has(rolloverState);
}

/**
 * Whether an orphaned Pirate-issued DS observed in the parent is an invariant
 * violation rather than expected cleanup lag.
 */
export function isOrphanedDsInvariantViolation(rolloverState: RolloverState): boolean {
  return requiresBothKeysPublished(rolloverState);
}

/**
 * The persisted root row, as stored. It carries no security findings and no
 * observation timestamp: those live on the referenced observation.
 */
export interface RootDelegationRow {
  readonly rolloverState: RolloverState;
  /** Present iff the root has a latest-successful observation. */
  readonly lastParentObservationId: string | null;
  /** Backing evidence for a `pending` reading; null when no action is in flight. */
  readonly pendingEvidenceKind:
    | "wallet_transaction_id"
    | "mempool_observation"
    | "user_acknowledgement"
    | null;
}

/** A successful parent observation, as stored. */
export interface ParentObservationRow {
  readonly parentObservationId: string;
  /** Already normalized by the observer against root history. */
  readonly observedDelegationSecurity: Exclude<DelegationSecurity, "pending">;
  readonly parentDsMatchesLiveDnskey: boolean;
  readonly authoritativeDnssecValid: boolean;
  readonly observedAtMs: number;
  readonly earliestRrsigExpiresAtMs: number | null;
}

/**
 * Compose the stored row and its referenced observation into the shape the
 * evaluator consumes.
 *
 * This exists so no caller can hand `evaluateDelegation` a hand-assembled view:
 * findings and timestamps come from the observation, never from the state row,
 * which is why the state row does not store them.
 *
 * Every inconsistent pairing throws. The database FK guarantees that a non-null
 * `lastParentObservationId` resolves to a real successful observation of the
 * same root, so a mismatched pairing is a broken query or adapter, not a state
 * the data can be in. Degrading it to `unknown` would convert a caller bug into
 * a silent security downgrade -- or, worse, let a root that IS observed be
 * reported as never observed. `unknown` is reserved for the one shape that
 * genuinely occurs: a real row with no observation pointer and no observation.
 */
export function resolveRootDelegationState(
  row: RootDelegationRow | null,
  observation: ParentObservationRow | null,
): RootDelegationState | null {
  if (row === null) {
    if (observation !== null) {
      throw new Error(
        `resolveRootDelegationState received observation ${observation.parentObservationId} ` +
          "with no root row",
      );
    }
    return null;
  }

  if (row.lastParentObservationId === null) {
    if (observation !== null) {
      throw new Error(
        `resolveRootDelegationState received observation ${observation.parentObservationId} ` +
          "for a row with no observation pointer",
      );
    }
    // The only legitimate never-observed shape. `pending` is still assertable:
    // it is a claim about an owner action in flight, not an observation.
    return {
      delegationSecurity: row.pendingEvidenceKind === null ? "unknown" : "pending",
      rolloverState: row.rolloverState,
      parentDsMatchesLiveDnskey: null,
      authoritativeDnssecValid: null,
      lastParentObservationAt: null,
      earliestRrsigExpiresAt: null,
    };
  }

  if (observation === null) {
    throw new Error(
      `resolveRootDelegationState received no observation for referenced ` +
        `${row.lastParentObservationId}; the FK guarantees one exists`,
    );
  }

  if (observation.parentObservationId !== row.lastParentObservationId) {
    throw new Error(
      `observation ${observation.parentObservationId} is not the row's referenced observation ` +
        `${row.lastParentObservationId}`,
    );
  }

  // Pending evidence overlays ONLY an `unsecured` observation: publication is
  // genuinely in flight, and re-asking the owner for an action already taken is
  // the thing `pending` exists to prevent. It never softens a `secure`, `bogus`
  // or `drifted` finding -- those are current readings of the chain, and an
  // owner's in-flight action says nothing about a zone that fails to validate
  // or an anchor that was lost.
  const delegationSecurity: DelegationSecurity =
    observation.observedDelegationSecurity === "unsecured" && row.pendingEvidenceKind !== null
      ? "pending"
      : observation.observedDelegationSecurity;

  return {
    delegationSecurity,
    rolloverState: row.rolloverState,
    parentDsMatchesLiveDnskey: observation.parentDsMatchesLiveDnskey,
    authoritativeDnssecValid: observation.authoritativeDnssecValid,
    lastParentObservationAt: observation.observedAtMs,
    earliestRrsigExpiresAt: observation.earliestRrsigExpiresAtMs,
  };
}
