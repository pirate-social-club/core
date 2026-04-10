package app

import (
	"time"

	tea "charm.land/bubbletea/v2"

	"pirate-tui/internal/api"
	"pirate-tui/internal/netx"
	"pirate-tui/internal/spaces"
)

type onboardingStatusLoadedMsg struct {
	status api.OnboardingStatus
}

type homeFeedLoadedMsg struct {
	feed api.FeedResponse
}

type discoverCommunitiesLoadedMsg struct {
	communities api.CommunityListResponse
}

type redditVerificationLoadedMsg struct {
	verification api.RedditVerification
}

type redditImportStartedMsg struct {
	result api.RedditImportStartResult
}

type redditImportSummaryLoadedMsg struct {
	summary api.RedditImportSummary
}

type localSignupCompletedMsg struct {
	result LocalSignupResult
}

type apiErrorMsg struct {
	op  string
	err error
}

type spacesResolvedMsg struct {
	result spaces.ResolvedHandle
}

type spacesErrorMsg struct {
	err error
}

type retryCmdMsg struct {
	cmd func() tea.Msg
}

type hnsSyncStatusMsg struct {
	status netx.HNSSyncStatus
	at     time.Time
}

func (m apiErrorMsg) Error() string {
	return m.err.Error()
}
