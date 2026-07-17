# Community gate leaf identity and outcomes

## Purpose

Member-facing gate presentations need to associate each policy atom with its summary, evaluation trace,
and required action. Gate type and traversal order are not identities: a policy may contain repeated atom
types, and editing or reordering one branch must not silently attach another branch's status or guidance.

Each persisted gate atom therefore has an opaque `gate_id`. Evaluators and summary builders copy that
same value onto the corresponding `GateTraceNode`, `MembershipGateSummary`, and leaf required action.

## Gate identity

- `gate_id` is an opaque ASCII identifier matching `^[A-Za-z0-9_-]{1,64}$`.
- It is unique among the atoms in one policy.
- It is stable when an atom is reordered or its configuration is edited.
- A newly-authored atom receives an identity before it is saved.
- Cloning an atom creates a new identity; it does not copy the source identity.
- Consumers compare identities for equality and do not derive meaning from their contents.

Policies created before this contract may omit `gate_id`. During migration the API may deterministically
assign an ID from the atom's expression path when it normalizes such a policy. That path-derived value is
transitional: it becomes durable only when the normalized policy is persisted. A path is not itself a
stable identity because reordering an unpersisted legacy expression changes the path.

The API rejects duplicate or malformed identities at policy save. It must not silently replace a valid,
persisted identity.

## Leaf outcomes

Every gate leaf in a new evaluation trace carries one of four outcomes:

- `passed`: the atom is satisfied.
- `action_required`: the atom is not satisfied, and the member can take a described action to satisfy it.
- `terminal_mismatch`: the atom was evaluated successfully but is not satisfiable by a remediation flow
  represented by the response.
- `provider_unavailable`: the atom could not be evaluated truthfully because required infrastructure or
  an upstream provider was unavailable.

Operator trace nodes do not carry a leaf outcome. The outcome is authoritative for presentation; clients
must not classify a leaf by inspecting its free-form `reason` string.

Within a satisfied `or` expression, a failed alternative retains its own leaf outcome, but presentation
may mute it because it was not required for the expression to pass. Structural policy semantics and leaf
classification are deliberately separate concerns.

## Compatibility and rollout

The schema keeps identity and outcome fields optional during rollout so older stored policies and mixed
deployments remain readable. New authoring, API normalization, summary generation, and evaluation must
populate them. Once the legacy corpus has been normalized and the deployment pins are aligned, a future
contract revision may make them required.
