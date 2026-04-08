# MPP

Status: draft

Related docs:

- [overview.md](./overview.md)
- [openapi.yaml](./openapi.yaml)
- [../domain/user.md](../domain/user.md)
- [../domain/guild.md](../domain/guild.md)
- [../domain/post.md](../domain/post.md)
- [../domain/feed.md](../domain/feed.md)
- [../domain/karma.md](../domain/karma.md)

## Purpose

This doc defines Pirate's machine-access and payment-gated API posture.

It covers:

- how Pirate should expose agent-friendly machine surfaces
- where MPP or x402-style payment challenges belong
- how human interactive access differs from machine and bulk access
- how Self verification interacts with quotas and gating
- which data products are appropriate for paid machine access

## Non-goals

This doc does not define:

- final payment provider implementation
- exact Tempo, Stripe, Lightning, or custom payment-method wiring
- final HTTP middleware code
- final crawler detection heuristics
- final export pricing tables

## Core Principle

Pirate should be:

- easy for humans to read and participate in
- easy for agents to integrate with
- difficult to extract from at bulk scale for free

The right split is:

- free human interactive surface
- normal authenticated app API
- paid machine or bulk-access surface

MPP should be first-class for the third surface.

## Delegated Use vs Extraction Use

The key distinction is not human versus agent.

The key distinction is:

- delegated use
- extraction use

Delegated use means a client, agent, or application is acting on behalf of a specific user through the normal authenticated product surface.

Extraction use means a client is retrieving guild corpus data in bulk or through machine-optimized search, export, archive, or feed surfaces.

Recommended v0 rule:

- delegated use stays on the normal authenticated API and consumes the user's permissions and quotas
- extraction use may be routed to the paid machine-access surface and challenged with MPP-compatible `402` flows

## Why MPP Matters

Pirate's guild corpus is valuable.

Examples:

- threads and replies
- guild-specific language and slang
- artist-guild context
- question-answer history
- scrobble-derived audience signals
- high-quality human interaction data

That makes Pirate attractive to:

- crawlers
- agent developers
- retrieval systems
- model-training pipelines
- analytics consumers

Pirate should not give bulk access to that corpus away by accident.

## Access Surfaces

### Human Interactive Surface

This includes:

- normal web pages
- app views
- guild pages
- thread views
- feed reads
- profile reads

Recommended v0 policy:

- free to view
- session or app auth may still apply where needed
- rate limited, but not paywalled by default
- Self verification should not be required for ordinary browsing

### Authenticated Human API

This includes:

- app-backed reads
- app-backed writes
- normal user profile operations
- post, comment, vote, and join actions

Recommended v0 policy:

- free within normal product use
- quota-based rather than payment-gated
- Self verification may unlock higher trust and some higher read quotas

### Delegated User Agent

- acts on behalf of a signed-in user
- uses the normal authenticated API
- reads what the user can read
- writes only within that user's permissions
- consumes that user's quotas
- leaves an audit trail
- does not default to MPP solely because the caller is an agent

### Bulk Extraction Agent

This includes:

- export endpoints
- high-volume crawl endpoints
- corpus search endpoints
- archive or firehose-style reads
- machine-optimized JSON or NDJSON retrieval

Recommended v0 policy:

- explicitly separate from the normal app surface
- challenge with `402 Payment Required` when policy requires payment
- accept MPP credentials on retry
- return payment receipts when successful

Important boundary:

- regular non-MPP endpoints should still have rate limits and quotas that make free bulk extraction impractical
- MPP exists so machine clients can buy efficient access explicitly rather than scraping the normal app surface at pagination speed

## Storage vs Access

MPP is an access-layer policy, not a storage-layer requirement.

Important rule:

- posts, comments, and replies remain offchain in v0
- their storage staying offchain does not prevent Pirate from metering machine access to them

The valuable control point is the read or export surface, not forcing all social text onto a chain.

## Recommended Access Tiers

### Anonymous Human

- free page views
- soft rate limits
- reduced API quotas

### Signed-In Human

- normal app and API usage
- no payment for ordinary use
- baseline quotas

### Self-Verified Human

- higher trust
- higher free quotas for interactive use
- normal voting and trust-sensitive actions
- possible access to richer history or search surfaces without payment, within limits

## Non-MPP Rate-Limit Posture

Non-MPP endpoints should be usable by humans and the app, but unattractive for corpus extraction.

Recommended v0 rules:

- ordinary list and feed endpoints should have quota and rate-limit policies sized for interactive use
- cursor pagination on the normal app API must not be treated as the intended bulk-export mechanism
- when machine clients want efficient archive, export, or search access, Pirate should direct them to the MPP surface

Examples:

- `GET /guilds`
- `GET /guilds/{guild_id}/posts`
- `GET /feeds/home`
- `GET /feeds/your-guilds`

These remain normal product endpoints, not bulk data pipes.

## Where MPP Should Apply

Good v0 candidates:

- bulk thread export
- high-volume reply retrieval
- full guild corpus export
- structured search across thread archives
- machine-readable guild history
- paid firehose or changefeed later

Bad v0 candidates:

- normal thread page views
- ordinary guild browsing
- profile viewing in the web app
- normal feed reads in the consumer product

Recommended v0 in-scope endpoint:

- `POST /mpp/guilds/{guild_id}/threads/export`
- `GET /mpp/jobs/{job_id}` for polling async MPP export jobs

Directional later candidates:

- `POST /mpp/guilds/{guild_id}/corpus/search`
- `GET /mpp/posts/{post_id}/replies/full`
- `GET /mpp/users/{user_id}/activity/export`

## API Posture

Pirate should expose machine access intentionally rather than trying to infer perfectly whether a caller is a bot.

Recommended shape:

- normal app endpoints remain on the core authenticated API
- machine-oriented endpoints live under a clearly separate machine-access surface
- that machine surface may use MPP challenges

Possible URL posture:

- `/mpp/guilds/{guild_id}/threads/export`
- `/mpp/jobs/{job_id}`
- `/mpp/guilds/{guild_id}/corpus/search`
- `/mpp/posts/{post_id}/replies/full`
- `/mpp/users/{user_id}/activity/export`

This keeps:

- human browsing simple
- machine access explicit
- payment enforcement predictable

## MPP Protocol Posture

Recommended v0 behavior:

1. client requests a machine-access resource
2. Pirate returns `402 Payment Required` when payment is needed
3. response includes `WWW-Authenticate: Payment`
4. client retries with `Authorization: Payment`
5. Pirate verifies payment and returns the resource or an accepted async job
6. Pirate returns `Payment-Receipt` on success
7. if the resource is async, the client polls the machine-surface job endpoint

Recommended v0 export behavior:

- guild thread export is modeled as an async job rather than a sync download
- payment-auth callers should be able to poll that job without requiring app bearer auth
- export endpoints should surface policy and eligibility failures explicitly, not only payment challenges

Pirate should remain payment-method agnostic at the protocol layer.

Convenience metadata:

- Pirate may also include a machine-readable JSON body describing the payment challenge
- that JSON body is convenience metadata for clients
- the MPP protocol source of truth is the payment-auth header contract, not the JSON body alone

Recommended `402` error distinction:

- `payment_required`
  No payment has succeeded yet; the response includes a payment challenge.
- `payment_failed`
  A payment attempt was made but did not verify or settle correctly.

Directional challenge body shape:

```json
{
  "code": "payment_required",
  "message": "This endpoint requires MPP payment",
  "resource_type": "guild_threads_export",
  "payment_intent": "charge",
  "payment_methods": ["tempo", "stripe"],
  "challenge_ref": "mpp_chl_01..."
}
```

## Charge vs Session

MPP supports:

- `charge`
- `session`

Recommended v0 defaults:

- use `charge` for discrete resources such as exports, archive pulls, and search requests
- consider `session` later for streaming or sustained machine consumption such as firehose or token-metered search

## Compatibility With x402

Pirate should preserve compatibility with x402-style exact payment flows where practical.

Reasoning:

- x402 already fits the "pay for this request" mental model
- MPP is the better first-class framing because it is broader and method-agnostic

Recommended product wording:

- Pirate exposes machine-payable endpoints using MPP-compatible `402` flows
- x402-compatible clients should still be able to consume the simpler exact-payment paths where supported

Important boundary:

- Pirate should not collapse MPP and x402 into one invented header model
- MPP should use its payment-auth header contract
- x402 compatibility should be treated as a separate compatibility layer for supported clients and exact-payment flows

## Self Verification Relationship

Self verification is not the same thing as MPP.

Recommended v0 rules:

- Self verification is for trust, voting, gates, and quota boosts
- MPP is for paid machine or bulk access
- Pirate should not require users to either pay or Self-verify just to browse ordinary public pages

Good uses of Self here:

- higher free quotas for trusted humans
- stronger export permissions for certain guild roles
- better anti-abuse posture on search and read APIs

Bad uses:

- mandatory Self verification for all public reading
- treating Self as a replacement for machine-payment policy

## Guild Policy Interaction

Guilds may later influence how their data is exposed to machine clients.

Possible later controls:

- machine export allowed or disabled
- default machine-access price tier
- public summary access versus full archive access
- guild-specific commercial licensing

Recommended v0 stance:

- Pirate sets the default machine-access policy platform-wide
- guild-level overrides are a later policy layer

## Revenue Attribution And Settlement

Machine extraction revenue should be attributed based on the resource being sold, not by the mere presence of an agent.

Recommended v0 rule:

- human participation is free
- machine extraction is metered
- guild corpus value is licensed on behalf of the guild

Definition:

- `net distributable revenue` means gross paid amount minus taxes, refunds, chargebacks, payment-processor or facilitator fees, and other explicit non-distributable settlement costs
- payout splits such as `90 / 10` apply to net distributable revenue, not raw gross receipts

### Revenue Classes

#### Direct Single-Guild Corpus Product

Examples:

- guild thread export
- guild corpus search
- guild archive retrieval

Recommended v0 split:

- 90% to guild treasury
- 10% to platform

#### Cross-Guild Corpus Product

Examples:

- cross-guild search
- cross-guild export bundles
- multi-guild archive products

Recommended v0 split:

- platform takes 10% of net distributable revenue
- the remaining guild pool is allocated pro rata by explicit weighting across included guilds

Recommended weighting inputs may include:

- matched documents
- returned items
- bytes delivered
- tokenized result weight

Pirate should choose one explicit allocation rule per product and expose it clearly.

#### Platform-Derived Product

Examples:

- platform-wide analytics
- ranking insights
- abuse or moderation intelligence
- aggregate non-corpus data products

Recommended v0 rule:

- separate economics
- not forced into the 90/10 corpus-licensing split

### Treasury-First Settlement

Recommended v0 rule:

- machine extraction revenue settles to guild treasury
- not directly to moderators, owners, or individual posters or commenters
- downstream redistribution is a later governance policy

Reasoning:

- treasury-first avoids rent extraction by guild controllers
- treasury-first avoids per-author accounting complexity in v0
- treasury-first keeps guild governance separate from access metering

### Eligibility And Exclusions

The following content is not export-eligible in v0:

- deleted content
- private content
- moderator-restricted content
- content otherwise excluded by product or policy gating

Excluded content:

- must not be returned from paid export surfaces
- must not produce payout attribution

## Scrobble And Listener Data Boundary

Scrobble-derived data is valuable, but Pirate does not need to put all listener detail behind MPP on day one.

Recommended v0 split:

- normal authenticated endpoints may expose limited scrobble history and aggregate listener summaries
- bulk listener export, high-volume user listening export, and machine-oriented audience analytics should move to the MPP surface
- standard endpoints should prefer summary-oriented responses and interactive quotas

This keeps:

- normal music-guild UX simple
- fan recognition features available in the app
- extractive analytics and bulk audience harvesting on the paid machine surface

## OpenAPI Implication

When Pirate adds `/mpp/...` endpoints to `openapi.yaml`, it should model payment auth explicitly rather than pretending MPP is covered by bearer auth alone.

Directional implication:

- normal app endpoints continue using the app auth scheme
- MPP endpoints add a payment-auth mechanism or header model appropriate to the chosen MPP implementation

## Open Questions

- Which machine-access surfaces should be in v0 versus later, beyond exports and search?
- Should Self-verified humans receive a larger free machine-style quota before payment is required?
- Should guilds later define their own downstream treasury redistribution policies?
- When should Pirate use one-time `charge` versus longer-lived `session` intents for agent consumption?
