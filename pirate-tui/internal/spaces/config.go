package spaces

import (
	"os"
	"strings"
	"time"
)

const defaultTimeout = 8 * time.Second

type Config struct {
	Enabled       bool
	Seeds         []string
	TrustID       string
	AllowObserved bool
	DevMode       bool
	Timeout       time.Duration
}

func LoadConfigFromEnv() Config {
	cfg := Config{
		Enabled:       envEnabled("PIRATE_ENABLE_SPACES"),
		Seeds:         parseCSV(os.Getenv("PIRATE_SPACES_SEEDS")),
		TrustID:       strings.TrimSpace(os.Getenv("PIRATE_SPACES_TRUST_ID")),
		AllowObserved: envEnabled("PIRATE_SPACES_ALLOW_OBSERVED"),
		DevMode:       envEnabled("PIRATE_SPACES_DEV_MODE"),
		Timeout:       parseDurationOrDefault(os.Getenv("PIRATE_SPACES_TIMEOUT"), defaultTimeout),
	}
	return cfg
}

func (c Config) normalized() Config {
	c.TrustID = strings.TrimSpace(c.TrustID)
	c.Seeds = normalizeSeeds(c.Seeds)
	if c.Timeout <= 0 {
		c.Timeout = defaultTimeout
	}
	return c
}

func envEnabled(key string) bool {
	value := strings.TrimSpace(strings.ToLower(os.Getenv(key)))
	switch value {
	case "1", "true", "yes", "on":
		return true
	default:
		return false
	}
}

func parseCSV(value string) []string {
	parts := strings.Split(value, ",")
	out := make([]string, 0, len(parts))
	for _, part := range parts {
		part = strings.TrimSpace(part)
		if part == "" {
			continue
		}
		out = append(out, part)
	}
	return out
}

func normalizeSeeds(seeds []string) []string {
	out := make([]string, 0, len(seeds))
	for _, seed := range seeds {
		seed = strings.TrimSpace(seed)
		if seed == "" {
			continue
		}
		out = append(out, seed)
	}
	return out
}

func parseDurationOrDefault(value string, fallback time.Duration) time.Duration {
	value = strings.TrimSpace(value)
	if value == "" {
		return fallback
	}
	d, err := time.ParseDuration(value)
	if err != nil || d <= 0 {
		return fallback
	}
	return d
}
