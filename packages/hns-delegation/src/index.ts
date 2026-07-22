/**
 * Canonical HNS DS delegation evaluation, shared across repositories.
 *
 * The API consumes this package by `file:` dependency, the same way it already
 * consumes `@pirate/bookings-domain`. There is deliberately no second copy: the
 * freshness and routing rules are security-critical, and two handwritten
 * implementations would be two places for them to drift.
 */

export {
  applyFailedObservation,
  applySuccessfulObservation,
  DEFAULT_DELEGATION_THRESHOLDS,
  evaluateDelegation,
  isOrphanedDsInvariantViolation,
  normalizeThresholds,
  requiresBothKeysPublished,
  resolveRootDelegationState,
  type DelegationEvaluation,
  type DelegationSecurity,
  type DelegationThresholds,
  type DelegationThresholdsInput,
  type ParentObservationRow,
  type RolloverState,
  type RootDelegationRow,
  type RootDelegationState,
  type RootSecurityHistory,
  type RoutingWithheldReason,
} from "./delegation-state";

export {
  evaluateJoinedRoot,
  projectDelegationResponse,
  ROOT_DELEGATION_READ_SQL,
  type DelegationResponseProjection,
  type RootDelegationJoinRow,
} from "./delegation-read-model";
