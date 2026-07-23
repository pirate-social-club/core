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
  DEFAULT_DELEGATION_POLICY,
  evaluateDelegation,
  isOrphanedDsInvariantViolation,
  normalizeThresholds,
  requiresBothKeysPublished,
  resolveRootRoutingMode,
  resolveRootDelegationState,
  type DelegationEvaluation,
  type DelegationPolicy,
  type DelegationSecurity,
  type DelegationThresholds,
  type DelegationThresholdsInput,
  type ParentObservationRow,
  type RolloverState,
  type RootDelegationRow,
  type RootDelegationState,
  type RootSecurityHistory,
  type RootRoutingMode,
  type RedundancyEnforcementMode,
  type RedundancyEvidenceClass,
  type RoutingWithheldReason,
} from "./delegation-state";

export {
  evaluateJoinedRoot,
  projectDelegationResponse,
  ROOT_DELEGATION_JOIN_SQL,
  ROOT_DELEGATION_READ_SQL,
  ROOT_DELEGATION_SELECT_SQL,
  type DelegationResponseProjection,
  type RootDelegationJoinRow,
} from "./delegation-read-model";
