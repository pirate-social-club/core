package app

import (
	"os"
	"strings"
)

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
