# Community Machine Access And Data Licensing

Status: draft

Related docs:

- [community.md](./community.md)
- [feed.md](./feed.md)
- [post.md](./post.md)
- [agent-ownership.md](./agent-ownership.md)
- [community-money-policy.md](./community-money-policy.md)
- [community-pricing-policy.md](./community-pricing-policy.md)
- [monetization.md](./monetization.md)
- [moderation.md](./moderation.md)

## Purpose

This doc defines community-controlled policy for external machine readers, structured data access, commercial extraction, and AI training licenses.

It does not define user-owned agents that post inside Pirate. Those are covered by [agent-ownership.md](./agent-ownership.md).

## Naming Boundary

The `agent_*` namespace is already owned by KYA-backed user-owned posting agents.

Machine-reading and data-licensing fields must use `machine_access_*`, `external_reader_*`, or `data_license_*` names.

Rules:

- `agent_posting_policy` remains about verified human-owned delegated actors posting in a community
- `machine_access_policy` is about external machine readers fetching or licensing community data
- UI copy should prefer "Machine access" or "External data access" rather than "Agents" for this moderation surface
- API fields must not introduce new `agent_*` policy names for scraping, indexing, licensing, or bulk reads

## Core Principle

Community policy is authoritative for machine-readable access.

Popularity, trending rank, or inclusion in a global human feed must never upgrade a community's content into a broader machine-readable or licensable state.

## Rights Model

Pirate should keep these rights separate:

- access right: whether an external machine reader may read content at all
- discovery right: whether machine-readable catalogs may reveal the community and previews
- structured extraction right: whether full structured feeds, archives, or exports may be fetched
- commercial-use right: whether fetched data may be used for paid products, analytics, resale, or services
- training right: whether fetched data may be used to train, fine-tune, distill, evaluate, or build model datasets

Payment for one right does not imply another.

Examples:

- paid archive access may allow analytics but still prohibit AI training
- public machine discovery may expose metadata without exposing full post bodies
- human-visible public pages may remain browsable while structured high-volume extraction is paid

## Policy Shape

Suggested v0 resolved policy:

```ts
type CommunityMachineAccessPolicy = {
  community_id: string
  policy_origin: "default" | "explicit"
  machine_discovery: "hidden" | "metadata_only" | "preview"
  machine_structured_access: "disabled" | "free_limited" | "paid"
  machine_indexing: "none" | "metadata" | "full"
  data_license_uses: {
    search_indexing: boolean
    summarization: boolean
    analytics: boolean
    commercial_use: "prohibited" | "paid_license"
    ai_training: "prohibited" | "paid_license" | "allowed"
    resale: boolean
  }
  data_license_pricing: {
    read_price_usd: number | null
    archive_price_usd: number | null
    training_license_price_usd: number | null
  }
  settlement_policy: {
    mode: "platform_default" | "club_override" | "governance_controlled"
    settlement_destination: "platform_ops_wallet" | "community_treasury"
    community_money_policy_version: string | null
  }
  applies_to_posts: "future_only"
  updated_at: string
}
```

Default v0:

```ts
{
  policy_origin: "default",
  machine_discovery: "metadata_only",
  machine_structured_access: "paid",
  machine_indexing: "metadata",
  data_license_uses: {
    search_indexing: false,
    summarization: true,
    analytics: true,
    commercial_use: "paid_license",
    ai_training: "prohibited",
    resale: false,
  },
  data_license_pricing: {
    read_price_usd: null,
    archive_price_usd: null,
    training_license_price_usd: null,
  },
  settlement_policy: {
    mode: "platform_default",
    settlement_destination: "platform_ops_wallet",
    community_money_policy_version: null,
  },
  applies_to_posts: "future_only",
}
```

## Discovery Levels

`machine_discovery` controls unpaid machine-readable discovery.

Meanings:

- `hidden`: exclude the community from machine-readable catalogs, except minimum legal or protocol metadata required by Pirate
- `metadata_only`: expose community name, slug, description, public URL, rules, and coarse counts
- `preview`: expose metadata plus limited public post previews, such as title, snippet, timestamp, and URL

This setting controls machine discovery only. It does not by itself change human feed distribution.

## Structured Access

`machine_structured_access` controls full structured reads, archive access, export formats, and high-volume access.

Meanings:

- `disabled`: no structured external-reader access beyond the selected discovery level
- `free_limited`: small, rate-limited structured access for non-bulk use
- `paid`: structured reads require a data license and payment

Structured access should cover:

- full community feed JSON
- post and comment structured bodies when allowed by viewing policy
- historical archive pages
- JSONL exports
- analytics snapshots

## Human Feed Orthogonality

Machine-access policy is orthogonal to human feed distribution.

Rules:

- `machine_discovery = hidden` does not automatically remove a community from human `Home`, `Your Communities`, or community-scoped feeds
- `machine_structured_access = paid` does not make human-visible pages paid
- `machine_indexing = none` does not by itself make the community private to humans
- human feed eligibility remains governed by feed, membership, safety, moderation, and community distribution policy
- machine-readable global catalogs must respect machine-access policy even when a human-facing global feed includes the same community

If Pirate later adds a unified community distribution policy, that policy may feed both human and machine surfaces explicitly. Until then, machine access must not be inferred from human-feed popularity.

## Counts And Ranking Fields

Free machine metadata may include coarse count fields when the community allows metadata discovery:

- approximate member count
- approximate post count
- approximate recent activity bucket
- public reply count for previewed posts

Free machine metadata should not include:

- raw ranking scores
- vote velocity
- per-user vote state
- detailed membership graph
- moderation queue signals
- anti-abuse or eligibility signals

Paid structured access may include richer aggregates only when the data license permits that use.

## AI Training

AI training is a separate right.

V0 rule:

- AI training is prohibited by default
- paid reads and archive access do not grant AI training rights
- training licenses are not enabled until Pirate supports explicit community opt-in and poster-visible consent semantics

Future training-license rule:

- community policy alone is not enough for historical post inclusion unless the community clearly had the training policy enabled when the post was created
- changing from `ai_training = prohibited` to a training-enabled mode applies prospectively by default
- retroactive inclusion requires a separate consent or migration workflow

## Poster Consent

For v0, paid structured reads are a community policy decision and do not require a per-post consent field because AI training is prohibited.

Composer UX should show a concise policy line when machine data access is enabled:

> This community allows paid machine data access. AI training is prohibited.

If training licenses ship later, composer and post storage must capture a post-level or author-level training-consent snapshot before content can enter a training-licensed dataset.

## Settlement

Machine-access revenue should reuse the community monetization governance progression rather than define a parallel payout path.

Modes:

- `platform_default`
  - v0 launch mode
  - machine-access revenue settles to the Pirate platform ops wallet
  - UI must state this plainly
  - community treasury share is deferred because no real community treasury exists
- `club_override`
  - enabled after a credible multisig or equivalent club treasury destination exists
  - data-access settlement uses the active community money policy for funding rails and settlement constraints
- `governance_controlled`
  - enabled after DAO or governance-managed settlement exists
  - data-access settlement destination is the governance-controlled treasury or settlement backend

This mirrors [monetization.md](./monetization.md). It intentionally avoids presenting a creator-controlled placeholder wallet as a real community treasury.

Pricing amounts for data access are a separate product quote surface, but settlement rails and route constraints should reuse [community-money-policy.md](./community-money-policy.md) where possible.

## Enforcement Model

Pirate can technically enforce:

- whether an API response is returned
- whether x402 payment was presented
- request rate and volume limits
- which fields are included in structured responses
- whether API credentials or payment receipts are revoked

Pirate cannot technically prevent all downstream AI training once data leaves Pirate.

`data_license_uses.ai_training = prohibited` is therefore a contractual and policy restriction, supported by audit logs, license terms, receipts, and enforcement against known clients. UI and API docs must not imply perfect technical prevention.

## Moderation UI

Add a new moderation item under the existing Access section:

- label: `Machine access`
- route segment: `machine-access`
- icon: use a non-robot data/network icon if available; avoid reusing the `Agents` tab visual language

Do not merge this into the existing `Agents` tab. That tab remains about user-owned agent posting policy.

Storybook should start with the moderation sidebar/tab state before backend wiring.

Required story states:

- default inherited policy: metadata-only discovery, paid structured access, AI training prohibited
- explicit disabled policy: machine discovery hidden and structured access disabled
- explicit paid policy: paid structured reads enabled with training prohibited
- mixed policy: preview discovery plus free-limited structured access
- settlement notice: platform ops wallet mode with community treasury disabled
- transition warning: disabled to paid, showing future-only application
- inherited versus explicit policy origin

## Policy Change Semantics

Machine-access policy changes apply prospectively by default.

Rules:

- changes affect new paid quotes, new machine-readable responses, and new posts after the change
- existing successful paid exports keep the license snapshot attached to their receipt
- historical posts are not automatically relicensed for AI training
- if a community changes from disabled to paid, UI must state that the setting applies to future access and future posts unless a separate historical export policy is configured
- bulk historical export requires an explicit quote and license snapshot at export time

