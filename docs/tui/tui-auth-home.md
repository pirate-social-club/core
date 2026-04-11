# TUI Auth And Home

Status: draft

Related docs:

- [onboarding.md](/home/t42/Documents/pirate-v2/specs/domain/onboarding.md)
- [profile.md](/home/t42/Documents/pirate-v2/specs/domain/profile.md)
- [search.md](/home/t42/Documents/pirate-v2/specs/domain/search.md)
- [namespace.md](/home/t42/Documents/pirate-v2/specs/domain/namespace.md)
- [community.md](/home/t42/Documents/pirate-v2/specs/domain/community.md)
- [account-creation-first-slice.md](/home/t42/Documents/pirate-v2/docs/account-creation-first-slice.md)
- [auth.yaml](/home/t42/Documents/pirate-v2/specs/api/src/paths/auth.yaml)
- [onboarding.yaml](/home/t42/Documents/pirate-v2/specs/api/src/paths/onboarding.yaml)

## Purpose

This doc defines the user-visible auth and home-shell contract for `pirate-tui`.

It covers:

- visible auth states
- the meaning of `Connect`
- session restore on launch
- signed-out shell behavior
- signed-in home-shell behavior
- how onboarding appears after sign-in
- how HNS sync status appears in the shell

## Non-goals

This doc does not define:

- low-level auth handshake implementation details
- browser automation details
- thread rendering, voting, or comment interactions
- Pirate search interaction details
- generic external web browsing
- exact visual placement of shell chrome

## Core Principle

The TUI should land the user in a usable shell quickly.

Auth should be one compact action.

Onboarding should not dominate the app after auth succeeds.

## Visible Auth States

The TUI has only 3 visible auth states:

- `signed_out`
- `auth_in_progress`
- `signed_in`

These are user-visible states.

The spec does not lock lower-level internal transitions such as:

- browser handoff started
- proof exchange pending
- upstream provider callback received

Those are implementation details.

## `Connect`

`Connect` is the single user-facing auth action in the TUI.

It must not ask the user to choose between:

- sign in
- sign up

Reason:

- Pirate determines whether the authenticated upstream subject maps to an existing account or a new account during session exchange
- that distinction is backend behavior, not a separate TUI decision

Recommended semantics:

- user activates `Connect`
- TUI initiates Pirate auth
- auth completes through the configured implementation path
- TUI exchanges the resulting upstream proof for a Pirate app session
- if successful, the user becomes `signed_in`

The default human flow may use browser handoff.

Alternative implementation paths such as:

- JWT exchange
- device-code flow
- other upstream auth providers

may exist later, but they do not change the visible state model.

## Session Restore On Launch

The TUI should persist the Pirate access token locally.

Recommended launch behavior:

1. load stored Pirate access token if present
2. attempt an authenticated read such as `GET /users/me`
3. if the token is valid, enter `signed_in`
4. if the token is invalid or expired, discard it and enter `signed_out`

The user should not need to reconnect on every launch when a valid Pirate session already exists.

## Signed-Out Shell

When `signed_out`, the TUI should show a minimal shell.

Required behavior:

- show the normal shell chrome
- show `Connect`
- do not show live authenticated content
- do not fetch a teaser feed from the backend in v0

Reason:

- a signed-out teaser feed adds product and API surface without being necessary for the first shell

## Signed-In Shell

When `signed_in`, the TUI should show the primary shell.

Recommended top-level destinations:

- `Home`
- `Search`
- account item

Account item rule:

- when signed out, the item label is `Connect`
- when signed in, the item label is the user's current `.pirate` handle

This gives immediate identity feedback without adding a separate sign-in/sign-up decision surface.

## Home Before Search

The first signed-in destination should be the home shell, not the onboarding form.

Reason:

- the user needs a place to land immediately after auth
- onboarding is secondary once the Pirate session exists
- the shell should feel like an application, not a wizard

This does not reduce the importance of search.

It only means:

- home shell comes first in the navigation hierarchy
- search is a primary destination inside the signed-in shell

## Onboarding In The Signed-In Shell

Onboarding state in the TUI must be driven by `GET /onboarding/status`.

The TUI should not invent a second onboarding source of truth.

Recommended rule:

- if onboarding status indicates remaining useful setup work, show a compact onboarding nudge in the signed-in shell
- if onboarding status indicates no remaining useful setup work, show no onboarding nudge

Important:

- onboarding is not a blocking full-screen flow in this shell spec
- onboarding is a compact module or nudge layered onto the signed-in experience

## Reddit Attachment

Reddit account attachment and import are onboarding/enrichment concerns, not auth concerns.

They happen after the Pirate session exists.

Implications:

- `Connect` does not mean "connect Reddit"
- Reddit verification/import remains optional and skippable
- Reddit setup should be offered as a post-auth nudge when relevant

## Onboarding Nudge Contract

Recommended v0 behavior:

- the nudge appears only when `GET /onboarding/status` says the setup is still relevant
- the nudge may offer actions such as:
  - attach Reddit
  - continue setup
  - skip for now

Skip rule for v0:

- skip/dismiss is session-local only
- if the user skips the nudge, hide it for the current TUI session
- on the next launch, the nudge may reappear if `GET /onboarding/status` still indicates incomplete relevant setup

This spec does not require a persistent onboarding-dismiss API in v0.

## New vs Existing Users

The TUI does not expose separate visible states for:

- new account bootstrapping
- existing account resume

Reason:

- the current account-creation slice performs user/profile/handle bootstrap inside the session exchange boundary
- the TUI receives a usable Pirate session and onboarding/profile data as part of the authenticated session model

So the visible contract is:

- auth succeeds
- user becomes `signed_in`

Whether Pirate resumed or created the account is not a separate top-level shell state.

## HNS Sync Status

If HNS mode is enabled, HNS sync status may appear in the shell.

Rules:

- HNS sync status is secondary chrome
- HNS sync status is not a navigation destination
- exact placement is an implementation detail

The shell may show:

- syncing
- synced
- unavailable/error

But this spec does not lock whether that appears in:

- header
- footer
- side status area

## Minimal State Chart

Visible state chart:

```text
signed_out
  -> auth_in_progress
  -> signed_in

signed_in
  -> signed_out   (on invalid/expired session or explicit sign-out)
```

Session restore chart on launch:

```text
launch
  -> stored token exists?
    -> no  -> signed_out
    -> yes -> validate session
             -> valid   -> signed_in
             -> invalid -> signed_out
```

Onboarding nudge overlay:

```text
signed_in
  -> fetch onboarding status
  -> onboarding relevant?
     -> yes -> show compact nudge
     -> no  -> no nudge
```

## Audit Invariants

These are the key invariants implementation must preserve:

- `Connect` is one action, not a sign-in/sign-up fork
- visible auth states remain `signed_out`, `auth_in_progress`, and `signed_in`
- session restore happens on launch when a stored Pirate token exists
- signed-out shell does not fetch or render live authenticated content
- signed-in shell lands in home, not a blocking onboarding wizard
- onboarding UI is driven by `GET /onboarding/status`
- Reddit attachment is post-auth onboarding, not auth
- HNS sync status remains secondary chrome
