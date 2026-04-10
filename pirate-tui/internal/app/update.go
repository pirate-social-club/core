package app

import (
	"errors"
	"strings"
	"time"

	"charm.land/bubbles/v2/spinner"
	tea "charm.land/bubbletea/v2"

	"pirate-tui/internal/api"
	"pirate-tui/internal/netx"
)

func (m Model) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.WindowSizeMsg:
		m.width = msg.Width
		m.height = msg.Height
		return m, nil

	case tea.KeyPressMsg:
		return m.updateKey(msg)

	case spinner.TickMsg:
		var cmd tea.Cmd
		m.spinner, cmd = m.spinner.Update(msg)
		return m, cmd

	case retryCmdMsg:
		return m, msg.cmd

	case hnsSyncStatusMsg:
		m.hns.Enabled = msg.status.Enabled
		m.hns.Synced = msg.status.Synced
		m.hns.Height = msg.status.Height
		m.hns.LastProgressAt = msg.status.LastProgressAt
		m.hns.Err = msg.status.Error
		return m, pollHNSSyncCmd(m)

	case homeFeedLoadedMsg:
		m.home.Feed = &msg.feed
		m.home.FeedBusy = false
		m.home.FeedErr = nil
		m.home.LastLoadedAt = time.Now()
		return m, nil

	case discoverCommunitiesLoadedMsg:
		m.home.Discover = &msg.communities
		m.home.DiscoverBusy = false
		m.home.DiscoverErr = nil
		m.home.LastLoadedAt = time.Now()
		return m, nil

	case onboardingStatusLoadedMsg:
		m.onboarding.Status = &msg.status
		m.onboarding.LastLoadedAt = time.Now()
		m.onboarding.Busy = false
		m.onboarding.BusyLabel = ""
		m.status.Err = nil
		if m.screen != ScreenHome {
			m.status.Message = "Onboarding status loaded"
		}
		if needsRedditVerification(m.onboarding.Status) || needsUsernameForImport(m) {
			m.onboarding.UsernameInput.Focus()
		}
		if isOnboardingComplete(msg.status) {
			m.onboarding.Busy = true
			m.onboarding.BusyLabel = "Loading Reddit import summary"
			return m, loadRedditImportSummaryCmd(m)
		}
		return m, nil

	case redditVerificationLoadedMsg:
		m.onboarding.Verification = &msg.verification
		m.onboarding.Busy = false
		m.onboarding.BusyLabel = ""
		m.status.Err = nil
		m.status.Message = "Reddit verification updated"
		if m.onboarding.Status != nil {
			m.onboarding.Status.RedditVerificationStatus = msg.verification.Status
		}
		m.onboarding.UsernameInput.SetValue(msg.verification.RedditUsername)
		if msg.verification.Status == "verified" {
			m.onboarding.UsernameInput.Blur()
		}
		return m, nil

	case redditImportStartedMsg:
		m.onboarding.Busy = true
		m.onboarding.BusyLabel = "Refreshing onboarding status"
		m.onboarding.ImportSummary = nil
		if m.onboarding.Status != nil {
			m.onboarding.Status.RedditImportStatus = msg.result.Job.Status
		}
		m.status.Err = nil
		m.status.Message = "Reddit import queued"
		return m, loadOnboardingStatusCmd(m)

	case redditImportSummaryLoadedMsg:
		m.onboarding.ImportSummary = &msg.summary
		m.onboarding.Busy = false
		m.onboarding.BusyLabel = ""
		m.status.Err = nil
		if m.screen != ScreenHome {
			m.status.Message = "Reddit import summary loaded"
		}
		m.onboarding.UsernameInput.SetValue(msg.summary.RedditUsername)
		m.onboarding.UsernameInput.Blur()
		if m.screen != ScreenHome {
			m.screen = ScreenReady
		}
		if m.screen == ScreenReady && m.spacesService != nil && m.spacesService.Enabled() {
			m.spacesLookup.QueryInput.Focus()
		}
		return m, nil

	case localSignupCompletedMsg:
		m.session.AccessToken = msg.result.AccessToken
		m.session.Source = "local-dev-signup"
		m.onboarding.LocalSignup = &msg.result
		m.onboarding.Status = &msg.result.Onboarding
		m.onboarding.LastLoadedAt = time.Now()
		m.onboarding.Busy = false
		m.onboarding.BusyLabel = ""
		m.status.Err = nil
		m.status.Message = "Local account created"
		if isOnboardingComplete(msg.result.Onboarding) {
			m.screen = ScreenReady
			if m.spacesService != nil && m.spacesService.Enabled() {
				m.spacesLookup.QueryInput.Focus()
			}
			return m, nil
		}
		m.screen = ScreenOnboarding
		return m, loadOnboardingStatusCmd(m)

	case spacesResolvedMsg:
		m.spacesLookup.Result = &msg.result
		m.spacesLookup.Busy = false
		m.spacesLookup.BusyLabel = ""
		m.status.Err = nil
		m.status.Message = "Spaces lookup loaded"
		return m, nil

	case spacesErrorMsg:
		m.spacesLookup.Busy = false
		m.spacesLookup.BusyLabel = ""
		m.status.Err = msg.err
		m.status.Message = ""
		if m.logger != nil {
			m.logger.Printf("resolve_spaces_handle: %v", msg.err)
		}
		return m, nil

	case apiErrorMsg:
		if errors.Is(msg.err, netx.ErrHNSSyncing()) {
			m.status.Err = nil
			m.status.Message = ""
			switch msg.op {
			case "load_home_feed":
				m.home.FeedBusy = true
				m.home.FeedErr = nil
			case "load_discover_communities":
				m.home.DiscoverBusy = true
				m.home.DiscoverErr = nil
			default:
				m.onboarding.Busy = true
				m.onboarding.BusyLabel = "Waiting for Handshake sync"
			}
			return m, retryAfterCmd(2*time.Second, retryCommandForOp(m, msg.op))
		}

		switch msg.op {
		case "load_home_feed":
			m.home.FeedBusy = false
			m.home.FeedErr = msg.err
			return m, nil
		case "load_discover_communities":
			m.home.DiscoverBusy = false
			m.home.DiscoverErr = msg.err
			return m, nil
		}

		m.status.Err = msg.err
		m.status.Message = ""
		m.onboarding.Busy = false
		m.onboarding.BusyLabel = ""
		if m.logger != nil {
			m.logger.Printf("%s: %v", msg.op, msg.err)
		}
		return m, nil
	}

	return m, nil
}

func retryCommandForOp(m Model, op string) tea.Cmd {
	switch op {
	case "load_home_feed":
		return loadHomeFeedCmd(m)
	case "load_discover_communities":
		return loadDiscoverCommunitiesCmd(m)
	case "load_onboarding_status":
		return loadOnboardingStatusCmd(m)
	case "start_or_check_reddit_verification":
		return startOrCheckRedditVerificationCmd(m, m.currentRedditUsername())
	case "start_reddit_import":
		return startRedditImportCmd(m, m.currentRedditUsername())
	case "load_reddit_import_summary":
		return loadRedditImportSummaryCmd(m)
	default:
		return nil
	}
}

func (m Model) updateKey(msg tea.KeyPressMsg) (tea.Model, tea.Cmd) {
	switch msg.String() {
	case "ctrl+c":
		return m, tea.Quit
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
	}

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
	return m, nil
}

func (m Model) updateHomeKey(msg tea.KeyPressMsg) (tea.Model, tea.Cmd) {
	switch msg.String() {
	case "o":
		m.screen = m.accountScreen()
		if m.screen == ScreenOnboarding && m.session.Ready() && m.onboarding.Status == nil && !m.onboarding.Busy {
			m.onboarding.Busy = true
			m.onboarding.BusyLabel = "Loading onboarding status"
			return m, loadOnboardingStatusCmd(m)
		}
		return m, nil
	case "n":
		if m.session.Ready() {
			return m, nil
		}
		m.screen = ScreenLoading
		m.status.Message = "Creating local account"
		m.status.Err = nil
		return m, localSignupCmd()
	}
	return m, nil
}

func (m Model) updateAuthKey(msg tea.KeyPressMsg) (tea.Model, tea.Cmd) {
	switch msg.String() {
	case "h":
		m.screen = ScreenHome
		return m, nil
	case "n":
		m.screen = ScreenLoading
		m.status.Message = "Creating local account"
		m.status.Err = nil
		return m, localSignupCmd()
	}
	return m, nil
}

func (m Model) updateOnboardingKey(msg tea.KeyPressMsg) (tea.Model, tea.Cmd) {
	if m.onboarding.Busy {
		return m, nil
	}

	if msg.String() == "h" {
		m.screen = ScreenHome
		return m, nil
	}

	if needsRedditVerification(m.onboarding.Status) {
		switch msg.String() {
		case "enter":
			username := m.currentRedditUsername()
			if username == "" {
				m.status.Err = nil
				m.status.Message = "Enter a Reddit username first"
				return m, nil
			}
			m.onboarding.Busy = true
			m.onboarding.BusyLabel = "Checking Reddit verification"
			m.status.Message = ""
			m.status.Err = nil
			return m, startOrCheckRedditVerificationCmd(m, username)
		default:
			var cmd tea.Cmd
			m.onboarding.UsernameInput, cmd = m.onboarding.UsernameInput.Update(msg)
			return m, cmd
		}
	}

	switch msg.String() {
	case "i":
		username := m.currentRedditUsername()
		if username == "" {
			m.status.Err = nil
			m.status.Message = "No Reddit username available for import"
			return m, nil
		}
		m.onboarding.Busy = true
		m.onboarding.BusyLabel = "Starting Reddit import"
		m.status.Message = ""
		m.status.Err = nil
		return m, startRedditImportCmd(m, username)
	case "s":
		if !hasCompletedRedditImport(m.onboarding.Status) {
			return m, nil
		}
		m.onboarding.Busy = true
		m.onboarding.BusyLabel = "Loading Reddit import summary"
		m.status.Message = ""
		m.status.Err = nil
		return m, loadRedditImportSummaryCmd(m)
	default:
		if needsUsernameForImport(m) {
			var cmd tea.Cmd
			m.onboarding.UsernameInput, cmd = m.onboarding.UsernameInput.Update(msg)
			return m, cmd
		}
	}

	return m, nil
}

func (m Model) updateReadyKey(msg tea.KeyPressMsg) (tea.Model, tea.Cmd) {
	if m.spacesLookup.Busy {
		return m, nil
	}

	switch msg.String() {
	case "h":
		m.screen = ScreenHome
		return m, nil
	case "s":
		m.onboarding.Busy = true
		m.onboarding.BusyLabel = "Refreshing Reddit import summary"
		m.status.Message = ""
		m.status.Err = nil
		return m, loadRedditImportSummaryCmd(m)
	case "enter":
		if m.spacesService == nil || !m.spacesService.Enabled() {
			return m, nil
		}

		handle := strings.TrimSpace(m.spacesLookup.QueryInput.Value())
		if handle == "" {
			m.status.Err = nil
			m.status.Message = "Enter a Spaces handle first"
			return m, nil
		}

		m.spacesLookup.Busy = true
		m.spacesLookup.BusyLabel = "Resolving Spaces handle"
		m.status.Message = ""
		m.status.Err = nil
		return m, resolveSpacesHandleCmd(m, handle)
	default:
		if m.spacesService == nil || !m.spacesService.Enabled() {
			return m, nil
		}

		var cmd tea.Cmd
		m.spacesLookup.QueryInput, cmd = m.spacesLookup.QueryInput.Update(msg)
		return m, cmd
	}
}

func isOnboardingComplete(status api.OnboardingStatus) bool {
	return status.CommunityCreationReady
}

func needsRedditVerification(status *api.OnboardingStatus) bool {
	if status == nil {
		return true
	}
	return status.RedditVerificationStatus != "verified"
}

func hasCompletedRedditImport(status *api.OnboardingStatus) bool {
	return status != nil && status.RedditImportStatus == "succeeded"
}

func needsUsernameForImport(m Model) bool {
	return !needsRedditVerification(m.onboarding.Status) && m.currentRedditUsername() == ""
}

func (m Model) currentRedditUsername() string {
	if m.onboarding.Verification != nil && m.onboarding.Verification.RedditUsername != "" {
		return m.onboarding.Verification.RedditUsername
	}
	if m.onboarding.ImportSummary != nil && m.onboarding.ImportSummary.RedditUsername != "" {
		return m.onboarding.ImportSummary.RedditUsername
	}
	return normalizeRedditUsername(m.onboarding.UsernameInput.Value())
}

func normalizeRedditUsername(value string) string {
	value = strings.TrimSpace(strings.ToLower(value))
	value = strings.TrimPrefix(value, "u/")
	value = strings.TrimPrefix(value, "/u/")
	value = strings.TrimPrefix(value, "@")
	return value
}

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
