# Community Registry Plane

Status: deferred for launch

## Current Decision

Pirate does not ship a Tableland-backed community registry at launch.

Launch authority is:

- Neon for control-plane identity, verification, routing, jobs, and audit
- Turso for community operational state
- API-served projections for all product reads

## What This Means

- `pirate-web` does not query Tableland directly.
- Community create, update, and read flows do not depend on Tableland publication.
- No launch API contract includes registry-publication status fields or publication jobs.
- Any older Tableland publisher or registry-plan material should be treated as archived and non-operative.

## Why It Was Deferred

The Tableland path added a second authority plane, publisher/runtime complexity, signer policy questions, and schema/mutation overhead that is not required for launch.

The launch goal is a simpler system with one real operational write path.

## Revisit Criteria

Pirate should only revive a public onchain registry if one of these becomes a real product requirement:

- third-party verifiable history for community identity/governance fields
- public mutable registry rows consumable by external agents
- explicit community-sovereignty guarantees that exceed backend policy

If that happens, write a fresh design from the live Neon/Turso model rather than assuming the deleted Tableland planning docs still apply.
