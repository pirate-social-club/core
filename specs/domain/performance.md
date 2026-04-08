# Performance

Status: draft

Related docs:

- [livestream.md](./livestream.md)
- [guild.md](./guild.md)
- [marketplace.md](./marketplace.md)

## Purpose

This doc defines the performer-side media plane for Pirate live experiences.

It covers:

- performer collaboration versus audience delivery
- desktop host tooling
- JackTrip's role relative to Agora

## Core Principle

Pirate should separate:

- control plane
- performance plane
- audience plane

Recommended v0 split:

- web/app owns control-plane authoring for `live_room`
- desktop owns host and musician tooling
- Agora remains the audience broadcast rail
- JackTrip is used for low-latency performer collaboration, not for viewer delivery

## Plane Model

### Control Plane

Owned by Pirate web/app.

Examples:

- create room
- schedule room
- create anchor post
- attach listing
- attach donation/guild policy
- manage replay linkage

### Performance Plane

Owned primarily by desktop/native host tooling.

Examples:

- host start/stop controls
- musician invite/join tooling
- low-latency monitoring and routing
- JackTrip session attachment
- capture and mix setup

### Audience Plane

Owned by the livestream delivery stack.

Examples:

- Agora viewer playback
- live watch pages
- replay playback
- audience access and entitlement checks

## JackTrip Role

JackTrip is relevant when multiple musicians are performing together and low latency matters.

Recommended v0 interpretation:

- JackTrip is performer-to-performer infrastructure
- JackTrip is not the viewer-facing streaming rail
- Pirate may attach a JackTrip-backed performance session to a `live_room`, but the audience still watches through Agora or replay surfaces

## Suggested Flow

For multi-musician performance:

1. web/app creates the `live_room`
2. desktop host console attaches to the room
3. performers join a JackTrip collaboration session
4. the host or bridge machine mixes that performance
5. mixed output is broadcast to viewers through Agora

For solo performance:

1. web/app creates the `live_room`
2. desktop or web host console attaches to the room
3. host broadcasts directly to Agora

## Guest And Collaborator Flow

Multi-performer rooms need an invitation and attach flow.

Old Pirate supports a duet guest flow:

- `room_kind: duet` sets an invited collaborator via `guest_wallet`
- the guest calls accept, then start, receiving their own bridge credential
- the guest may be removed by the host mid-session

v2 should model this with:

- `room_kind` on the `live_room` object (`solo`, `duet`, `open_jam`)
- `guest_user_id` nullable on the room for duet rooms
- a `POST /live-rooms/{live_room_id}/guest-attach` endpoint that issues guest credentials analogous to host-attach
- invitation and acceptance as control-plane operations (web/app), not performance-plane plumbing
- cancellation or host-ending a room explicitly terminates guest attach and join state

Recommended v0 guest flow:

1. host creates the room with `room_kind: duet` and optionally specifies `guest_user_id`
2. the invited guest sees the room in their pending invitations (control plane)
3. the guest accepts (control plane)
4. at go-live time, the guest calls guest-attach (performance plane) and receives broadcast credentials
5. if the host ends or cancels the room, the guest attach state is revoked

This preserves the old Pirate capability without letting the performance plane author room metadata.

## Deferred: Per-Segment Pricing And Rights

Old Pirate has a rich segment model for DJ-set economics:

- each room can have multiple timed segments
- each segment has its own `pay_to` address, `song_id`, and royalty `rights` attestation
- `/live/:id/segments/start` creates a new segment mid-stream
- segments support split routing, upstream BPS, and derivative-rights declarations

This is real product value for DJ sets and hosted performances with multiple payout recipients.

v2 defers segments to a later pass. The baseline `live_room` shape does not include segment fields. When segments are added, they should be:

- modeled as a child resource under the `live_room`, not inline fields
- authored through performance-plane endpoints, not the control-plane create-room flow
- resolved against the existing marketplace royalty-graph for rights attestation

This deferral is acknowledged so the capability is not silently lost.

## Open Questions

- Should JackTrip session identity later become a first-class attached object such as `performance_session_id`, or remain an implementation detail behind the live-room host tooling?
- Should guest invitation be modeled as a separate `live_room_invitation` object, or remain a nullable `guest_user_id` on the room itself for v0?
