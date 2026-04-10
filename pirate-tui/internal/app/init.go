package app

import tea "charm.land/bubbletea/v2"

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
	if m.hnsSync != nil {
		cmds = append(cmds, pollHNSSyncCmd(m))
	}

	return tea.Batch(cmds...)
}
