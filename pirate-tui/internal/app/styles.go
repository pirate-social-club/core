package app

import "charm.land/lipgloss/v2"

var (
	backgroundStyle = lipgloss.NewStyle().
			Background(lipgloss.Color("#111315")).
			Foreground(lipgloss.Color("#F4EFE8"))

	cardStyle = lipgloss.NewStyle().
			Border(lipgloss.NormalBorder()).
			BorderForeground(lipgloss.Color("#3B322B")).
			Padding(1, 2)

	sectionStyle = lipgloss.NewStyle().
			PaddingRight(2)

	titleStyle = lipgloss.NewStyle().
			Bold(true).
			Foreground(lipgloss.Color("#FF8A3D"))

	accentStyle = lipgloss.NewStyle().
			Foreground(lipgloss.Color("#FF8A3D")).
			Bold(true)

	inputStyle = lipgloss.NewStyle().
			Foreground(lipgloss.Color("#F4EFE8")).
			Background(lipgloss.Color("#1A1D20")).
			Padding(0, 1)

	mutedStyle = lipgloss.NewStyle().
			Foreground(lipgloss.Color("#B7ACA0"))

	errorStyle = lipgloss.NewStyle().
			Foreground(lipgloss.Color("#FF6B57"))

	okStyle = lipgloss.NewStyle().
		Foreground(lipgloss.Color("#F4EFE8")).
		Bold(true)

)
