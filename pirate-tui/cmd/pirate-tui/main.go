package main

import (
	"log"
	"net/http"
	"os"
	"time"

	tea "charm.land/bubbletea/v2"

	"pirate-tui/internal/api"
	"pirate-tui/internal/app"
	"pirate-tui/internal/netx"
	"pirate-tui/internal/spaces"
)

func main() {
	startupLogger := log.New(os.Stderr, "", 0)

	session := app.LoadSessionFromEnv()
	hnsConfig := netx.LoadHNSConfigFromEnv().WithBaseURL(session.BaseURL)
	httpClient, closer, err := netx.NewHTTPClient(15*time.Second, hnsConfig, nil)
	if err != nil {
		startupLogger.Fatalf("pirate-tui network setup: %v", err)
	}
	defer closer.Close()

	client := api.NewClient(session.BaseURL, func() *http.Client {
		return httpClient
	})

	spacesService := spaces.NewService(spaces.LoadConfigFromEnv())

	program := tea.NewProgram(
		app.New(client, syncProvider(closer), spacesService, session, nil),
		tea.WithWindowSize(80, 24),
	)

	if _, err = program.Run(); err != nil {
		startupLogger.Fatalf("pirate-tui: %v", err)
	}
}

func syncProvider(closer any) netx.HNSSyncStatusProvider {
	provider, _ := closer.(netx.HNSSyncStatusProvider)
	return provider
}
