# Post Composer

Status: draft

Related docs:

- [post.md](./post.md)
- [guild.md](./guild.md)
- [donations.md](./donations.md)
- [asset.md](./asset.md)

## Purpose

This doc defines the v0 post composer UI flow: what the user sees, what they interact with, and what is hidden or derived automatically.

It covers:

- the page shell and layout
- the primary composer tabs and their fields
- what appears by default vs behind "More options" or expanders
- the contextual derivative/reference step
- how rights basis is derived rather than manually selected
- what stays outside the composer entirely
- permission gates that affect composer visibility

It does not cover:

- final copy or pixel-level layout
- the livestream or room creation flows (separate specs)
- donation UI on published posts (belongs to monetization/display specs)
- full media analysis pipeline (see post.md)

## Core Principle

The composer should feel like Reddit's "Create post" flow: pick a type, add a title and content, optionally set extras, post. Domain complexity (rights, analysis, governance) should be invisible unless the user's actions trigger it.

## Page Shell

```
┌─────────────────────────────────────────────┐
│  Create post    [guild selector]  Drafts │
├─────────────────────────────────────────────┤
│  [Text]  [Image]  [Video]  [Song]           │
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

**Tab row**: Text, Image, Video, Song. One active at a time. Song is the main Pirate-specific addition. Link and Poll are not v0.

**Main body**: Title first, then the content surface that swaps by tab. Guild metadata (flair, tags) is not a v0 composer concern; it belongs to guild display settings.

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

### Song

- **Title** — optional
- **Primary audio upload** — required
- **Caption** — optional
- **Lyrics** — required, text input
- **Original / Remix toggle** — small inline toggle inside the song tab. Default is Original. Selecting Remix triggers the derivative step (see below).

Advanced song inputs (instrumental stem, vocal stem) are under an expander, not in the primary view. They are **optional** at post-creation time. Stems and timed lyrics may be attached later through async enrichment. Karaoke readiness is determined by the asset's `karaoke_package_ref` completeness, not by composer completeness. See karaoke.md for the staged enrichment model.

Song tab is hidden or disabled unless the user has `create_song_post` permission per the guild permissions matrix.

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

## More Options

The following are hidden behind a "More options" collapse or menu. Most users never need to touch these.

- **Schedule** — defaults to "Post now"
- **Age gate** — defaults to `none`; auto-set to `18_plus` if media analysis classifies content as adult, or if any upstream asset referenced by the post is already `18_plus` (per post.md, downstream derivatives must inherit the stricter gate)
- **Translation policy** — defaults to `machine_allowed`
- **Poster / thumbnail** — for video posts, secondary to the video upload
- **Advanced song inputs** — instrumental stem, vocal stem (optional; may also be attached or generated later)
- **Derivative / upstream reference search** — for video posts that want to attribute or claim derivative status (appears here if not already triggered by analysis or remix mode)

## Livestream And Room

Livestream and room creation are not composer tabs or adjacent composer CTAs in v0.

Livestreams are separate first-class objects with their own creation surface. See [livestream.md](./livestream.md) for the canonical `live_room` model and lifecycle.

Rooms (synchronous voice rooms) are similarly outside the post composer flow. They may be added to guild-level navigation or a separate creation surface, but they do not appear as post types or CTAs inside the composer.

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
6. Age gate may be auto-set to `18_plus` based on analysis results, or inherited from an upstream asset that is already `18_plus`
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

- Four tabs: Text, Image, Video, Song. One active at a time.
- Song contains an Original/Remix toggle and hides advanced stems under an expander.
- Derivative step is contextual, triggered by remix mode, user declaration, or analysis detection.
- Rights basis is derived, never shown as a dropdown.
- Livestream and room: separate CTAs, not tabs.
- Donation: creator-side opt-in on monetized listings only, not in the composer for free posts.
- Advanced options collapsed under "More options."
- Permission gates control tab visibility, not UI surface area.