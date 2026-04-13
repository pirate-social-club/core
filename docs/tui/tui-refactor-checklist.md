# TUI Refactor Implementation Checklist

Status: active

Scope: reconcile pirate-tui/internal/app/* with the Route+Focus+SessionPhase model defined in [tui-auth-home.md](./tui-auth-home.md).

Audience: implementer working file-by-file through the current codebase.

Dependencies: this refactor does not depend on glamour. glamour is phase 9 only.

Build constraint: current `go test ./internal/app` is blocked by a fabric-go compile error in an unrelated package. Phases 1-3 are primarily `internal/app` refactor. Phase 4 is a new capability phase and intentionally crosses into session storage plus `internal/api/client.go`. Verify each phase with the narrowest possible package build once the upstream blocker is resolved.

---

## Phase 1: Replace Screen with Route + Focus + SessionPhase

Goal: change the navigation model with no intentional copy or keybinding changes yet. Phase 1 should be an internal-state migration first: preserve the existing auth entry points and approximate current account/onboarding behavior, then move visible shell changes to phase 3.

### model.go

**Edit 1 — Replace Screen enum**

Current (lines 16-24):
```go
type Screen int

const (
	ScreenHome Screen = iota
	ScreenAuth
	ScreenLoading
	ScreenOnboarding
	ScreenReady
)
```

Replace with:
```go
type Route int

const (
	RouteHome Route = iota
	RouteSearch
	RouteAccount
)

type Focus int

const (
	FocusNone Focus = iota
	FocusConnect
	FocusOnboarding
	FocusCommunity
	FocusPost
	FocusSpaces
)

type SessionPhase int

const (
	SessionSignedOut SessionPhase = iota
	SessionAuthInProgress
	SessionSignedIn
)
```

**Edit 2 — Add Phase to SessionState**

Current (lines 26-34):
```go
type SessionState struct {
	BaseURL     string
	AccessToken string
	Source      string
}

func (s SessionState) Ready() bool {
	return s.AccessToken != ""
}
```

Replace with:
```go
type SessionState struct {
	BaseURL     string
	AccessToken string
	Source      string
	Handle      string
	Phase       SessionPhase
}

func (s SessionState) Ready() bool {
	return s.Phase == SessionSignedIn
}
```

Note: Ready() now checks Phase instead of AccessToken != "". This allows auth_in_progress to have a transient token without being "ready".

Phase 1 invariant: every runtime path that assigns a usable access token must also set `SessionState.Phase = SessionSignedIn`. The local-signup completion path is updated later in this phase; future auth paths must follow the same rule.

**Edit 3 — Replace screen field in Model**

Current (line 80):
```go
screen Screen
```

Replace with:
```go
route  Route
focus  Focus
dev    DevState
```

**Edit 4 — Add DevState struct**

Add after SessionState:
```go
type DevState struct {
	Enabled bool
}
```

DevState.Enabled is set from PIRATE_DEV=1 or --dev flag at construction time.

**Edit 5 — Update New() defaults**

Current (line 115):
```go
screen: ScreenHome,
```

Replace with:
```go
route: RouteHome,
focus: FocusNone,
dev: DevState{Enabled: os.Getenv("PIRATE_DEV") == "1"},
```

Also update session construction:
```go
session: sessionWithPhase(session),
```

Add helper:
```go
func sessionWithPhase(s SessionState) SessionState {
	if s.AccessToken != "" {
		s.Phase = SessionSignedIn
	}
	return s
}
```

This keeps the existing behavior: env token = signed in. Phase 4 will add validation.

**Edit 6 — Remove HomeState.FeedBusy/DiscoverBusy from New()**

Current (lines 121-124):
```go
home: HomeState{
	FeedBusy:     true,
	DiscoverBusy: true,
},
```

Keep these flags. They will be used differently in phase 2. For now leave them as-is so the app still tries to load.

**Import changes**

Add `"os"` to imports (for dev mode check).

### view.go

**Edit 7 — Replace screen switch in renderBody**

Current (lines 58-71):
```go
func renderBody(m Model) string {
	switch m.screen {
	case ScreenHome:
		return renderHome(m)
	case ScreenAuth:
		return renderAuth(m)
	case ScreenLoading:
		return renderLoading(m)
	case ScreenReady:
		return renderReady(m)
	default:
		return renderOnboarding(m)
	}
}
```

Replace with:
```go
func renderBody(m Model) string {
	if m.focus != FocusNone {
		return renderFocus(m)
	}
	switch m.route {
	case RouteHome:
		return renderHome(m)
	case RouteSearch:
		return renderSearch(m)
	case RouteAccount:
		return renderAccount(m)
	default:
		return renderHome(m)
	}
}

func renderFocus(m Model) string {
	switch m.focus {
	case FocusConnect:
		return renderAuth(m)
	case FocusOnboarding:
		return renderOnboarding(m)
	case FocusCommunity:
		return renderCommunity(m)
	case FocusPost:
		return renderPost(m)
	case FocusSpaces:
		return renderSpaces(m)
	default:
		return renderHome(m)
	}
}
```

This preserves current rendering behavior: FocusConnect still calls the existing renderAuth, FocusOnboarding still calls the existing renderOnboarding. The renderReady function is temporarily kept alive inside renderFocus but will be removed in phase 6.

For now, add stubs:
```go
func renderSearch(m Model) string     { return okStyle.Render("Search") + "\n\n" + mutedStyle.Render("Coming soon.") }
func renderCommunity(m Model) string  { return okStyle.Render("Community") + "\n\n" + mutedStyle.Render("Coming soon.") }
func renderPost(m Model) string       { return okStyle.Render("Post") + "\n\n" + mutedStyle.Render("Coming soon.") }
func renderSpaces(m Model) string     { return renderSpacesLookup(m) }
func renderAccount(m Model) string {
	if !m.session.Ready() {
		return renderAuth(m)
	}
	if m.onboarding.Status != nil && isOnboardingComplete(*m.onboarding.Status) {
		return renderReady(m)
	}
	if m.onboarding.ImportSummary != nil || m.onboarding.LocalSignup != nil {
		return renderReady(m)
	}
	return renderOnboarding(m)
}
```

renderAccount keeps the old account/onboarding split alive temporarily. This lets phase 1 migrate state shape without forcing the new signed-out `Connect` shell contract early. It will change in phase 3.

**Edit 8 — Update renderFooter**

Current (line 224):
```go
if m.screen != ScreenHome {
```

Replace with:
```go
if m.route != RouteHome || m.focus != FocusNone {
```

**Edit 9 — Keep renderHomeActions labels unchanged in phase 1**

Current (lines 353-355):
```go
if m.session.Ready() {
	lines = append(lines, "o account")
} else {
	lines = append(lines, "o account", "n create local account")
}
```

Replace with:
```go
if m.session.Ready() {
	lines = append(lines, "o account")
} else {
	lines = append(lines, "o account", "n create local account")
}
```

Do not introduce `3 connect`, route-number labels, or dev-only copy in phase 1. Those are phase 3 changes.

### update.go

**Edit 10 — Replace screen switch in updateKey**

Current (lines 235-245):
```go
switch m.screen {
case ScreenHome:
	return m.updateHomeKey(msg)
case ScreenAuth:
	return m.updateAuthKey(msg)
case ScreenOnboarding:
	return m.updateOnboardingKey(msg)
case ScreenReady:
	return m.updateReadyKey(msg)
}
```

Replace with:
```go
if m.focus != FocusNone {
	return m.updateFocusKey(msg)
}
switch m.route {
case RouteHome:
	return m.updateHomeKey(msg)
case RouteSearch:
	return m.updateSearchKey(msg)
case RouteAccount:
	return m.updateAccountKey(msg)
}
return m, nil
```

**Edit 11 — Update updateHomeKey without changing visible keybindings**

Current (lines 248-267):
```go
func (m Model) updateHomeKey(msg tea.KeyPressMsg) (tea.Model, tea.Cmd) {
	switch msg.String() {
	case "o":
		m.screen = m.accountScreen()
		...
	case "n":
		if m.session.Ready() {
			return m, nil
		}
		m.screen = ScreenLoading
		...
	}
	return m, nil
}
```

Replace with:
```go
func (m Model) updateHomeKey(msg tea.KeyPressMsg) (tea.Model, tea.Cmd) {
	switch msg.String() {
	case "o":
		m.route = RouteAccount
		return m, nil
	case "2":
		m.route = RouteSearch
		return m, nil
	case "n":
		m.onboarding.Busy = true
		m.onboarding.BusyLabel = "Creating local account"
		m.status.Message = "Creating local account"
		m.status.Err = nil
		return m, localSignupCmd()
	}
	return m, nil
}
```

Key changes:
- keep the existing `o` / `n` bindings for now
- route/account plumbing changes internally, but the visible home actions stay stable
- dev gating moves to phase 3 with the auth-copy rewrite
- `n` remains intentionally available here to preserve current behavior during the internal-only migration

**Edit 12 — Add updateFocusKey**

```go
func (m Model) updateFocusKey(msg tea.KeyPressMsg) (tea.Model, tea.Cmd) {
	switch msg.String() {
	case "esc", "h":
		prevFocus := m.focus
		m.focus = FocusNone
		if prevFocus == FocusOnboarding {
			m.onboarding.UsernameInput.Blur()
		}
		return m, nil
	}
	switch m.focus {
	case FocusConnect:
		return m.updateConnectKey(msg)
	case FocusOnboarding:
		return m.updateOnboardingKey(msg)
	case FocusSpaces:
		return m.updateSpacesKey(msg)
	default:
		return m, nil
	}
}
```

**Edit 13 — Rename updateAuthKey to updateConnectKey without changing `n` behavior yet**

Current (lines 270-282):
```go
func (m Model) updateAuthKey(msg tea.KeyPressMsg) (tea.Model, tea.Cmd) {
	switch msg.String() {
	case "h":
		m.screen = ScreenHome
		return m, nil
	case "n":
		m.screen = ScreenLoading
		...
	}
	return m, nil
}
```

Replace with:
```go
func (m Model) updateConnectKey(msg tea.KeyPressMsg) (tea.Model, tea.Cmd) {
	switch msg.String() {
	case "n":
		m.onboarding.Busy = true
		m.onboarding.BusyLabel = "Creating local account"
		m.status.Message = "Creating local account"
		m.status.Err = nil
		return m, localSignupCmd()
	}
	return m, nil
}
```

"h" and "esc" are handled by updateFocusKey now. Do not add the dev-only guard yet; that user-facing change belongs in phase 3 alongside the Connect copy rewrite.

**Edit 14 — Update updateOnboardingKey**

Current (line 289):
```go
if msg.String() == "h" {
	m.screen = ScreenHome
	return m, nil
}
```

Replace with:
```go
if msg.String() == "h" || msg.String() == "esc" {
	m.focus = FocusNone
	m.onboarding.UsernameInput.Blur()
	return m, nil
}
```

**Edit 15 — Add updateSearchKey, updateAccountKey, updateSpacesKey stubs**

```go
func (m Model) updateSearchKey(msg tea.KeyPressMsg) (tea.Model, tea.Cmd) {
	return m, nil
}

func (m Model) updateAccountKey(msg tea.KeyPressMsg) (tea.Model, tea.Cmd) {
	return m, nil
}

func (m Model) updateSpacesKey(msg tea.KeyPressMsg) (tea.Model, tea.Cmd) {
	if m.spacesLookup.Busy {
		return m, nil
	}
	switch msg.String() {
	case "enter":
		handle := strings.TrimSpace(m.spacesLookup.QueryInput.Value())
		if handle == "" {
			m.status.Message = "Enter a Spaces handle first"
			return m, nil
		}
		m.spacesLookup.Busy = true
		m.spacesLookup.BusyLabel = "Resolving Spaces handle"
		m.status.Message = ""
		m.status.Err = nil
		return m, resolveSpacesHandleCmd(m, handle)
	default:
		var cmd tea.Cmd
		m.spacesLookup.QueryInput, cmd = m.spacesLookup.QueryInput.Update(msg)
		return m, cmd
	}
}
```

The updateSpacesKey body is extracted from the old updateReadyKey (lines 348-389).

**Edit 16 — Update ctrl+r handler**

Current (lines 221-232):
```go
case "ctrl+r":
	m.status.Message = ""
	m.status.Err = nil
	m.home.FeedBusy = true
	m.home.DiscoverBusy = true
	cmds := []tea.Cmd{refreshHomeCmd(m)}
	if m.session.Ready() {
		m.onboarding.Busy = true
		m.onboarding.BusyLabel = "Refreshing onboarding status"
		cmds = append(cmds, loadOnboardingStatusCmd(m))
	}
	return m, tea.Batch(cmds...)
```

Keep as-is for now. Phase 2 will gate the feed refresh.

**Edit 17 — Update message handlers that reference screen and preserve the Phase invariant**

In redditImportSummaryLoadedMsg handler (lines 105-115):
```go
if m.screen != ScreenHome {
	m.status.Message = "Reddit import summary loaded"
}
m.onboarding.UsernameInput.SetValue(msg.summary.RedditUsername)
m.onboarding.UsernameInput.Blur()
if m.screen != ScreenReady {
	m.screen = ScreenReady
}
if m.screen == ScreenReady && m.spacesService != nil && m.spacesService.Enabled() {
	m.spacesLookup.QueryInput.Focus()
}
```

Replace with:
```go
if m.route != RouteHome || m.focus != FocusNone {
	m.status.Message = "Reddit import summary loaded"
}
m.onboarding.UsernameInput.SetValue(msg.summary.RedditUsername)
m.onboarding.UsernameInput.Blur()
m.route = RouteAccount
m.focus = FocusNone
```

Key change: no more `ScreenReady`, but phase 1 still routes the user into the temporary account container so the old ready/onboarding rendering can survive until phase 6.

In localSignupCompletedMsg handler (lines 118-136):
```go
if isOnboardingComplete(msg.result.Onboarding) {
	m.screen = ScreenReady
	...
	return m, nil
}
m.screen = ScreenOnboarding
```

Replace with:
```go
m.session.AccessToken = msg.result.AccessToken
m.session.Source = "local-dev-signup"
m.session.Phase = SessionSignedIn
m.onboarding.LocalSignup = &msg.result
m.onboarding.Status = &msg.result.Onboarding
m.onboarding.LastLoadedAt = time.Now()
m.onboarding.Busy = false
m.onboarding.BusyLabel = ""
m.status.Err = nil
m.status.Message = "Local account created"
if isOnboardingComplete(msg.result.Onboarding) {
	m.route = RouteAccount
	m.focus = FocusNone
	return m, nil
}
m.route = RouteAccount
m.focus = FocusNone
return m, loadOnboardingStatusCmd(m)
```

In onboardingStatusLoadedMsg handler (line 61):
```go
if m.screen != ScreenHome {
	m.status.Message = "Onboarding status loaded"
}
```

Replace with:
```go
if m.route != RouteHome || m.focus != FocusNone {
	m.status.Message = "Onboarding status loaded"
}
```

**Edit 18 — Delete accountScreen()**

Current (lines 428-439):
```go
func (m Model) accountScreen() Screen {
	if !m.session.Ready() {
		return ScreenAuth
	}
	if m.onboarding.Status != nil && isOnboardingComplete(*m.onboarding.Status) {
		return ScreenReady
	}
	if m.onboarding.ImportSummary != nil || m.onboarding.LocalSignup != nil {
		return ScreenReady
	}
	return ScreenOnboarding
}
```

Delete entirely. Route/focus transitions are now explicit in the key handlers and `RouteAccount` temporarily carries the old onboarding/ready presentation.

### init.go

**Edit 19 — No structural changes yet in phase 1**

Init stays as-is. The unconditional feed fetch will be addressed in phase 2.

### messages.go

**Edit 20 — No changes in phase 1**

### commands.go

**Edit 21 — No changes in phase 1**

### session.go

**Edit 22 — No changes in phase 1**

### local_signup.go

**Edit 23 — No changes in phase 1**

### styles.go

**Edit 24 — No changes in phase 1**

### cmd/pirate-tui/main.go

**Edit 25 — Pass dev mode to model**

No changes needed yet. Dev mode is detected inside New() from env. If we later want --dev flag support, add it here.

### update_test.go

**Edit 26 — Remove TestAccountScreen**

Current (lines 59-75):
```go
func TestAccountScreen(t *testing.T) {
	...
	guest.accountScreen() ...
	signedIn.accountScreen() ...
}
```

Delete entirely. accountScreen() is gone. Replace with:

```go
func TestGuestHomeShowsConnect(t *testing.T) {
	t.Parallel()
	m := New(nil, nil, nil, SessionState{}, nil)
	if m.route != RouteHome {
		t.Fatalf("expected RouteHome, got %v", m.route)
	}
	if m.focus != FocusNone {
		t.Fatalf("expected FocusNone, got %v", m.focus)
	}
	if m.session.Phase != SessionSignedOut {
		t.Fatalf("expected SessionSignedOut, got %v", m.session.Phase)
	}
}

func TestSessionWithTokenIsSignedIn(t *testing.T) {
	t.Parallel()
	m := New(nil, nil, nil, SessionState{AccessToken: "token"}, nil)
	if m.session.Phase != SessionSignedIn {
		t.Fatalf("expected SessionSignedIn, got %v", m.session.Phase)
	}
}

func TestDevSignupRequiresDevMode(t *testing.T) {
	t.Parallel()
	m := New(nil, nil, nil, SessionState{}, nil)
	if m.dev.Enabled {
		t.Fatal("dev mode should be off by default")
	}
}
```

### view_test.go

**Edit 27 — Update TestRenderRootShowsHomeScreenWithoutWindowSize**

Current test checks for "Browse first. Account optional." and "Home". This should still pass since renderHome is unchanged. No edit needed yet.

---

## Phase 2: Gate Signed-Out Fetches

Goal: signed-out users should not trigger feed or discover API calls.

### init.go

**Edit 28 — Gate feed/discover on session**

Current (lines 5-21):
```go
func (m Model) Init() tea.Cmd {
	cmds := []tea.Cmd{
		m.spinner.Tick,
		func() tea.Msg { return tea.RequestWindowSize() },
		loadHomeFeedCmd(m),
		loadDiscoverCommunitiesCmd(m),
	}
	if m.session.Ready() {
		cmds = append(cmds, loadOnboardingStatusCmd(m))
	}
	...
}
```

Replace with:
```go
func (m Model) Init() tea.Cmd {
	cmds := []tea.Cmd{
		m.spinner.Tick,
		func() tea.Msg { return tea.RequestWindowSize() },
	}

	if m.session.Ready() {
		cmds = append(cmds,
			loadHomeFeedCmd(m),
			loadDiscoverCommunitiesCmd(m),
			loadOnboardingStatusCmd(m),
		)
	}

	if m.hnsSync != nil {
		cmds = append(cmds, pollHNSSyncCmd(m))
	}

	return tea.Batch(cmds...)
}
```

**Edit 29 — Gate ctrl+r feed refresh on session**

In updateKey ctrl+r handler, gate the feed refresh:
```go
case "ctrl+r":
	m.status.Message = ""
	m.status.Err = nil
	cmds := []tea.Cmd{}
	if m.session.Ready() {
		m.home.FeedBusy = true
		m.home.DiscoverBusy = true
		cmds = append(cmds, refreshHomeCmd(m))
		m.onboarding.Busy = true
		m.onboarding.BusyLabel = "Refreshing onboarding status"
		cmds = append(cmds, loadOnboardingStatusCmd(m))
	}
	return m, tea.Batch(cmds...)
```

**Edit 30 — Update HomeState defaults in New()**

Current (lines 121-124):
```go
home: HomeState{
	FeedBusy:     true,
	DiscoverBusy: true,
},
```

Replace with:
```go
home: HomeState{
	FeedBusy:     m.session.Ready(),
	DiscoverBusy: m.session.Ready(),
},
```

Wait — this references the session field which is set on the same struct. Instead, check after construction:

Move the busy-flag logic out of the literal:
```go
model := Model{...}
if model.session.Ready() {
	model.home.FeedBusy = true
	model.home.DiscoverBusy = true
}
return model
```

---

## Phase 3: Signed-Out Home + Connect

Goal: signed-out home shows a Connect entry point instead of live feed. This phase absorbs the user-facing key-label and auth-copy changes that were intentionally deferred from phase 1.

### view.go

**Edit 31 — Update renderHome for signed-out**

Current (lines 108-124):
```go
func renderHome(m Model) string {
	left := renderHomeFeed(m)
	right := renderDiscoverCommunities(m)
	columns := lipgloss.JoinHorizontal(...)
	...
}
```

Replace with:
```go
func renderHome(m Model) string {
	if !m.session.Ready() {
		return renderSignedOutHome(m)
	}
	left := renderHomeFeed(m)
	right := renderDiscoverCommunities(m)
	columns := lipgloss.JoinHorizontal(
		lipgloss.Top,
		sectionStyle.Width(38).Render(left),
		sectionStyle.Width(28).Render(right),
	)
	lines := []string{
		columns,
		"",
		renderHomeActions(m),
	}
	return strings.Join(lines, "\n")
}

func renderSignedOutHome(m Model) string {
	lines := []string{
		okStyle.Render("Home"),
		"",
		"Connect your account to browse and post.",
		"",
		mutedStyle.Render("3 connect"),
	}
	return strings.Join(lines, "\n")
}
```

**Edit 32 — Replace renderAuth with Connect card**

Current (lines 73-91):
```go
func renderAuth(m Model) string {
	lines := []string{
		okStyle.Render("Account"),
		"",
		"Press n to create a fresh local dev account.",
		"Press h to go back to browse.",
		"",
		accentStyle.Render("Optional"),
		"  PIRATE_API_BASE_URL   default: http://127.0.0.1:8787",
		...
	}
}
```

Replace with:
```go
func renderAuth(m Model) string {
	lines := []string{
		okStyle.Render("Connect"),
		"",
		"Connect your identity to start using Pirate.",
		"",
		mutedStyle.Render("esc back"),
	}
	if m.dev.Enabled {
		lines = append(lines,
			"",
			mutedStyle.Render("Dev: n local account"),
		)
	}
	return strings.Join(lines, "\n")
}
```

**Edit 33 — Update renderAccount (currently delegated to renderAuth)**

renderAccount currently calls renderAuth. Split it:

```go
func renderAccount(m Model) string {
	if !m.session.Ready() {
		return renderAuth(m)
	}
	lines := []string{
		okStyle.Render("Account"),
		"",
		renderStatusLine("Handle", m.session.Handle),
		renderStatusLine("Source", m.session.Source),
	}
	if m.onboarding.Status != nil {
		lines = append(lines,
			"",
			renderStatusLine("Onboarding", onboardingLabel(*m.onboarding.Status)),
		)
	}
	if m.onboarding.ImportSummary != nil {
		lines = append(lines, "", renderImportSummary(*m.onboarding.ImportSummary))
	}
	if m.dev.Enabled && m.spacesService != nil && m.spacesService.Enabled() {
		lines = append(lines, "", renderSpacesLookup(m))
	}
	return strings.Join(lines, "\n")
}

func onboardingLabel(s api.OnboardingStatus) string {
	if s.CommunityCreationReady {
		return "complete"
	}
	pending := 0
	if s.RedditVerificationStatus != "verified" {
		pending++
	}
	if s.RedditImportStatus != "succeeded" {
		pending++
	}
	if len(s.MissingRequirements) > 0 {
		pending += len(s.MissingRequirements)
	}
	if pending == 0 {
		return "complete"
	}
	return fmt.Sprintf("%d items remaining", pending)
}
```

**Edit 34 — Update renderHeader**

Current (line 38):
```go
mutedStyle.Render("Browse first. Account optional."),
```

Replace with:
```go
mutedStyle.Render(routeLabel(m.route)),
```

Add helper:
```go
func routeLabel(r Route) string {
	switch r {
	case RouteHome:
		return "Home"
	case RouteSearch:
		return "Search"
	case RouteAccount:
		return "Account"
	default:
		return ""
	}
}
```

**Edit 35 — Update renderHeaderStatus**

Current (lines 252-263): Keep as-is, but ensure it uses Phase terminology. The "guest" / "signed in" labels are fine.

---

## Phase 4: Session Persistence and Validation

Goal: token stored in file, restored on launch, validated via authenticated read, cleared if invalid.

Scope note: this is not a pure `internal/app` refactor. It adds new session-storage behavior and requires API-client support for authenticated validation.

### session.go

**Edit 36 — Add file-backed session store**

Add to session.go:
```go
import (
	"encoding/json"
	"os"
	"path/filepath"
)

type StoredSession struct {
	AccessToken string `json:"access_token"`
	Handle      string `json:"handle"`
	Source      string `json:"source"`
}

func sessionFilePath() (string, error) {
	configDir, err := os.UserConfigDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(configDir, "pirate", "session.json"), nil
}

func LoadStoredSession() (StoredSession, error) {
	var s StoredSession
	path, err := sessionFilePath()
	if err != nil {
		return s, err
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return s, err
	}
	if err := json.Unmarshal(data, &s); err != nil {
		return s, err
	}
	return s, nil
}

func SaveStoredSession(token, handle, source string) error {
	path, err := sessionFilePath()
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		return err
	}
	s := StoredSession{AccessToken: token, Handle: handle, Source: source}
	data, err := json.Marshal(s)
	if err != nil {
		return err
	}
	return os.WriteFile(path, data, 0600)
}

func ClearStoredSession() error {
	path, err := sessionFilePath()
	if err != nil {
		return err
	}
	return os.Remove(path)
}
```

**Edit 37 — Update LoadSessionFromEnv to consider stored session**

Current:
```go
func LoadSessionFromEnv() SessionState {
	baseURL := strings.TrimSpace(os.Getenv("PIRATE_API_BASE_URL"))
	if baseURL == "" {
		baseURL = "http://127.0.0.1:8787"
	}
	return SessionState{
		BaseURL:     baseURL,
		AccessToken: strings.TrimSpace(os.Getenv("PIRATE_ACCESS_TOKEN")),
		Source:      "env",
	}
}
```

Replace with:
```go
func LoadSessionFromEnv() SessionState {
	baseURL := strings.TrimSpace(os.Getenv("PIRATE_API_BASE_URL"))
	if baseURL == "" {
		baseURL = "http://127.0.0.1:8787"
	}

	envToken := strings.TrimSpace(os.Getenv("PIRATE_ACCESS_TOKEN"))
	if envToken != "" {
		return SessionState{
			BaseURL:     baseURL,
			AccessToken: envToken,
			Source:      "env",
			Phase:       SessionSignedIn,
		}
	}

	stored, err := LoadStoredSession()
	if err == nil && stored.AccessToken != "" {
		return SessionState{
			BaseURL:     baseURL,
			AccessToken: stored.AccessToken,
			Handle:      stored.Handle,
			Source:      stored.Source,
			Phase:       SessionSignedIn,
		}
	}

	return SessionState{
		BaseURL: baseURL,
		Source:  "none",
		Phase:   SessionSignedOut,
	}
}
```

Priority: env token > stored token > no token.

### commands.go

**Edit 38 — Add session validation command with explicit unauthorized vs transient error**

```go
func validateSessionCmd(m Model) tea.Cmd {
	return func() tea.Msg {
		if m.apiClient == nil {
			return sessionValidationErrorMsg{err: fmt.Errorf("session validation unavailable")}
		}
		valid, handle, unauthorized, err := m.apiClient.ValidateSession(context.Background(), m.session.AccessToken)
		if unauthorized {
			return sessionInvalidMsg{}
		}
		if err != nil {
			return sessionValidationErrorMsg{err: err}
		}
		if !valid {
			return sessionValidationErrorMsg{err: fmt.Errorf("session validation returned no result")}
		}
		return sessionValidMsg{handle: handle}
	}
}
```

### messages.go

**Edit 39 — Add session messages**

```go
type sessionValidMsg struct {
	handle string
}

type sessionInvalidMsg struct{}

type sessionValidationErrorMsg struct {
	err error
}
```

### api/client.go

**Edit 40 — Add ValidateSession method**

```go
func (c *Client) ValidateSession(ctx context.Context, accessToken string) (bool, string, bool, error) {
	req, err := c.newRequest(ctx, http.MethodGet, "/users/me", accessToken, nil)
	if err != nil {
		return false, "", false, err
	}
	resp, err := c.httpClient.Do(req)
	if err != nil {
		return false, "", false, err
	}
	defer resp.Body.Close()
	if resp.StatusCode == http.StatusUnauthorized {
		return false, "", true, nil
	}
	if resp.StatusCode != http.StatusOK {
		return false, "", false, fmt.Errorf("session validation returned %s", resp.Status)
	}
	var body struct {
		Handle string `json:"handle"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		return true, "", false, nil
	}
	return true, body.Handle, false, nil
}
```

Only explicit `401 Unauthorized` should be treated as proof that the token is invalid. Network errors and non-401 responses are transient validation failures, not grounds to clear the stored session.

### update.go

**Edit 41 — Handle session validation messages**

```go
case sessionValidMsg:
	m.session.Phase = SessionSignedIn
	m.session.Handle = msg.handle
	return m, tea.Batch(
		loadHomeFeedCmd(m),
		loadDiscoverCommunitiesCmd(m),
		loadOnboardingStatusCmd(m),
	)

case sessionInvalidMsg:
	m.session.Phase = SessionSignedOut
	m.session.AccessToken = ""
	m.session.Handle = ""
	_ = ClearStoredSession()
	return m, nil

case sessionValidationErrorMsg:
	m.session.Phase = SessionSignedIn
	m.status.Err = msg.err
	m.status.Message = ""
	return m, tea.Batch(
		loadHomeFeedCmd(m),
		loadDiscoverCommunitiesCmd(m),
		loadOnboardingStatusCmd(m),
	)
```

### init.go

**Edit 42 — Add session validation for restored sessions**

```go
func (m Model) Init() tea.Cmd {
	cmds := []tea.Cmd{
		m.spinner.Tick,
		func() tea.Msg { return tea.RequestWindowSize() },
	}

	if m.session.Ready() {
		cmds = append(cmds, validateSessionCmd(m))
	}

	if m.hnsSync != nil {
		cmds = append(cmds, pollHNSSyncCmd(m))
	}

	return tea.Batch(cmds...)
}
```

Note: feed/discover/onboarding are no longer in Init(). They fire after validation returns. On explicit unauthorized, the session is cleared. On transient validation failure, keep the session and continue loading signed-in content while surfacing the validation error in status chrome.

### local_signup.go / update.go

**Edit 43 — Persist token after local signup**

In localSignupCompletedMsg handler, after setting the session:
```go
if m.session.AccessToken != "" {
	_ = SaveStoredSession(m.session.AccessToken, m.session.Handle, m.session.Source)
}
```

---

## Phase 5: Onboarding as Nudge + Focus Card

Goal: onboarding stops being a full-screen flow. It becomes a nudge in the signed-in home rail and a focused card when activated.

### view.go

**Edit 44 — Add onboarding nudge to signed-in home**

In renderHome (the signed-in branch), add a nudge check:

```go
func renderHome(m Model) string {
	if !m.session.Ready() {
		return renderSignedOutHome(m)
	}

	left := renderHomeFeed(m)
	right := renderOnboardingRail(m)
	if right == "" {
		right = renderDiscoverCommunities(m)
	}

	columns := lipgloss.JoinHorizontal(
		lipgloss.Top,
		sectionStyle.Width(38).Render(left),
		sectionStyle.Width(28).Render(right),
	)
	lines := []string{
		columns,
		"",
		renderHomeActions(m),
	}
	return strings.Join(lines, "\n")
}

func renderOnboardingRail(m Model) string {
	if m.onboarding.Status == nil || isOnboardingComplete(*m.onboarding.Status) {
		return ""
	}
	if m.onboarding.Busy {
		return okStyle.Render("Account") + "\n\n" + m.spinner.View() + " Loading status"
	}
	lines := []string{
		okStyle.Render("Account"),
		"",
		onboardingLabel(*m.onboarding.Status),
		"",
		mutedStyle.Render("o continue"),
		mutedStyle.Render("x dismiss"),
	}
	return strings.Join(lines, "\n")
}
```

**Edit 45 — Update renderHomeActions for nudge**

```go
func renderHomeActions(m Model) string {
	parts := []string{}
	if m.onboarding.Status != nil && !isOnboardingComplete(*m.onboarding.Status) && !m.onboarding.Dismissed {
		parts = append(parts, "o onboarding")
	}
	parts = append(parts, "3 account", "2 search")
	if m.dev.Enabled {
		parts = append(parts, "n dev: local account")
	}
	if !m.home.LastLoadedAt.IsZero() {
		parts = append(parts, "updated "+m.home.LastLoadedAt.Format("15:04:05"))
	}
	return mutedStyle.Render(strings.Join(parts, "   "))
}
```

**Edit 46 — Update updateHomeKey for nudge actions**

```go
case "o":
	if m.onboarding.Status != nil && !isOnboardingComplete(*m.onboarding.Status) && !m.onboarding.Dismissed {
		m.focus = FocusOnboarding
		m.onboarding.UsernameInput.Focus()
		return m, nil
	}
	if m.session.Ready() {
		m.route = RouteAccount
	} else {
		m.focus = FocusConnect
	}
	return m, nil
case "x":
	if m.onboarding.Status != nil && !isOnboardingComplete(*m.onboarding.Status) {
		m.onboarding.Dismissed = true
	}
	return m, nil
```

**Edit 47 — Add Dismissed to OnboardingState**

In model.go:
```go
type OnboardingState struct {
	Status        *api.OnboardingStatus
	LastLoadedAt  time.Time
	UsernameInput textinput.Model
	Verification  *api.RedditVerification
	ImportSummary *api.RedditImportSummary
	LocalSignup   *LocalSignupResult
	Busy          bool
	BusyLabel     string
	Dismissed     bool
}
```

**Edit 48 — Update renderOnboarding for focus card**

Replace current renderOnboarding with a focused card version:

```go
func renderOnboarding(m Model) string {
	steps := []string{"Connect", "Verify Reddit", "Import Reddit", "Pick communities"}
	currentStep := onboardingStepIndex(m.onboarding.Status)

	lines := []string{
		okStyle.Render("Set up your account"),
		"",
		renderStepRow(steps, currentStep),
		"",
	}
	if m.onboarding.Status != nil {
		lines = append(lines, renderStatusLine("Reddit verification", m.onboarding.Status.RedditVerificationStatus))
		lines = append(lines, renderStatusLine("Reddit import", m.onboarding.Status.RedditImportStatus))
		lines = append(lines, renderStatusLine("Community creation", booleanStatus(m.onboarding.Status.CommunityCreationReady)))
		if len(m.onboarding.Status.MissingRequirements) > 0 {
			lines = append(lines, "", "Missing:")
			for _, item := range m.onboarding.Status.MissingRequirements {
				lines = append(lines, "  - "+item)
			}
		}
	}
	lines = append(lines, "", renderOnboardingActions(m))
	if m.onboarding.Verification != nil {
		lines = append(lines, "", renderVerificationDetails(*m.onboarding.Verification))
	}
	if m.onboarding.ImportSummary != nil {
		lines = append(lines, "", renderImportSummary(*m.onboarding.ImportSummary))
	}
	lines = append(lines, "", mutedStyle.Render("esc back"))
	return strings.Join(lines, "\n")
}

func renderStepRow(steps []string, current int) string {
	parts := make([]string, len(steps))
	for i, step := range steps {
		if i < current {
			parts[i] = okStyle.Render(step)
		} else if i == current {
			parts[i] = accentStyle.Render(step)
		} else {
			parts[i] = mutedStyle.Render(step)
		}
	}
	return strings.Join(parts, " > ")
}

func onboardingStepIndex(status *api.OnboardingStatus) int {
	if status == nil {
		return 0
	}
	if status.RedditVerificationStatus != "verified" {
		return 1
	}
	if status.RedditImportStatus != "succeeded" {
		return 2
	}
	if !status.CommunityCreationReady {
		return 3
	}
	return 4
}
```

Note: renderStepRow is a text-only progress indicator. Not a Badge or Pill component.

---

## Phase 6: Delete Ready Path

Goal: remove all references to ScreenReady and the separate ready-screen rendering.

**Edit 49 — Delete renderReady**

Current (lines 173-201): Delete the entire renderReady function.

**Edit 50 — Delete updateReadyKey**

Current (lines 348-389): Delete the entire updateReadyKey function. Its Spaces logic has moved to updateSpacesKey and updateAccountKey.

**Edit 51 — Verify no ScreenReady references remain**

Search for ScreenReady, ScreenLoading, ScreenAuth, ScreenOnboarding, ScreenHome, m.screen across all files. Every reference should be gone.

---

## Phase 7: Search Route Stub

Goal: search is a first-class route even if v0 has no backend.

### model.go

**Edit 52 — Add SearchState**

```go
type SearchState struct {
	QueryInput textinput.Model
	Busy       bool
	Results    []SearchResult
	Err        error
}

type SearchResult struct {
	Type string // "community", "post", "user"
	ID   string
	Name string
}
```

Add `search SearchState` to Model.

Initialize in New():
```go
searchInput := textinput.New()
searchInput.Prompt = ""
searchInput.Placeholder = "search"
searchInput.SetWidth(40)
searchInput.CharLimit = 128

search: SearchState{QueryInput: searchInput},
```

### view.go

**Edit 53 — Replace search stub with real query input**

```go
func renderSearch(m Model) string {
	lines := []string{
		okStyle.Render("Search"),
		"",
		inputStyle.Render(m.search.QueryInput.View()),
	}
	if m.search.Busy {
		lines = append(lines, "", m.spinner.View()+" Searching")
	}
	if m.search.Err != nil {
		lines = append(lines, "", errorStyle.Render(m.search.Err.Error()))
	}
	if len(m.search.Results) > 0 {
		lines = append(lines, "")
		for _, r := range m.search.Results {
			lines = append(lines, fmt.Sprintf("%s  %s", mutedStyle.Render(r.Type), accentStyle.Render(r.Name)))
		}
	}
	return strings.Join(lines, "\n")
}
```

### update.go

**Edit 54 — Add updateSearchKey**

```go
func (m Model) updateSearchKey(msg tea.KeyPressMsg) (tea.Model, tea.Cmd) {
	switch msg.String() {
	case "enter":
		q := strings.TrimSpace(m.search.QueryInput.Value())
		if q == "" {
			return m, nil
		}
		m.search.Busy = true
		m.search.Err = nil
		return m, loadSearchResultsCmd(m, q)
	default:
		var cmd tea.Cmd
		m.search.QueryInput, cmd = m.search.QueryInput.Update(msg)
		return m, cmd
	}
}
```

### commands.go

**Edit 55 — Add search command stub**

```go
func loadSearchResultsCmd(m Model, query string) tea.Cmd {
	return func() tea.Msg {
		return searchResultsLoadedMsg{results: []SearchResult{}}
	}
}
```

No backend yet. Returns empty results. Wiring happens when the search API lands.

---

## Phase 8: Community Focus View

Goal: clicking a community opens a post list.

### model.go

**Edit 56 — Add CommunityState**

```go
type CommunityState struct {
	CommunityID   string
	DisplayName   string
	Posts         []api.LocalizedPostResponse
	Busy          bool
	Err           error
	Cursor        *string
	SelectedIndex int
}
```

### commands.go

**Edit 57 — Add loadCommunityPostsCmd**

```go
func loadCommunityPostsCmd(m Model, communityID string) tea.Cmd {
	return func() tea.Msg {
		posts, err := m.apiClient.GetCommunityPosts(context.Background(), m.session.AccessToken, communityID, 20)
		if err != nil {
			return apiErrorMsg{op: "load_community_posts", err: err}
		}
		return communityPostsLoadedMsg{communityID: communityID, posts: posts}
	}
}
```

### api/client.go

**Edit 58 — Add GetCommunityPosts**

```go
func (c *Client) GetCommunityPosts(ctx context.Context, accessToken, communityID string, limit int) ([]api.LocalizedPostResponse, error) {
	path := fmt.Sprintf("/communities/%s/posts?limit=%d", communityID, limit)
	req, err := c.newRequest(ctx, http.MethodGet, path, accessToken, nil)
	if err != nil {
		return nil, err
	}
	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("community posts returned %s", resp.Status)
	}
	var out struct {
		Items []api.LocalizedPostResponse `json:"items"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return nil, err
	}
	return out.Items, nil
}
```

### view.go

**Edit 59 — Replace community stub with post list**

```go
func renderCommunity(m Model) string {
	if m.community.DisplayName != "" {
		return renderCommunityDetail(m)
	}
	return okStyle.Render("Community") + "\n\n" + mutedStyle.Render("No community selected.")
}

func renderCommunityDetail(m Model) string {
	lines := []string{
		okStyle.Render(m.community.DisplayName),
		"",
	}
	if m.community.Busy {
		lines = append(lines, m.spinner.View()+" Loading posts")
		return strings.Join(lines, "\n")
	}
	if m.community.Err != nil {
		lines = append(lines, errorStyle.Render(m.community.Err.Error()))
		return strings.Join(lines, "\n")
	}
	if len(m.community.Posts) == 0 {
		lines = append(lines, mutedStyle.Render("No posts yet."))
		return strings.Join(lines, "\n")
	}
	for i, item := range m.community.Posts {
		prefix := "  "
		if i == m.community.SelectedIndex {
			prefix = accentStyle.Render("> ")
		}
		lines = append(lines, prefix+renderFeedItem(item))
	}
	lines = append(lines, "", mutedStyle.Render("enter open  esc back"))
	return strings.Join(lines, "\n")
}
```

---

## Phase 9: Post Reader with Glamour

Goal: post detail uses glamour for markdown rendering inside a viewport.

### markdown.go (new file)

**Edit 60 — Create markdown renderer**

```go
package app

import (
	"fmt"

	"github.com/charmbracelet/glamour"
)

type MarkdownCache struct {
	renderer *glamour.TermRenderer
	cache    map[string]map[int]string
}

func NewMarkdownCache() *MarkdownCache {
	return &MarkdownCache{
		cache: make(map[string]map[int]string),
	}
}

func (c *MarkdownCache) Render(postID string, width int, markdown string) (string, error) {
	if c.cache[postID] != nil {
		if cached, ok := c.cache[postID][width]; ok {
			return cached, nil
		}
	}
	if c.renderer == nil {
		r, err := glamour.NewTermRenderer(
			glamour.WithAutoStyle(),
			glamour.WithWordWrap(width),
		)
		if err != nil {
			return "", err
		}
		c.renderer = r
	}
	rendered, err := c.renderer.Render(markdown)
	if err != nil {
		return "", err
	}
	if c.cache[postID] == nil {
		c.cache[postID] = make(map[int]string)
	}
	c.cache[postID][width] = rendered
	return rendered, nil
}

func (c *MarkdownCache) InvalidateWidth(width int) {
	for id, widths := range c.cache {
		for w := range widths {
			if w != width {
				delete(widths, w)
			}
		}
		if len(widths) == 0 {
			delete(c.cache, id)
		}
	}
}
```

Note: glamour is isolated here. If it has compatibility issues with charm.land/v2, the churn is contained to this file.

### model.go

**Edit 61 — Add PostState**

```go
type PostState struct {
	PostID    string
	Post      *api.LocalizedPostResponse
	Busy      bool
	Err       error
	ScrollY   int
	Rendered  string
}

type Model struct {
	...
	mdCache   *MarkdownCache
	post      PostState
	...
}
```

### view_post.go

**Edit 62 — Replace post stub with reader**

```go
func renderPost(m Model) string {
	if m.post.Busy {
		return m.spinner.View() + " Loading post"
	}
	if m.post.Err != nil {
		return errorStyle.Render(m.post.Err.Error())
	}
	if m.post.Post == nil {
		return mutedStyle.Render("No post selected.")
	}
	item := m.post.Post
	title := firstNonEmpty(item.Post.Title, item.Post.Caption, item.Post.Body, &item.Post.PostType)
	meta := []string{
		communityLabel(item.Post.CommunityID),
		fmt.Sprintf("%d↑", item.UpvoteCount),
		fmt.Sprintf("%d↓", item.DownvoteCount),
		timeLabel(item.Post.CreatedAt),
	}
	lines := []string{
		okStyle.Render(*item.Post.Title),
		mutedStyle.Render(strings.Join(meta, "  ")),
		"",
	}
	if m.post.Rendered != "" {
		lines = append(lines, m.post.Rendered)
	} else if item.Post.Body != nil {
		lines = append(lines, *item.Post.Body)
	}
	lines = append(lines, "", mutedStyle.Render("esc back  j/k scroll"))
	return strings.Join(lines, "\n")
}
```

Full viewport/scroll behavior will use bubbles/viewport when we get there. For v0, rendered markdown at natural height is sufficient.

---

## Global Key Map

Final key binding reference:

| Key      | Context            | Action                          |
|----------|--------------------|---------------------------------|
| 1        | global             | RouteHome                       |
| 2        | global             | RouteSearch                     |
| 3        | global             | RouteAccount / Connect          |
| esc / h  | focus active       | FocusNone (dismiss focus)       |
| h        | route              | (no-op, already home)           |
| ctrl+r   | signed-in route    | refresh current data            |
| ctrl+c   | global             | quit                            |
| n        | home+dev / connect+dev | local dev signup             |
| o        | home+nudge active  | FocusOnboarding                 |
| x        | home+nudge active  | dismiss nudge                   |
| j/k      | list views         | move selection                  |
| enter    | list/search        | open focused item               |
| /        | list views         | reserved for future filter      |
| g/G      | post reader        | top/bottom                      |
| pgup/pgdn| post reader        | page scroll                     |

---

## File Inventory After All Phases

| File                  | Phase | Status            |
|-----------------------|-------|-------------------|
| model.go              | 1     | modify            |
| router.go             | 1     | new (route helpers extracted from update.go) |
| init.go               | 2,4   | modify            |
| commands.go           | 4,7,8 | modify            |
| keys.go               | 1     | new (key definitions extracted from update.go) |
| messages.go           | 4,7,8 | modify            |
| session.go            | 4     | modify            |
| local_signup.go       | -     | keep as-is        |
| styles.go             | -     | keep, extend later |
| view_shell.go         | 3     | new (from view.go root/header/footer) |
| view_home.go          | 3     | new (from view.go renderHome/renderFeed) |
| view_search.go        | 7     | new               |
| view_account.go       | 3     | new (from view.go renderAuth/renderReady) |
| view_connect.go       | 3     | new (from view.go renderAuth) |
| view_onboarding.go    | 5     | new (from view.go renderOnboarding) |
| view_community.go     | 8     | new               |
| view_post.go          | 9     | new               |
| markdown.go           | 9     | new               |
| update.go             | 1-6   | modify heavily    |
| update_test.go        | 1     | modify            |
| view_test.go          | 1,2   | modify            |
| view.go               | 1-6   | modify then delete (absorbed into view_*.go) |

---

## Verification Checklist

After each phase, verify:

- [ ] Phase 1: `go vet ./internal/app` passes. App compiles and runs. Behavior unchanged from user perspective.
- [ ] Phase 2: signed-out launch produces no feed/discover API calls. Check stderr log or network traffic.
- [ ] Phase 3: signed-out home shows Connect, no live feed, no env-var wall. signed-in home shows feed + rail.
- [ ] Phase 4: token persists to ~/.config/pirate/session.json. App restores session on relaunch. Invalid token is cleared.
- [ ] Phase 5: onboarding nudge appears in signed-in home. Nudge dismisses for session. Focused card has step row and stable title. No ScreenReady.
- [ ] Phase 6: grep -r "ScreenReady\|ScreenLoading\|m\.screen" returns zero hits.
- [ ] Phase 7: pressing 2 shows search route with query input.
- [ ] Phase 8: opening a community shows post list. Plain text only.
- [ ] Phase 9: opening a post renders markdown via glamour. Width change does not corrupt layout.
