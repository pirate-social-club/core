# Community Protocol subsd VPS Assets

Status: **BLOCKED — DO NOT DEPLOY**.

These files are historical deployment evidence for the deleted community protocol issuer stack.
The former API source path `services/community-protocol-subsd` no longer exists, and no supported
consumer completes `community_handle_protocol_issuances`. Starting the pinned image would restore
neither the issuer nor end-to-end issuance. Tracking: core issue #126.

The commerce API must reject `issuance_mode=spaces_subspace` while this status applies.

## Rebuild exit criteria

Do not remove the block until all of the following exist:

- maintained issuer and `subsd` source in an explicitly owned repository
- a versioned API-to-issuer contract with idempotency and terminal failure semantics
- durable reconciliation from `issuing` to `issued` or `failed`
- recovery behavior for a paid claim when issuance cannot complete
- current wallet custody, backup, and restore procedures
- a staging proof covering restart, duplicate delivery, and failed-batch recovery
- a production deployment whose internal-only network boundary has been verified

The material below describes the retired boundary and must not be used as a runbook.

## Retired shape

The intended service was a persistent `subsd` runtime for Pirate community handle protocol issuance.

This service was intended to run next to the Spaces verifier stack because it needed local access to
`spaced` and the operator wallet that can operate parent Spaces such as `@pesto`.

## Boundary

- `subsd` was internal-only and was not to be exposed through Caddy or a public hostname.
- It bound through Docker host networking and was consumed by `community-protocol-issuer`.
- Its data directory was durable and required wallet-aware backup handling.

## Files

- `env/subsd.env.example`
  Runtime environment contract.
- `systemd/pirate-community-protocol-subsd.service`
  Docker-backed service unit.

## Historical image

The old build command referred to the deleted API path `services/community-protocol-subsd` and has
been removed so this document cannot be mistaken for a working deployment procedure.

Historical staging image; retained for provenance only, not approved for deployment:

```text
t3333333k/community-protocol-subsd@sha256:be9ac7cff697a576d7926707531e9b0c580c5368dfe7b06e59dd12c80cbf5618
```

The former VPS procedure is intentionally withdrawn. Do not run the old systemd unit or operate a
parent Space from this service until the rebuild exit criteria are met.
