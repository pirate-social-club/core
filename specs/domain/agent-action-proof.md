# Agent Action Proof

Status: current working spec

This document defines Pirate's mainline `AgentActionProof` canonical request hashing contract.

It is the source of truth for:

- clients that produce `AgentActionProof.canonical_request_hash`
- servers that verify `AgentActionProof`

## Scope

This spec defines:

- the canonical request representation and hash algorithm
- the signature payload for `AgentActionProof`

It does not define:

- route-specific authorization policy
- future key custody or wallet-specific signing UX beyond the Ed25519 contract below

## Canonical Request Input

The server and client must derive the canonical request from:

- HTTP method
- request origin
- request path
- query string
- request body

Headers are excluded.

Route params are represented only through the normalized path and must not be duplicated separately.

## Normalization Rules

### Method

- uppercase ASCII
- examples:
  - `POST`
  - `PUT`
  - `DELETE`

### Origin

- include scheme, host, and port exactly as parsed by standard URL parsing
- examples:
  - `https://pirate.test`
  - `http://127.0.0.1:8787`
- clients must sign against the actual request origin they are sending to

### Path

- path only
- must begin with `/`
- collapse repeated trailing slashes to a single canonical trailing slash rule:
  - `/` stays `/`
  - every other path removes trailing slashes
- do not percent-decode path segments during canonicalization

Examples:

- `/communities/cmt_123/posts`
- `/posts/pst_123`

### Query

- include all query parameters
- parse query pairs in the order delivered by normal URL parsing
- sort canonically by:
  - key ascending by raw UTF-8 byte order of the decoded key
  - then value ascending by raw UTF-8 byte order of the decoded value
- preserve duplicate keys
- encode each key and value with RFC 3986-style percent encoding using `encodeURIComponent`
- join pairs with `&`
- represent an empty query string as the empty string

Examples:

- `a=1&b=2`
- `filter=hot&filter=new`
- empty query becomes ``

### Body

- when the request body is absent, the canonical body is the empty string
- when the request body is present but empty, the canonical body is the empty string
- when the request body transports the proof envelope itself, the proof envelope field is excluded from canonicalization
  - public `CreatePostRequest` excludes `agent_action_proof` from the canonical body
- JSON bodies must be canonicalized recursively:
  - objects sort keys ascending by raw UTF-8 byte order
  - arrays preserve order
  - strings, booleans, null, and numbers use JSON literal encoding
- circular JSON structures are invalid and must be rejected
- non-JSON string bodies use the exact string bytes as provided after transport decoding

Examples:

- `{ "b": 2, "a": 1 }` becomes `{"a":1,"b":2}`
- `{ "a": [2, {"y": 2, "x": 1}] }` becomes `{"a":[2,{"x":1,"y":2}]}`
- absent body becomes ``

## Canonical Request String

The canonical request string is the UTF-8 encoding of these six newline-delimited lines:

1. fixed version tag: `pirate-agent-action-proof-v2`
2. canonical method
3. canonical origin
4. canonical path
5. canonical query
6. canonical body

Example:

```text
pirate-agent-action-proof-v2
POST
https://pirate.test
/communities/cmt_123/posts
draft=false&sort=new
{"body":"Hello","post_type":"text","title":"Agent post"}
```

## Hash Algorithm

- hash algorithm: SHA-256
- input bytes: UTF-8 bytes of the canonical request string
- output encoding: lowercase hexadecimal

The resulting lowercase hex digest is `canonical_request_hash`.

## Signature Payload

Pirate signs the request proof payload as the UTF-8 bytes of these four newline-delimited lines:

1. fixed version tag: `pirate-agent-action-signature-v2`
2. `nonce`
3. `signed_at`
4. `canonical_request_hash`

Example:

```text
pirate-agent-action-signature-v2
nonce-agent-post-1
2026-04-19T12:00:00.000Z
0123456789abcdef...
```

## Signature Verification Contract

- algorithm: Ed25519
- public key source: the active agent ownership record's `public_key`
- public key format: SPKI PEM (`-----BEGIN PUBLIC KEY----- ...`)
- signature bytes: Ed25519 signature over the signature payload above
- signature encoding on the wire: base64 or base64url

If Pirate later adds other key encodings or algorithms, that must mint a new signature version tag or a parallel explicitly versioned verifier contract.

## Freshness And Replay

This mini-spec does not set the freshness window itself, but implementations must pair the hash with:

- `nonce`
- `signed_at`

Replay prevention must reject reuse of the same `(agent_id, nonce)` pair regardless of whether the request hash differs.

## Compatibility Notes

- headers are intentionally excluded to avoid client fragmentation
- any future change to origin, path, query, or body canonicalization must mint a new version tag
- any future change to signature payload shape must mint a new signature version tag
