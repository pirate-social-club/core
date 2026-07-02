# Community Routing Plane

Status: current

## Current Decision

Pirate v2 does not ship any separate public registry plane.

Community authority is:

- Neon for control-plane identity, verification, routing, jobs, and audit
- Turso for community operational state
- API-served projections for all product reads

## What This Means

- `pirate-web` reads community state from API-served projections.
- Community create, update, and read flows have one operational write path.
- External publication, publisher jobs, and mirrored registry state are not part of the v2 mainline.
- Any older registry-publisher material should be treated as deleted product direction, not deferred work.

## Why

A second registry plane added authority duplication, publication jobs, signer policy questions, and schema overhead with no current product payoff.

The launch goal is a simpler system with one real operational write path.

## Revisit Criteria

Pirate should only add a second public registry plane if one of these becomes a real product requirement:

- third-party verifiable history for community identity/governance fields
- public mutable registry rows consumable by external agents
- explicit community-sovereignty guarantees that exceed backend policy

If that happens, write a fresh design from the live Neon/Turso model rather than reviving deleted registry assumptions.
