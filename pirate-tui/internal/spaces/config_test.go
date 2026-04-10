package spaces

import (
	"testing"
	"time"
)

func TestNormalizeSeeds(t *testing.T) {
	got := normalizeSeeds([]string{" https://a.example ", "", "https://b.example"})
	if len(got) != 2 {
		t.Fatalf("expected 2 seeds, got %d", len(got))
	}
	if got[0] != "https://a.example" || got[1] != "https://b.example" {
		t.Fatalf("unexpected seeds: %#v", got)
	}
}

func TestParseDurationOrDefault(t *testing.T) {
	if got := parseDurationOrDefault("15s", defaultTimeout); got != 15*time.Second {
		t.Fatalf("expected 15s, got %s", got)
	}
	if got := parseDurationOrDefault("bad", defaultTimeout); got != defaultTimeout {
		t.Fatalf("expected fallback timeout, got %s", got)
	}
}

func TestConfigNormalized(t *testing.T) {
	cfg := Config{
		Seeds:   []string{" https://relay-a.example ", "", "https://relay-b.example"},
		TrustID: "  abc123  ",
	}
	got := cfg.normalized()
	if got.TrustID != "abc123" {
		t.Fatalf("expected trimmed trust id, got %q", got.TrustID)
	}
	if got.Timeout != defaultTimeout {
		t.Fatalf("expected default timeout, got %s", got.Timeout)
	}
	if len(got.Seeds) != 2 {
		t.Fatalf("expected 2 normalized seeds, got %d", len(got.Seeds))
	}
}
