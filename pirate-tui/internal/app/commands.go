package app

import (
	"context"
	"time"

	tea "charm.land/bubbletea/v2"
)

func loadHomeFeedCmd(m Model) tea.Cmd {
	return func() tea.Msg {
		feed, err := m.apiClient.GetHomeFeed(context.Background(), m.session.AccessToken, 6)
		if err != nil {
			return apiErrorMsg{op: "load_home_feed", err: err}
		}
		return homeFeedLoadedMsg{feed: feed}
	}
}

func loadDiscoverCommunitiesCmd(m Model) tea.Cmd {
	return func() tea.Msg {
		communities, err := m.apiClient.GetDiscoverableCommunities(context.Background(), 6)
		if err != nil {
			return apiErrorMsg{op: "load_discover_communities", err: err}
		}
		return discoverCommunitiesLoadedMsg{communities: communities}
	}
}

func loadOnboardingStatusCmd(m Model) tea.Cmd {
	return func() tea.Msg {
		status, err := m.apiClient.GetOnboardingStatus(context.Background(), m.session.AccessToken)
		if err != nil {
			return apiErrorMsg{op: "load_onboarding_status", err: err}
		}
		return onboardingStatusLoadedMsg{status: status}
	}
}

func startOrCheckRedditVerificationCmd(m Model, redditUsername string) tea.Cmd {
	return func() tea.Msg {
		verification, err := m.apiClient.StartOrCheckRedditVerification(context.Background(), m.session.AccessToken, redditUsername)
		if err != nil {
			return apiErrorMsg{op: "start_or_check_reddit_verification", err: err}
		}
		return redditVerificationLoadedMsg{verification: verification}
	}
}

func startRedditImportCmd(m Model, redditUsername string) tea.Cmd {
	return func() tea.Msg {
		result, err := m.apiClient.StartRedditImport(context.Background(), m.session.AccessToken, redditUsername)
		if err != nil {
			return apiErrorMsg{op: "start_reddit_import", err: err}
		}
		return redditImportStartedMsg{result: result}
	}
}

func loadRedditImportSummaryCmd(m Model) tea.Cmd {
	return func() tea.Msg {
		summary, err := m.apiClient.GetLatestRedditImportSummary(context.Background(), m.session.AccessToken)
		if err != nil {
			return apiErrorMsg{op: "load_reddit_import_summary", err: err}
		}
		return redditImportSummaryLoadedMsg{summary: summary}
	}
}

func resolveSpacesHandleCmd(m Model, handle string) tea.Cmd {
	return func() tea.Msg {
		ctx, cancel := context.WithTimeout(context.Background(), m.spacesService.ResolveTimeout()+2*time.Second)
		defer cancel()

		result, err := m.spacesService.Resolve(ctx, handle)
		if err != nil {
			return spacesErrorMsg{err: err}
		}
		return spacesResolvedMsg{result: result}
	}
}

func retryAfterCmd(delay time.Duration, cmd tea.Cmd) tea.Cmd {
	if cmd == nil {
		return nil
	}

	return tea.Tick(delay, func(time.Time) tea.Msg {
		return retryCmdMsg{cmd: cmd}
	})
}

func refreshHomeCmd(m Model) tea.Cmd {
	return tea.Batch(
		loadHomeFeedCmd(m),
		loadDiscoverCommunitiesCmd(m),
	)
}

func pollHNSSyncCmd(m Model) tea.Cmd {
	if m.hnsSync == nil {
		return nil
	}

	return tea.Tick(time.Second, func(at time.Time) tea.Msg {
		return hnsSyncStatusMsg{
			status: m.hnsSync.HNSSyncStatus(),
			at:     at,
		}
	})
}
