# Post Composer

Status: draft

Related docs:

- [post.md](./post.md)
- [guild.md](./guild.md)
- [identity-presentation.md](./identity-presentation.md)
- [donations.md](./donations.md)
- [asset.md](./asset.md)
- [livestream.md](./livestream.md)
- [live-segments.md](./live-segments.md)

## Purpose

This doc defines the v0 post composer UI flow: what the user sees, what they interact with, and what is hidden or derived automatically.

It covers:

- the page shell and layout
- the primary composer tabs and their fields
- live-mode composition
- what appears by default vs behind "More options" or expanders
- the contextual derivative/reference step
- how rights basis is derived rather than manually selected
- what stays outside the composer entirely
- permission gates that affect composer visibility

It does not cover:

- final copy or pixel-level layout
- donation UI on published posts (belongs to monetization/display specs)
- full media analysis pipeline (see post.md)

## Core Principle

The composer should feel like Reddit's "Create post" flow: pick a type, add a title and content, optionally set extras, post. Domain complexity (rights, analysis, governance) should be invisible unless the user's actions trigger it.

## Page Shell

```
┌─────────────────────────────────────────────┐
│  Create post    [guild selector]  Drafts │
├─────────────────────────────────────────────┤
│  [Text]  [Image]  [Video]  [Link] [Song] [Live] │
├─────────────────────────────────────────────┤
│                                             │
│  Title                                       │
│  ┌─────────────────────────────────────┐    │
│  └─────────────────────────────────────┘    │
│                                             │
│  Content area (swaps by tab)                 │
│  ...                                        │
│                                             │
├─────────────────────────────────────────────┤
│                  [Save Draft]  [Post]        │
└─────────────────────────────────────────────┘
```

**Top row**: "Create post" heading, guild selector, and a drafts link.

**Tab row**: Text, Image, Video, Link, Song, Live. One active at a time. Song and Live are the main Pirate-specific additions. Poll is not v0.

**Main body**: Title first, then the content surface that swaps by tab. If the guild has flair enabled, the composer may expose one optional flair picker for top-level posts using the guild's curated definitions. Freeform tags remain out of scope.

**Footer**: Save Draft and Post actions.

## Tabs And Fields

One tab active at a time. Switching tabs preserves whatever the user typed in shared fields (title, caption) but swaps the content area.

### Text

Closest to a Reddit text post.

- **Title** — optional if body is filled
- **Body** — rich text editor, optional if title is filled

Constraint: at least one of title or body is required.

### Image

- **Title** — optional
- **Image upload** — required, at least one image. Primary surface.
- **Caption** — optional
- Multiple images: if supported later, use a gallery tray on the same flow, not a separate mode.

### Video

- **Title** — optional
- **Video upload** — required, at least one video. Primary surface.
- **Caption** — optional

Poster/thumbnail is a secondary field under "More options," not primary.

If the uploaded video contains audio, Pirate runs ACRCloud analysis automatically. The user does not see this happen; results surface only if attribution or derivative linking is needed.

### Link

- **Title** — optional
- **URL** — required
- **Commentary** — optional
- **Link preview** — derived automatically when available; it is preview UI, not a required authoring field

This should follow the same simple mental model as Reddit link posts: paste a URL, optionally add title/commentary, and post.

### Song

- **Title** — optional
- **Primary audio upload** — required
- **Caption** — optional
- **Lyrics** — required, text input
- **Instrumental stem** — optional
- **Vocal stem** — optional
- **Original / Remix toggle** — small inline toggle inside the song tab. Default is Original. Selecting Remix triggers the derivative step (see below).

Instrumental and vocal stems are first-class song inputs in the main song flow, but they remain **optional** at post-creation time. Stems and timed lyrics may also be attached later through async enrichment. Karaoke readiness is determined by the asset's `karaoke_package_ref` completeness, not by composer completeness. See karaoke.md for the staged enrichment model.

Song tab is hidden or disabled unless the user has `create_song_post` permission per the guild permissions matrix.

### Live

Live is a composer mode, not a normal `post_type`.

Submitting the Live mode creates:

- the anchor post
- the `live_room`
- the initial setlist
- optional listing scaffolding when live access is paid

Primary fields:

- **Title** — required
- **Description** — optional
- **Cover** — optional
- **Schedule** — optional; defaults to "ready now"
- **Room kind** — required (`solo`, `duet`)
- **Visibility** — required (`public`, `unlisted`)
- **Access mode** — required (`free`, `gated`, `paid`)
- **Guest performer** — optional, only when relevant
- **Performer allocations** — required; percentages must sum to `100`
- **Setlist** — required as part of creation

Identity rule:

- Song and Live modes should not expose anonymous identity controls
- song and live creation must use public identity in v0
- the host's verified public identity is operationally relevant for room authority, rights review, payouts, guest invitations, and later replay clearance
- the anchor post created for a live room should therefore be non-anonymous in v0
- song posts should likewise be non-anonymous in v0 because authorship, rights review, Story publication, and payout routing depend on the author's verified public identity

Setlist behavior:

- the initial setlist must be present in the create request
- the setlist may be created in `draft` state when the host is still editing it
- the room may be created or scheduled with a draft setlist
- the room must not start live until the setlist becomes `active`
- surprise songs during live still append `added_live` items later

Setlist entry behavior:

- the setlist editor should default to searching Pirate's canonical songbase / track catalog
- selecting an existing track should populate the display title and artist automatically
- manual title/artist entry is a fallback for unreleased originals, unresolved tracks, or temporary placeholders

Performer allocation behavior:

- `solo` rooms still require an explicit allocation row for the host with `100%`
- `duet` rooms require explicit host and guest allocations summing to `100%`
- the composer must not allow ambiguous "we'll split it later" live rooms

This keeps the host's intent structured from the first write, not only at go-live time.

## Contextual Derivative Step

The derivative/reference step is not a permanent field, not a tab, and not in "More options." It appears inline under the main editor only when triggered.

### Triggers

The derivative step appears when:

1. User selects Song > Remix
2. User indicates the upload is based on another work (a contextual prompt during asset flow)
3. Media analysis detects a likely upstream reference that requires attribution (`analysis_state = allow_with_required_reference`)

### UI shape

When triggered, the derivative step shows:

- **"Find source audio or upstream work"** heading
- **Search field** for Pirate/Story assets
- **Selected source chips or cards** for attached upstream references
- **Short requirement message** if attribution is mandatory: "Attach the original track before posting"

This is a contextual step, not a separate composer mode. For Song > Remix, at least one upstream reference is required before the post can be published.

## Rights Basis

Rights basis is never a manual dropdown the user picks.

It is derived from context:

| Situation | rights_basis |
|---|---|
| Social-only text, image, or video post with no asset claim | `none` |
| User uploads original media and the asset flow marks it as asset-bearing | `original` |
| User attaches upstream asset references (remix song or derivative video) | `derivative` |
| User links attribution without claiming derivative status | `attribution_only` |

The user may be asked "Is this your original work?" or "Is this based on another work?" as a contextual prompt — not a rights basis taxonomy picker.

A later "Treat as asset" path may exist for upgrading a social post to a rights-bearing one, but it is not a giant visible config panel.

## Identity Presentation

For post types that allow anonymous identity, the composer should keep identity simple.

Recommended UI shape:

1. `Post anonymously` toggle when the guild allows anonymous posting
2. qualifier multi-select dropdown, shown only when anonymous posting is active
3. qualifier chips rendered below the control

Rules:

- the qualifier picker must only show platform-defined qualifiers that the user is eligible to disclose
- v0 qualifiers should come from [user.md](./user.md) `verification_capabilities` plus explicitly supported provider-specific qualifier templates
- qualifiers must render as normalized labels such as `18+`, `US National`, or `Palm Scan`, not raw proof payloads
- the composer must not allow freeform user-authored authority qualifiers
- qualifiers already implied by guild gates should be hidden from the picker
- public posts should not expose the qualifier picker in v0
- `song` and `live` must not expose anonymous identity controls
- anonymous scope remains part of guild policy in v0; it does not need to be a first-class composer control

## Secondary Options

Less common controls may still live under a lightweight secondary section when implemented.

- **Schedule** — defaults to "Post now"
- **Translation policy** — defaults to `machine_allowed`
- **Poster / thumbnail** — for video posts, secondary to the video upload
- **Derivative / upstream reference search** — for video posts that want to attribute or claim derivative status (appears here if not already triggered by analysis or remix mode)

## Flair

Flair is optional community labeling metadata, not canonical post truth.

Composer rules:

- at most one flair may be selected per post
- the picker should only show active flair definitions for the selected guild
- if a flair definition has `allowed_post_types`, the picker should only show options valid for the active composer tab
- flair selection should be visible but lightweight, closer to a subreddit flair chooser than to a tagging surface
- freeform tag entry does not exist in v0
- replies should not expose flair selection in v0 unless Pirate later decides thread replies need their own conversational labeling

Recommended placement:

- below the title and above the primary content surface for top-level posts
- collapsed behind a lightweight trigger such as `Add flair` when no flair is selected
- rendered as a pill selector or modal list, not a tokenizing multi-select input

Behavior:

- if the guild does not have flair enabled, no flair UI appears
- if the guild requires flair on top-level posts, publishing should be blocked until one active flair is selected
- if the selected post type has no active applicable flair definitions, the composer must not dead-end the user; the guild settings are invalid and should be treated as an admin configuration problem rather than a user error
- if a previously selected flair becomes archived before publish, the draft must prompt the user to choose a new active flair or clear it if the guild does not require flair

## Livestream And Room

Livestream authoring should happen inside the composer shell through the Live mode.

Important boundary:

- Live is a composer mode, not a normal `post_type`
- the composer still creates a normal anchor post plus a first-class `live_room`
- room lifecycle remains owned by `live_room`, not by the post row

This gives Pirate one structured authoring surface while preserving the correct backend object model.

## Anonymous Identity Boundary

Anonymous identity is useful for social or journalistic speech, not for rights-bearing music objects.

Recommended v0 rule:

- `text`, `image`, `video`, and `link` modes may expose guild-allowed anonymous identity controls when guild policy allows it
- `song` and `live` modes must not expose anonymous identity controls
- the backend should reject anonymous creation attempts for song posts and live anchor posts even if a buggy client submits them

## Donation

Donation is a creator-side opt-in on monetized listings, not a per-post charity picker.

Per donations.md: the guild defines the donation partner and the policy mode. The creator chooses whether to participate and at what percentage. The donation destination does not vary per post — it always routes to the guild's active partner.

### When donation appears in the composer

Donation UI only appears when all three conditions are true:

1. The guild has an active donation partner (`donation_partner_status = active`)
2. The guild's `donation_policy_mode` is `optional_creator_sidecar` (the v0 default) or `fundraiser_default`
3. The creator is listing the content for sale (monetized listing flow)

When those conditions are met, the monetization section of the composer shows:

- **Donation opt-in** — a checkbox: "Donate part of your proceeds to [partner name]"
- **Donation share** — a percentage input, visible only when opt-in is checked, constrained to `0 < share <= 50`, defaulting to a guild-suggested value
- **Partner name** — read-only, pulled from the guild's `donation_partner_id`

This is not a general post field. It belongs to the listing/monetization sub-flow inside the composer.

### Donation display on published posts

Only monetized posts where the creator opted into donation display a donation badge. A guild having an active donation partner does not cause all posts in that guild to show charity labels.

When a monetized post has `donation_opt_in = true`:

- On the PostCard, next to or below the price label: e.g., "$3.99 · 10% to MusiCares"
- This is a display-only concern; the buyer does not choose the destination
- The PostCard types currently lack a field for this — `SongContentSpec` and other monetized content types should carry `donationLabel` or similar to render this information

### What does NOT appear in the composer

- A charity destination picker — the partner comes from guild policy
- Donation UI on free/social-only posts — it only applies to monetized listings

## Permission Gates Affecting Composer Visibility

| Gate | Effect on composer |
|---|---|
| `create_post` | Required to see the composer at all. All members have this. |
| `create_song_post` | Without this, the Song tab is disabled or hidden. |
| `schedule_livestream` | Affects the "Go Live" CTA visibility, not the composer. |
| Guild posting policy | May restrict which tab types are available in a given guild. |

The `artist_governance_state` of the guild does not gate the composer UI directly; it is a property of the guild that determines whether canonical artist song posts are allowed.

## Post-Submission Flow

After the user submits:

1. Media analysis runs automatically (ACRCloud for audio-bearing uploads, safety scanning for images/video)
2. Analysis state is set on the post
3. If `allow_with_required_reference`, the user must attach upstream references before publishing
4. If `review_required`, the post enters moderation review
5. If `blocked`, the post cannot be published and the user is told why
6. Age gate is set automatically to `18_plus` when analysis classifies the content as adult, or when an upstream asset already carries the stricter gate
7. The user is not exposed to `analysis_state` or `rights_basis` directly; they see human-readable messages and prompts

## Summary

The mental model is:

1. Pick type
2. Add title and content
3. Optional extras (collapsed by default)
4. Post

And only when the content implies it:

5. Resolve derivative/reference requirements (contextual step, not permanent UI)

Key constraints:

- Six tabs: Text, Image, Video, Link, Song, Live. One active at a time.
- Song contains an Original/Remix toggle and keeps optional stems in the main song flow.
- Live creates both an anchor post and a `live_room`, and requires an initial setlist payload.
- Derivative step is contextual, triggered by remix mode, user declaration, or analysis detection.
- Rights basis is derived, never shown as a dropdown.
- Identity is a presentation-mode choice with optional disclosed verified claim chips on eligible post types.
- Flair is optional, single-select, guild-scoped, and never freeform.
- Donation: creator-side opt-in on monetized listings only, not in the composer for free posts.
- Permission gates control tab visibility, not UI surface area.
