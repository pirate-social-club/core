package netx

import (
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestShouldProxyRequest(t *testing.T) {
	t.Parallel()

	cases := []struct {
		name       string
		raw        string
		proxyHosts []string
		want       bool
	}{
		{name: "exact host", raw: "https://pirate", proxyHosts: []string{"pirate"}, want: true},
		{name: "subdomain host", raw: "https://api.pirate", proxyHosts: []string{"pirate"}, want: true},
		{name: "conventional domain skipped", raw: "https://example.com", proxyHosts: []string{"pirate"}, want: false},
		{name: "localhost skipped", raw: "http://localhost:8787", proxyHosts: []string{"pirate"}, want: false},
		{name: "loopback ipv4 skipped", raw: "http://127.0.0.1:8787", proxyHosts: []string{"pirate"}, want: false},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			req, err := http.NewRequest(http.MethodGet, tc.raw, nil)
			if err != nil {
				t.Fatalf("new request: %v", err)
			}
			if got := shouldProxyRequest(req, tc.proxyHosts); got != tc.want {
				t.Fatalf("shouldProxyRequest(%q, %v) = %v, want %v", tc.raw, tc.proxyHosts, got, tc.want)
			}
		})
	}
}

func TestLoadHNSConfigFromEnv(t *testing.T) {
	t.Setenv("PIRATE_ENABLE_HNS", "1")
	t.Setenv("PIRATE_HNSD_PATH", "/tmp/hnsd")
	t.Setenv("PIRATE_HNS_ROOT_ADDR", "127.0.0.1:7001")
	t.Setenv("PIRATE_HNS_RECURSIVE_ADDR", "127.0.0.1:7002")
	t.Setenv("PIRATE_HNS_PROXY_HOSTS", "pirate, api.pirate")
	t.Setenv("PIRATE_HNS_USER_AGENT", "pirate-test")

	cfg := LoadHNSConfigFromEnv()
	if !cfg.Enabled {
		t.Fatal("expected HNS mode to be enabled")
	}
	if cfg.HNSDPath != "/tmp/hnsd" {
		t.Fatalf("unexpected hnsd path %q", cfg.HNSDPath)
	}
	if cfg.RootAddr != "127.0.0.1:7001" {
		t.Fatalf("unexpected root addr %q", cfg.RootAddr)
	}
	if cfg.RecursiveAddr != "127.0.0.1:7002" {
		t.Fatalf("unexpected recursive addr %q", cfg.RecursiveAddr)
	}
	if len(cfg.ProxyHosts) != 2 || cfg.ProxyHosts[0] != "pirate" || cfg.ProxyHosts[1] != "api.pirate" {
		t.Fatalf("unexpected proxy hosts %v", cfg.ProxyHosts)
	}
	if cfg.UserAgent != "pirate-test" {
		t.Fatalf("unexpected user agent %q", cfg.UserAgent)
	}
}

func TestWithBaseURLDerivesProxyHosts(t *testing.T) {
	t.Parallel()

	cfg := (HNSConfig{}).WithBaseURL("https://pirate")
	if len(cfg.ProxyHosts) != 1 || cfg.ProxyHosts[0] != "pirate" {
		t.Fatalf("unexpected proxy hosts %v", cfg.ProxyHosts)
	}

	cfg = (HNSConfig{}).WithBaseURL("http://127.0.0.1:8787")
	if len(cfg.ProxyHosts) != 0 {
		t.Fatalf("expected loopback base URL to skip proxy hosts, got %v", cfg.ProxyHosts)
	}
}

func TestHNSDProcCloseTimeout(t *testing.T) {
	original := processExitWaitTimeout
	processExitWaitTimeout = 10 * time.Millisecond
	t.Cleanup(func() {
		processExitWaitTimeout = original
	})

	proc := &hnsdProc{
		done: make(chan struct{}),
	}

	err := proc.Close()
	if err == nil {
		t.Fatal("expected close timeout")
	}
}

func TestResolveHNSDPathExplicit(t *testing.T) {
	t.Parallel()

	dir := t.TempDir()
	path := filepath.Join(dir, "hnsd")
	if err := os.WriteFile(path, []byte("#!/bin/sh\n"), 0o755); err != nil {
		t.Fatalf("write temp hnsd: %v", err)
	}

	got, err := resolveHNSDPath(path)
	if err != nil {
		t.Fatalf("resolveHNSDPath: %v", err)
	}
	if got != path {
		t.Fatalf("got %q, want %q", got, path)
	}
}

func TestParseHNSDHeight(t *testing.T) {
	t.Parallel()

	height, ok := parseHNSDHeight("chain (38000):   new height: 38000")
	if !ok {
		t.Fatal("expected parse to succeed")
	}
	if height != 38000 {
		t.Fatalf("got %d, want 38000", height)
	}

	if _, ok := parseHNSDHeight("peer connected"); ok {
		t.Fatal("expected non-chain line to fail")
	}
}

func TestHNSDProcSyncedAfterQuietWindow(t *testing.T) {
	original := syncQuietTime
	syncQuietTime = 10 * time.Millisecond
	t.Cleanup(func() {
		syncQuietTime = original
	})

	proc := &hnsdProc{}
	proc.setHeight(123)
	if proc.Synced() {
		t.Fatal("expected proc to start unsynced right after height update")
	}

	time.Sleep(15 * time.Millisecond)
	if !proc.Synced() {
		t.Fatal("expected proc to become synced after quiet window")
	}
}

func TestWaitUntilSyncedTimeout(t *testing.T) {
	proc := &hnsdProc{
		done: make(chan struct{}),
	}

	err := proc.WaitUntilSynced(20 * time.Millisecond)
	if err == nil {
		t.Fatal("expected timeout")
	}
}

func TestWaitUntilSyncedProcessExit(t *testing.T) {
	proc := &hnsdProc{
		done: make(chan struct{}),
	}
	proc.processErr = errors.New("boom")
	close(proc.done)

	err := proc.WaitUntilSynced(50 * time.Millisecond)
	if err == nil || err.Error() != "boom" {
		t.Fatalf("got %v, want boom", err)
	}
}
