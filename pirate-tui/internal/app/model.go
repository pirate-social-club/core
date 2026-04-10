package app

import (
	"log"
	"time"

	"charm.land/bubbles/v2/spinner"
	"charm.land/bubbles/v2/textinput"
	tea "charm.land/bubbletea/v2"

	"pirate-tui/internal/api"
	"pirate-tui/internal/netx"
	"pirate-tui/internal/spaces"
)

type Screen int

const (
	ScreenHome Screen = iota
	ScreenAuth
	ScreenLoading
	ScreenOnboarding
	ScreenReady
)

type SessionState struct {
	BaseURL     string
	AccessToken string
	Source      string
}

func (s SessionState) Ready() bool {
	return s.AccessToken != ""
}

type OnboardingState struct {
	Status        *api.OnboardingStatus
	LastLoadedAt  time.Time
	UsernameInput textinput.Model
	Verification  *api.RedditVerification
	ImportSummary *api.RedditImportSummary
	LocalSignup   *LocalSignupResult
	Busy          bool
	BusyLabel     string
}

type StatusState struct {
	Message string
	Err     error
}

type HomeState struct {
	Feed            *api.FeedResponse
	FeedBusy        bool
	FeedErr         error
	Discover        *api.CommunityListResponse
	DiscoverBusy    bool
	DiscoverErr     error
	LastLoadedAt    time.Time
	AccountBusy     bool
	AccountBusyLabel string
}

type SpacesLookupState struct {
	QueryInput textinput.Model
	Busy       bool
	BusyLabel  string
	Result     *spaces.ResolvedHandle
}

type HNSSyncState struct {
	Enabled        bool
	Synced         bool
	Height         uint64
	LastProgressAt time.Time
	Err            error
}

type Model struct {
	screen        Screen
	width         int
	height        int
	spinner       spinner.Model
	apiClient     *api.Client
	hnsSync       netx.HNSSyncStatusProvider
	spacesService *spaces.Service
	session       SessionState
	home          HomeState
	onboarding    OnboardingState
	spacesLookup  SpacesLookupState
	hns           HNSSyncState
	status        StatusState
	logger        *log.Logger
}

func New(apiClient *api.Client, hnsSync netx.HNSSyncStatusProvider, spacesService *spaces.Service, session SessionState, logger *log.Logger) Model {
	s := spinner.New()
	s.Spinner = spinner.Dot
	s.Style = accentStyle

	usernameInput := textinput.New()
	usernameInput.Focus()
	usernameInput.Prompt = ""
	usernameInput.Placeholder = "reddit username"
	usernameInput.SetWidth(28)
	usernameInput.CharLimit = 64

	spacesInput := textinput.New()
	spacesInput.Prompt = ""
	spacesInput.Placeholder = "@space or name@space"
	spacesInput.SetWidth(32)
	spacesInput.CharLimit = 128

	return Model{
		screen:        ScreenHome,
		spinner:       s,
		apiClient:     apiClient,
		hnsSync:       hnsSync,
		spacesService: spacesService,
		session:       session,
		home: HomeState{
			FeedBusy:     true,
			DiscoverBusy: true,
		},
		onboarding: OnboardingState{
			UsernameInput: usernameInput,
		},
		spacesLookup: SpacesLookupState{
			QueryInput: spacesInput,
		},
		logger: logger,
	}
}

func (m Model) View() tea.View {
	return tea.NewView(renderRoot(m))
}
