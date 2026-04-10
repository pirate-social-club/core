# Pirate TUI

`pirate-tui` is the terminal client for Pirate.

The best first slice is onboarding, not the full Reddit-like shell.
The current repo already has real onboarding contracts for:

- Pirate session bootstrap
- Reddit verification
- Reddit import
- Suggested communities after import

It also already has real read/write surfaces for:

- community discovery
- community post lists
- single post reads
- post voting

Notifications are not a real product surface yet. The web app keeps `/inbox` as a placeholder, so the TUI should do the same for now.

## Optional HNS Mode

`pirate-tui` can now run outbound non-loopback HTTP(S) requests through a local `letsdane` proxy backed by `hnsd`.

This is opt-in and intended for HNS-hosted Pirate deployments:

- `PIRATE_ENABLE_HNS=1`
- `PIRATE_HNSD_PATH=/path/to/hnsd` if `hnsd` is not already on `PATH`
- `PIRATE_HNS_ROOT_ADDR` defaults to `127.0.0.1:9591`
- `PIRATE_HNS_RECURSIVE_ADDR` defaults to `127.0.0.1:9592`
- `PIRATE_HNS_PROXY_HOSTS=pirate,api.pirate` to override which hosts use the HNS proxy

By default, HNS proxying is scoped to the host from `PIRATE_API_BASE_URL` and its subdomains. Loopback/dev URLs stay direct, and conventional third-party hosts are not proxied unless you opt into them explicitly.

The TUI keeps trusting normal system roots plus an in-memory local CA used only for its own `letsdane` transport, so this does not require browser or OS trust-store changes.

If `hnsd` or the local `letsdane` proxy dies after startup, the TUI now fails proxied requests fast instead of silently routing into a dead proxy. It does not yet auto-restart those background components.

On cold start, `hnsd` may need time to sync headers before HNS lookups succeed. The TUI now fails those requests explicitly while the resolver is still syncing instead of sending early requests into `SERVFAIL`.

## What The References Suggest

### 1. Use Go + Bubble Tea

The local references point in one direction:

- `bubbletea` gives the core model/update/view architecture
- `lipgloss` gives layout and styling
- `cliamp` shows how to structure a non-trivial Bubble Tea app with:
  - one main program
  - a single top-level model
  - focused state sub-structs
  - async commands for network work
  - state transition tests

### 2. Copy `cliamp`'s architecture, not its UI density

`cliamp` is useful because it keeps one Bubble Tea model but splits behavior across files such as `init.go`, `update.go`, `view.go`, `keys.go`, `providers.go`, and `commands.go`.

That is the right pattern here.

What we should not copy:

- dense feature sprawl from day one
- highly stateful playback-specific rendering
- retro audio-player information density

### 3. Use Bubbles components for onboarding

The Bubble Tea examples show the exact primitives onboarding needs:

- `isbn-form` for validated multi-input flow
- `list-default` for selectable community lists
- `composable-views` for screen-level composition
- the commands tutorial for async API calls

That means the onboarding slice should lean on:

- `textinput`
- `list`
- `spinner`
- `help`
- `viewport` for long summaries if needed

## Product Constraints From This Repo

### Already real

- `GET /onboarding/status`
- `POST /onboarding/reddit-verification`
- `POST /onboarding/reddit-imports`
- `GET /onboarding/reddit-imports/latest`
- `GET /communities/discover`
- `GET /communities/:communityId/posts`
- `GET /posts/:postId`
- `POST /posts/:postId/vote`

### Real enough to plan around, but not fully wired for terminal yet

- device-session based browser handoff is clearly intended:
  - DB schema exists
  - web route copy and page exist
  - web client can authorize a waiting device session

The missing piece in this repo review is the terminal-side API surface for creating and polling device sessions. That likely needs to be added before terminal-first auth is truly complete.

### Not ready

- notifications / inbox behavior

Do not design the first TUI around notifications.

## Recommended First Architecture

Start small:

```text
pirate-tui/
  cmd/pirate-tui/main.go
  internal/app/model.go
  internal/app/init.go
  internal/app/update.go
  internal/app/view.go
  internal/app/keys.go
  internal/app/commands.go
  internal/app/styles.go
  internal/app/session.go
  internal/app/onboarding.go
  internal/app/communities.go
  internal/api/client.go
  internal/api/types.go
```

Keep one top-level model and explicit sub-state:

```go
type Screen int

const (
    ScreenAuth Screen = iota
    ScreenOnboarding
    ScreenCommunityPicker
    ScreenCommunityFeed
    ScreenPost
    ScreenPlaceholderInbox
)

type Model struct {
    screen      Screen
    width       int
    height      int
    session     SessionState
    onboarding  OnboardingState
    communities CommunityState
    post        PostState
    status      StatusState
}
```

This follows the `cliamp` pattern:

- one model
- one update loop
- commands return typed messages
- view is a switch over top-level screen state

## Onboarding-First Flow

The first real terminal flow should be:

1. Start app
2. Load or acquire Pirate session
3. Fetch onboarding status
4. If Reddit verification not complete:
   - ask for Reddit username
   - call verification endpoint
   - show code + placement hint
   - let user re-check until verified
5. If Reddit import not complete:
   - trigger import
   - poll onboarding status or fetch latest summary
6. Show import summary:
   - karma
   - top subreddits
   - inferred interests
   - suggested communities
7. Let user continue directly into community discovery or their suggested community

That keeps the app aligned with the current backend instead of inventing a second onboarding system.

## Screen Design For The First Slice

### `ScreenAuth`

Prefer device auth as the long-term terminal login path.

Short-term options:

- if a Pirate access token can be supplied via env/config, support that first
- if device-session endpoints are added, move auth to:
  - show short user code
  - show browser URL
  - poll until authorized

### `ScreenOnboarding`

This should be a stable card-like flow with a fixed title and a simple step row above it:

- `Sign in`
- `Verify Reddit`
- `Import Reddit`
- `Pick communities`

Inside the card, keep copy short and action-led.

Suggested sub-states:

- `username_entry`
- `verification_pending`
- `verification_failed`
- `import_running`
- `import_complete`

### `ScreenCommunityPicker`

This should merge:

- backend suggestions from onboarding summary
- discoverable communities from `/communities/discover`

The terminal interaction should be:

- arrow or `j`/`k` to move
- `enter` to open community
- `/` to filter locally later

### Defer Until After Onboarding

- multi-column shell chrome
- inbox / notifications
- rich composer
- moderation flows
- advanced feed switching

## Commands And Messages

Model network work as Bubble Tea commands, not inline calls:

- `loadOnboardingStatusCmd()`
- `startRedditVerificationCmd(username string)`
- `checkRedditVerificationCmd(username string)`
- `startRedditImportCmd(username string)`
- `loadRedditImportSummaryCmd()`
- `loadDiscoverCommunitiesCmd()`
- `loadCommunityPostsCmd(communityID string)`
- `loadPostCmd(postID string)`
- `voteCmd(postID string, value int)`

Each should return a typed message:

- `onboardingStatusLoadedMsg`
- `redditVerificationLoadedMsg`
- `redditImportQueuedMsg`
- `redditImportSummaryLoadedMsg`
- `communitiesLoadedMsg`
- `communityPostsLoadedMsg`
- `postLoadedMsg`
- `voteSavedMsg`
- `apiErrorMsg`

This is the cleanest transfer from the Bubble Tea command tutorial and `cliamp`'s `commands.go`.

## Why Onboarding Should Come Before The Full Feed

Because Pirate already has a meaningful onboarding shape, while the rest of the terminal shell is still mixed:

- communities and posts are real
- voting is real
- device auth is only partially surfaced
- notifications are placeholder-only

So the right first milestone is:

- a real signed-in onboarding loop that ends in a real community selection

not:

- a fake terminal clone of the future full product shell

## Recommended Milestones

### Milestone 1

Scaffold the app and make this work:

- launch TUI
- load session from env or config
- fetch onboarding status
- render auth/onboarding states

### Milestone 2

Add Reddit onboarding:

- username input
- verification start/check flow
- import trigger
- import summary screen

### Milestone 3

Add the first post-onboarding destination:

- discover communities list
- open one community
- list posts
- open one post
- vote up/down

## Implementation Notes

- Keep the style dark and restrained, with orange as the accent.
- Avoid decorative badges and redundant helper copy.
- Keep titles static and progress above the card.
- Optimize for keyboard-first scanning, not mouse parity.
- Write tests around update transitions before adding more screens.

## Immediate Next Step

Build Milestone 1 as a minimal Go app using:

- `charm.land/bubbletea/v2`
- `charm.land/lipgloss/v2`
- `charm.land/bubbles/v2`

Then wire onboarding before any inbox or notification work.
