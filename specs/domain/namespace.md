# Namespace

Status: draft

Related docs:

- [guild.md](./guild.md)
- [artist-identity.md](./artist-identity.md)
- [handles.md](./handles.md)
- [namespace-root-control.md](./namespace-root-control.md)

## Purpose

This doc defines how Pirate names guilds and guild-local user handles.

It covers:

- canonical Pirate route syntax
- differentiation between HNS-compatible and Spaces-compatible roots
- user handle syntax under each root family
- how external root ownership and delegation relate to guild identity

## Non-goals

This doc does not define:

- the full governance model
- the full create-guild API
- the full resolver implementation details for HNS or Spaces
- generalized DNS or wallet record formats
- the audit-oriented evidence and capability transition model for root attachment; see [namespace-root-control.md](./namespace-root-control.md)

## Core Principle

Namespace route syntax is first-class product surface.

Pirate supports two root families:

- bare labels
- `@`-prefixed labels

These are not aliases of each other by default.

Examples:

- `/g/kanye`
- `/g/@kanye`

Those are distinct sovereign roots unless the owner explicitly binds them to the same `guild_id`.

Guild creation requires control of the corresponding external root:

- `/g/kanye` requires control of HNS `.kanye`
- `/g/@kanye` requires control of Spaces `@kanye`

One guild may later attach additional verified roots as mirrors.

## Canonical Guild Routes

Canonical guild routes:

- bare-label namespace: `pirate.sc/g/kanye`
- Spaces namespace: `pirate.sc/g/@kanye`

Rules:

- `/g/kanye` is the HNS-compatible route family
- `/g/@kanye` is the Spaces route family
- users must learn this distinction because HNS `.kanye` and Spaces `@kanye` are different sovereign roots
- Pirate should not hide this distinction behind extra path segments or internal resolver slugs
- the corresponding external root must already exist and be controlled by the creator at guild creation time
- a guild has exactly one primary namespace in v0, but may attach additional verified namespace mirrors later

## Guild-Local User Handles

Guild-local user handles are first-class and not optional.

Handle syntax:

- HNS-style handle inside `/g/kanye`: `name.kanye`
- Spaces-style handle inside `/g/@kanye`: `name@kanye`

These are guild-local user handles, not the core internal app identity.

Pirate still keeps an internal stable user identifier, but the handle syntax is part of the user-facing namespace system.

## Internal Model

V0 fields for `namespaces`:

- `namespace_id`
- `guild_id`
- `display_label`
- `normalized_label`
- `resolver_label`
- `route_family`
- `namespace_role`
- `status`
- `root_proof_status`
- `delegation_status`
- `resolver_owner_address` nullable
- `resolver_controller_address` nullable
- `resolver_attached_at` nullable
- `created_at`
- `updated_at`

V0 meanings:

- `display_label`
  User-facing root label, e.g. `kanye`, `肯伊`, or an emoji label
- `normalized_label`
  Canonical normalized label used by Pirate for comparison and uniqueness checks
- `resolver_label`
  Resolver-compatible encoded label used when the underlying root system requires ASCII-safe encoding such as punycode `xn--...`
- `route_family`
  - `bare`
  - `at`
- `namespace_role`
  - `primary`
  - `mirror`
- `status`
  - `active`
  - `disputed`
  - `frozen`
- `root_proof_status`
  - `pending`
  - `verified`
  - `disputed`
- `delegation_status`
  - `owner_managed`
  - `pirate_managed`

This gives Pirate one clean internal representation while still preserving visible route differences.

`guild_id` is the authoritative foreign key direction in v0: namespace rows point to guilds. `guilds` does not point back to namespaces with a `namespace_id` FK.

State semantics:

- `status` describes Pirate-level namespace usability inside the app
- `root_proof_status` describes whether external HNS or Spaces root ownership proof exists and in what state
- `delegation_status` describes whether the root owner manages SLD issuance directly or delegates it to Pirate

Examples:

- a namespace can be `status = active`, `root_proof_status = verified`, and `delegation_status = owner_managed`
- a namespace can be `status = active`, `root_proof_status = verified`, and `delegation_status = pirate_managed`
- a namespace can be `status = frozen` and `root_proof_status = disputed`
- a guild may have one `primary` namespace and multiple `mirror` namespaces that all resolve to the same `guild_id`

## Label Rules

V0 label rules:

- IDNs and emoji are supported
- the user-visible namespace label is stored in `display_label`
- uniqueness and collision checks use `normalized_label`
- external resolver projection uses `resolver_label`
- `normalized_label` and `resolver_label` must be deterministically derived from the same input label
- length limits apply to the normalized/resolver-safe label form required by the external root system
- must not be in the reserved label list

Reserved labels should include product and routing words such as:

- `u`
- `g`
- `api`
- `auth`
- `settings`
- `admin`

Normalization requirements:

- labels must be normalized before uniqueness checks or persistence
- Unicode-equivalent inputs must collapse to one canonical `normalized_label`
- when the underlying resolver requires ASCII-safe encoding, `resolver_label` must store the encoded form
- route rendering may continue to use `display_label`

The reserved label list is maintained by the implementation. The list above is the minimum v0 set, not the complete long-term inventory.

## Routing Rules

Recommended v0 rules:

- `/g/kanye` resolves the guild with:
  - `normalized_label = "kanye"`
  - `route_family = "bare"`
- `/g/@kanye` resolves the guild with:
  - `normalized_label = "kanye"`
  - `route_family = "at"`
- `/g/肯伊` may resolve the same `guild_id` as `/g/kanye` if both roots are independently proven and explicitly attached to that guild
- `/g/@kanye` may resolve the same `guild_id` as `/g/kanye` if both roots are independently proven and explicitly attached to that guild

Guild-local user handles render consistently with their route family:

- for `route_family = "bare"`: `name.<display_label>`
- for `route_family = "at"`: `name@<display_label>`

Pirate should not normalize one syntax into the other.

External creation requirements:

- `/g/kanye` can only be created after HNS `.kanye` control is proven
- `/g/@kanye` can only be created after Spaces `@kanye` control is proven
- additional namespace mirrors can only be attached after their own corresponding root control is proven

Pirate-managed external SLD issuance requires delegation:

- HNS family: delegation of authoritative DNS management or equivalent root control needed for Pirate-managed `name.kanye`
- Spaces family: delegation of handle issuance/signing authority needed for Pirate-managed `name@kanye`

## HNS

Bare-label guilds are the HNS-compatible family.

Implications:

- `/g/kanye` is the canonical Pirate route for that family
- HNS `.kanye` control is required before the guild is created
- guild-local handles under that family are `name.kanye`

Important:

- proof of HNS root control is required for creation
- Pirate-managed `name.kanye` issuance requires delegation from the HNS root owner
- owner-managed `name.kanye` issuance remains possible if delegation is not granted

## Spaces

`@`-prefixed guilds are the Spaces-compatible family.

Implications:

- `/g/@kanye` is the canonical Pirate route for that family
- Spaces `@kanye` control is required before the guild is created
- guild-local handles under that family are `name@kanye`

Important:

- `@` is part of the user-facing namespace syntax, not decoration
- Pirate should treat Spaces roots as distinct from bare-label roots
- proof of Spaces root control is required for creation
- Pirate-managed `name@kanye` issuance requires delegated issuance/signing authority
- owner-managed `name@kanye` issuance remains possible if delegation is not granted

## Identity vs Projection

Guild identity is still `guild_id`.

Namespace route strings are canonical projections, but they are not the durable social object.

This matters because:

- delegation or governance may change later
- resolver integrations may evolve
- guild settings and post history must survive those changes
- one guild may have multiple route projections rooted in independently owned namespaces

## Conflict Rules

Important conflict case:

- HNS `.kanye`
- Spaces `@kanye`

These may belong to different parties and therefore may represent different guilds.

Therefore:

- Pirate must not assume bare-label and `@` namespaces are equivalent
- route syntax is the disambiguator
- even identical-looking display labels across HNS, Spaces, and IDN roots remain separate sovereign roots until explicitly bound to the same guild
- binding multiple roots to one guild requires accepted proof for each root individually

Within one route family:

- exact label collisions are not allowed
- `normalized_label` collisions are not allowed
- `kanye` and `kanyewest` are always different namespaces
- aliases and redirects are a later feature and do not change canonical namespace identity in v0

## Greenfield Assumption

V0 assumes a greenfield route system.

- no legacy route migration is required by this spec
- if legacy routes appear later, migration rules should be added in a separate transition note

## Search And Discovery

Direct routing is exact:

- `/g/kanye` does not silently normalize to `/g/@kanye`
- `/g/@kanye` does not silently normalize to `/g/kanye`

Search and autocomplete may still surface both route families when the user searches for `kanye`.

That is a discovery feature, not route normalization.

The exact v0 search and autocomplete UX is intentionally unresolved here. If both route families are surfaced for the same text query, product design must make the distinction explicit to users.

## Mirror Namespaces

One guild may attach multiple verified namespace roots.

Examples:

- `.kanye`
- `肯伊`
- `@kanye`

Rules:

- one namespace is marked `primary`
- additional namespaces are marked `mirror`
- all attached namespaces resolve to the same `guild_id`
- mirrors share the same posts, moderation, governance, membership, and treasury surface
- mirrors do not collapse root sovereignty; each attached root still requires independent proof and may have its own delegation state

Mirror attachment is explicit.

Pirate must never auto-merge two roots simply because their labels look related.

## Handle Relationship To Mirrors

Mirrored namespaces share one guild, but they do not share one handle inventory.

Examples:

- `alex.kanye`
- `alex@kanye`
- `alex.肯伊`

Rules:

- handle uniqueness remains namespace-local
- owning `alex.kanye` does not automatically grant `alex@kanye`
- owning `alex.kanye` does not automatically grant `alex.肯伊`
- UI may show that one `user_id` owns handles in multiple sibling namespaces of the same guild
- current-route rendering should prefer the handle for the active namespace when one exists

## Open Questions

- Can a guild ever change which attached namespace is marked `primary` without changing canonical guild identity?
- How should reserved labels be coordinated across sibling namespace mirrors of the same guild?
