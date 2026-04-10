package app

import (
	"fmt"
	"strings"
	"time"

	"charm.land/lipgloss/v2"

	"pirate-tui/internal/api"
)

func renderRoot(m Model) string {
	content := strings.Join([]string{
		renderHeader(m),
		"",
		renderBody(m),
		"",
		renderFooter(m),
	}, "\n")

	width := 72
	if m.width > 0 {
		width = max(56, min(88, m.width-4))
	}

	box := cardStyle.Width(width).Render(content)
	if m.width > width+2 {
		box = lipgloss.PlaceHorizontal(m.width, lipgloss.Center, box)
	}

	return backgroundStyle.Render("\n" + box + "\n")
}

func renderHeader(m Model) string {
	left := strings.Join([]string{
		titleStyle.Render("PIRATE TUI"),
		mutedStyle.Render("Browse first. Account optional."),
	}, "\n")

	right := renderHeaderStatus(m)
	if right == "" {
		return left
	}

	width := 72
	if m.width > 0 {
		width = max(56, min(88, m.width-8))
	}
	leftWidth := max(24, width-22)
	return lipgloss.JoinHorizontal(
		lipgloss.Top,
		lipgloss.NewStyle().Width(leftWidth).Render(left),
		lipgloss.NewStyle().Align(lipgloss.Right).Width(width-leftWidth).Render(right),
	)
}

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

func renderAuth(m Model) string {
	lines := []string{
		okStyle.Render("Account"),
		"",
		"Press n to create a fresh local dev account.",
		"Press h to go back to browse.",
		"",
		accentStyle.Render("Optional"),
		"  PIRATE_API_BASE_URL   default: http://127.0.0.1:8787",
		"  PIRATE_ENABLE_HNS    set to 1 for letsdane + hnsd",
		"  PIRATE_HNSD_PATH     required if hnsd is not on PATH",
		"  PIRATE_HNS_PROXY_HOSTS  comma-separated override for proxied hosts",
		"  PIRATE_ENABLE_SPACES set to 1 for Spaces lookups in the ready screen",
		"  PIRATE_SPACES_TRUST_ID required unless PIRATE_SPACES_ALLOW_OBSERVED=1",
		"  PIRATE_ACCESS_TOKEN  use an existing session instead of local signup",
		"",
		mutedStyle.Render("Guest browsing works without a token."),
	}
	return strings.Join(lines, "\n")
}

func renderLoading(m Model) string {
	label := m.status.Message
	if label == "" {
		label = fmt.Sprintf("Working against %s", m.session.BaseURL)
	}
	lines := []string{fmt.Sprintf("%s %s", m.spinner.View(), label)}
	if m.onboarding.BusyLabel != "" {
		lines = append(lines, "", m.onboarding.BusyLabel)
	}
	lines = append(lines, "", mutedStyle.Render("Press h to go back."))
	lines = append(lines, "", mutedStyle.Render("Press ctrl+c to quit."))
	return strings.Join(lines, "\n")
}

func renderHome(m Model) string {
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

func renderOnboarding(m Model) string {
	lines := []string{
		okStyle.Render("Reddit onboarding"),
		"",
		renderSessionSummary(m),
	}
	if m.onboarding.Status != nil {
		lines = append(lines,
			"",
			renderStatusLine("Reddit verification", m.onboarding.Status.RedditVerificationStatus),
			renderStatusLine("Reddit import", m.onboarding.Status.RedditImportStatus),
			renderStatusLine("Unique human", m.onboarding.Status.UniqueHumanVerificationStatus),
			renderStatusLine("Namespace verification", m.onboarding.Status.NamespaceVerificationStatus),
			renderStatusLine("Community creation", booleanStatus(m.onboarding.Status.CommunityCreationReady)),
		)
		if len(m.onboarding.Status.MissingRequirements) > 0 {
			lines = append(lines, "", "Missing requirements:")
			for _, item := range m.onboarding.Status.MissingRequirements {
				lines = append(lines, "  - "+item)
			}
		}
		if len(m.onboarding.Status.SuggestedCommunityIDs) > 0 {
			lines = append(lines, "", "Suggested communities:")
			for _, id := range m.onboarding.Status.SuggestedCommunityIDs {
				lines = append(lines, "  - "+id)
			}
		}
	}
	if m.onboarding.LocalSignup != nil {
		lines = append(lines,
			"",
			renderStatusLine("User", m.onboarding.LocalSignup.UserID),
			renderStatusLine("Handle", m.onboarding.LocalSignup.GlobalHandle),
			renderStatusLine("Community", m.onboarding.LocalSignup.CommunityDisplayName),
			renderStatusLine("Namespace verification", m.onboarding.LocalSignup.NamespaceVerification),
		)
	}
	lines = append(lines, "", renderOnboardingActions(m))
	if m.onboarding.Verification != nil {
		lines = append(lines, "", renderVerificationDetails(*m.onboarding.Verification))
	}
	if m.onboarding.ImportSummary != nil {
		lines = append(lines, "", renderImportSummary(*m.onboarding.ImportSummary))
	}
	return strings.Join(lines, "\n")
}

func renderReady(m Model) string {
	lines := []string{
		okStyle.Render("Local account and first community are ready"),
		"",
		renderSessionSummary(m),
	}
	if m.onboarding.LocalSignup != nil {
		lines = append(lines,
			"",
			renderStatusLine("User", m.onboarding.LocalSignup.UserID),
			renderStatusLine("Handle", m.onboarding.LocalSignup.GlobalHandle),
			renderStatusLine("Community", m.onboarding.LocalSignup.CommunityDisplayName),
			renderStatusLine("Community ID", m.onboarding.LocalSignup.CommunityID),
			renderStatusLine("Namespace verification", m.onboarding.LocalSignup.NamespaceVerification),
			renderStatusLine("Provisioning job", m.onboarding.LocalSignup.ProvisioningJobStatus),
		)
	}
	if m.onboarding.ImportSummary != nil {
		lines = append(lines, "", renderImportSummary(*m.onboarding.ImportSummary))
	}
	lines = append(lines, "", renderSpacesLookup(m))
	if m.onboarding.Status != nil && len(m.onboarding.Status.SuggestedCommunityIDs) > 0 {
		lines = append(lines, "", "Starting points:")
		for _, id := range m.onboarding.Status.SuggestedCommunityIDs {
			lines = append(lines, "  - "+id)
		}
	}
	return strings.Join(lines, "\n")
}

func renderSessionSummary(m Model) string {
	lines := []string{
		fmt.Sprintf("API base URL: %s", m.session.BaseURL),
		fmt.Sprintf("Session source: %s", m.session.Source),
	}
	if !m.onboarding.LastLoadedAt.IsZero() {
		lines = append(lines, fmt.Sprintf("Last refresh: %s", m.onboarding.LastLoadedAt.Format("2006-01-02 15:04:05")))
	}
	return strings.Join(lines, "\n")
}

func renderStatusLine(label, value string) string {
	return fmt.Sprintf("%-22s %s", label+":", value)
}

func renderFooter(m Model) string {
	if m.status.Err != nil {
		return errorStyle.Render("Error: "+m.status.Err.Error()) + "\n" + mutedStyle.Render("Press ctrl+r to retry.")
	}
	parts := []string{mutedStyle.Render("ctrl+c quit")}
	parts = append(parts, mutedStyle.Render("ctrl+r refresh"))
	if m.screen != ScreenHome {
		parts = append(parts, mutedStyle.Render("h home"))
	}
	return strings.Join(parts, "   ")
}

func formatHNSHeight(height uint64) string {
	text := fmt.Sprintf("%d", height)
	var parts []string
	for len(text) > 3 {
		parts = append([]string{text[len(text)-3:]}, parts...)
		text = text[:len(text)-3]
	}
	parts = append([]string{text}, parts...)
	return strings.Join(parts, ",")
}

func timeSinceLabel(at time.Time) string {
	seconds := int(time.Since(at).Seconds())
	if seconds < 1 {
		return "just now"
	}
	if seconds == 1 {
		return "1s ago"
	}
	return fmt.Sprintf("%ds ago", seconds)
}

func renderHeaderStatus(m Model) string {
	parts := []string{}
	if m.session.Ready() {
		parts = append(parts, "signed in")
	} else {
		parts = append(parts, "guest")
	}
	if status := renderHNSSyncSummary(m); status != "" {
		parts = append(parts, status)
	}
	return mutedStyle.Render(strings.Join(parts, "\n"))
}

func renderHNSSyncSummary(m Model) string {
	if !m.hns.Enabled {
		return ""
	}
	if m.hns.Err != nil {
		return "hns down"
	}
	if m.hns.Synced {
		return "hns ready"
	}
	if m.hns.Height > 0 {
		return fmt.Sprintf("hns %s", formatHNSHeight(m.hns.Height))
	}
	return "hns starting"
}

func renderHomeFeed(m Model) string {
	lines := []string{okStyle.Render("Home")}
	switch {
	case m.home.FeedErr != nil:
		lines = append(lines, "", errorStyle.Render(m.home.FeedErr.Error()))
	case m.home.FeedBusy && m.home.Feed == nil:
		lines = append(lines, "", fmt.Sprintf("%s Loading feed", m.spinner.View()))
	case m.home.Feed == nil || len(m.home.Feed.Items) == 0:
		lines = append(lines, "", mutedStyle.Render("No posts yet."))
	default:
		for _, item := range m.home.Feed.Items[:min(4, len(m.home.Feed.Items))] {
			lines = append(lines, "", renderFeedItem(item))
		}
	}
	return strings.Join(lines, "\n")
}

func renderFeedItem(item api.LocalizedPostResponse) string {
	title := firstNonEmpty(item.Post.Title, item.Post.Caption, item.TranslatedBody, item.Post.Body)
	if title == "" {
		title = item.Post.PostType
	}
	title = clampRunes(title, 64)

	meta := []string{
		communityLabel(item.Post.CommunityID),
		fmt.Sprintf("%d↑", item.UpvoteCount),
		fmt.Sprintf("%d↓", item.DownvoteCount),
		timeLabel(item.Post.CreatedAt),
	}

	lines := []string{
		accentStyle.Render(title),
		mutedStyle.Render(strings.Join(meta, "  ")),
	}
	return strings.Join(lines, "\n")
}

func renderDiscoverCommunities(m Model) string {
	lines := []string{okStyle.Render("Communities")}
	switch {
	case m.home.DiscoverErr != nil:
		lines = append(lines, "", errorStyle.Render(m.home.DiscoverErr.Error()))
	case m.home.DiscoverBusy && m.home.Discover == nil:
		lines = append(lines, "", fmt.Sprintf("%s Loading communities", m.spinner.View()))
	case m.home.Discover == nil || len(m.home.Discover.Items) == 0:
		lines = append(lines, "", mutedStyle.Render("No communities yet."))
	default:
		for _, community := range m.home.Discover.Items[:min(5, len(m.home.Discover.Items))] {
			lines = append(lines, "", renderCommunityItem(community))
		}
	}
	return strings.Join(lines, "\n")
}

func renderCommunityItem(community api.Community) string {
	lines := []string{accentStyle.Render(community.DisplayName)}
	meta := []string{community.CommunityID}
	if community.MemberCount != nil {
		meta = append(meta, fmt.Sprintf("%d members", *community.MemberCount))
	}
	lines = append(lines, mutedStyle.Render(strings.Join(meta, "  ")))
	if community.Description != nil && strings.TrimSpace(*community.Description) != "" {
		lines = append(lines, clampRunes(strings.TrimSpace(*community.Description), 52))
	}
	return strings.Join(lines, "\n")
}

func renderHomeActions(m Model) string {
	lines := []string{}
	if m.session.Ready() {
		lines = append(lines, "o account")
	} else {
		lines = append(lines, "o account", "n create local account")
	}
	if !m.home.LastLoadedAt.IsZero() {
		lines = append(lines, "updated "+m.home.LastLoadedAt.Format("15:04:05"))
	}
	return mutedStyle.Render(strings.Join(lines, "   "))
}

func firstNonEmpty(values ...*string) string {
	for _, value := range values {
		if value != nil && strings.TrimSpace(*value) != "" {
			return strings.TrimSpace(*value)
		}
	}
	return ""
}

func clampRunes(value string, limit int) string {
	runes := []rune(value)
	if len(runes) <= limit {
		return value
	}
	return string(runes[:limit-1]) + "…"
}

func timeLabel(value string) string {
	if value == "" {
		return ""
	}
	at, err := time.Parse(time.RFC3339, value)
	if err != nil {
		return value
	}
	return at.Format("Jan 2")
}

func communityLabel(id string) string {
	id = strings.TrimSpace(id)
	if id == "" {
		return "community"
	}
	return "c/" + id
}

func renderOnboardingActions(m Model) string {
	if m.onboarding.Busy {
		return fmt.Sprintf("%s %s", m.spinner.View(), m.onboarding.BusyLabel)
	}
	if m.onboarding.LocalSignup != nil && m.onboarding.Status != nil && m.onboarding.Status.CommunityCreationReady {
		return okStyle.Render("Community creation is ready")
	}

	if needsRedditVerification(m.onboarding.Status) {
		lines := []string{
			"Reddit username",
			"  " + inputStyle.Render(m.onboarding.UsernameInput.View()),
			mutedStyle.Render("Enter checks verification"),
		}
		return strings.Join(lines, "\n")
	}

	lines := []string{
		okStyle.Render("Reddit verified"),
	}
	if needsUsernameForImport(m) {
		lines = append(lines,
			"Reddit username",
			"  "+inputStyle.Render(m.onboarding.UsernameInput.View()),
			mutedStyle.Render("Type username, then press i to start Reddit import"),
		)
		return strings.Join(lines, "\n")
	}
	if hasCompletedRedditImport(m.onboarding.Status) {
		lines = append(lines, mutedStyle.Render("s refresh summary"))
	} else {
		lines = append(lines, mutedStyle.Render("i start Reddit import"))
	}
	return strings.Join(lines, "\n")
}

func renderVerificationDetails(verification api.RedditVerification) string {
	lines := []string{
		"Verification session",
		renderStatusLine("Reddit username", verification.RedditUsername),
		renderStatusLine("Status", verification.Status),
	}
	if verification.CodePlacementSurface != nil {
		lines = append(lines, renderStatusLine("Code placement", *verification.CodePlacementSurface))
	}
	if verification.LastCheckedAt != nil {
		lines = append(lines, renderStatusLine("Last checked", *verification.LastCheckedAt))
	}
	if verification.FailureCode != nil {
		lines = append(lines, renderStatusLine("Failure code", *verification.FailureCode))
	}
	if verification.VerificationHint != nil {
		lines = append(lines, "", *verification.VerificationHint)
	}
	return strings.Join(lines, "\n")
}

func renderImportSummary(summary api.RedditImportSummary) string {
	lines := []string{
		"Import summary",
		renderStatusLine("Reddit username", summary.RedditUsername),
		renderStatusLine("Imported at", summary.ImportedAt),
	}
	if summary.GlobalKarma != nil {
		lines = append(lines, renderStatusLine("Global karma", fmt.Sprintf("%d", *summary.GlobalKarma)))
	}
	if summary.AccountAgeDays != nil {
		lines = append(lines, renderStatusLine("Account age days", fmt.Sprintf("%d", *summary.AccountAgeDays)))
	}
	if len(summary.InferredInterests) > 0 {
		lines = append(lines, "Interests: "+strings.Join(summary.InferredInterests, ", "))
	}
	if len(summary.TopSubreddits) > 0 {
		lines = append(lines, "Top subreddits:")
		for _, subreddit := range summary.TopSubreddits[:min(3, len(summary.TopSubreddits))] {
			lines = append(lines, "  - "+subreddit.Subreddit)
		}
	}
	if len(summary.SuggestedCommunities) > 0 {
		lines = append(lines, "Suggested communities:")
		for _, community := range summary.SuggestedCommunities {
			lines = append(lines, "  - "+community.Name+" ("+community.CommunityID+")")
		}
	}
	if summary.CoverageNote != nil {
		lines = append(lines, *summary.CoverageNote)
	}
	return strings.Join(lines, "\n")
}

func renderSpacesLookup(m Model) string {
	lines := []string{"Spaces lookup"}

	if m.spacesService == nil || !m.spacesService.Enabled() {
		lines = append(lines, mutedStyle.Render("Set PIRATE_ENABLE_SPACES=1 to enable app-level Spaces resolution."))
		return strings.Join(lines, "\n")
	}

	lines = append(lines,
		renderStatusLine("Trust mode", m.spacesService.Status()),
		"  "+inputStyle.Render(m.spacesLookup.QueryInput.View()),
	)

	if m.spacesLookup.Busy {
		lines = append(lines, mutedStyle.Render(m.spinner.View()+" "+m.spacesLookup.BusyLabel))
		return strings.Join(lines, "\n")
	}

	lines = append(lines, mutedStyle.Render("Enter resolves the current handle."))

	if m.spacesLookup.Result == nil {
		return strings.Join(lines, "\n")
	}

	result := m.spacesLookup.Result
	lines = append(lines,
		"",
		renderStatusLine("Handle", result.CanonicalHandle),
		renderStatusLine("Space", result.Space),
		renderStatusLine("Label", emptyFallback(result.Label, "-")),
		renderStatusLine("Sovereignty", emptyFallback(result.Sovereignty, "-")),
		renderStatusLine("Num ID", emptyFallback(result.NumID, "-")),
		renderStatusLine("Pinned trust", yesNo(result.Verification.PinnedTrust)),
		renderStatusLine("Trust source", emptyFallback(result.Verification.TrustSource, "-")),
	)
	if result.Verification.TrustID != "" {
		lines = append(lines, renderStatusLine("Trust ID", result.Verification.TrustID))
	}
	if len(result.Roots) > 0 {
		lines = append(lines, "Roots:")
		for _, root := range result.Roots {
			lines = append(lines, "  - "+root)
		}
	}
	if result.ZoneJSON != "" {
		lines = append(lines, "", "Zone JSON:", indentBlock(result.ZoneJSON, "  "))
	}

	return strings.Join(lines, "\n")
}

func booleanStatus(v bool) string {
	if v {
		return "ready"
	}
	return "not_ready"
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}

func yesNo(v bool) string {
	if v {
		return "yes"
	}
	return "no"
}

func emptyFallback(value, fallback string) string {
	if strings.TrimSpace(value) == "" {
		return fallback
	}
	return value
}

func indentBlock(value, prefix string) string {
	lines := strings.Split(value, "\n")
	for i := range lines {
		lines[i] = prefix + lines[i]
	}
	return strings.Join(lines, "\n")
}

func max(a, b int) int {
	if a > b {
		return a
	}
	return b
}
