package spaces

import (
	"testing"
	"time"
)

func TestIsValidHandle(t *testing.T) {
	tests := []struct {
		handle string
		want   bool
	}{
		{"@bitcoin", true},
		{"satoshi@bitcoin", true},
		{"alice#bitcoin", true},
		{"@", false},
		{"name@", false},
		{"#", false},
		{"plain", false},
	}

	for _, tc := range tests {
		if got := isValidHandle(tc.handle); got != tc.want {
			t.Fatalf("isValidHandle(%q) = %v, want %v", tc.handle, got, tc.want)
		}
	}
}

func TestSplitHandle(t *testing.T) {
	space, label := splitHandle("satoshi@bitcoin")
	if space != "@bitcoin" || label != "satoshi" {
		t.Fatalf("unexpected split: space=%q label=%q", space, label)
	}

	space, label = splitHandle("@bitcoin")
	if space != "@bitcoin" || label != "" {
		t.Fatalf("unexpected apex split: space=%q label=%q", space, label)
	}
}

func TestNormalizeHandle(t *testing.T) {
	got := normalizeHandle("  SaToShI@BitCoin ")
	if got != "satoshi@bitcoin" {
		t.Fatalf("unexpected normalized handle: %q", got)
	}
}

func TestServiceResolveTimeout(t *testing.T) {
	svc := NewService(Config{Enabled: true, Timeout: 5 * time.Second})
	if got := svc.ResolveTimeout(); got != 5*time.Second {
		t.Fatalf("expected 5s timeout, got %s", got)
	}

	var nilSvc *Service
	if got := nilSvc.ResolveTimeout(); got != defaultTimeout {
		t.Fatalf("expected default timeout for nil service, got %s", got)
	}
}

func TestServiceInitRequiresTrustOrObserved(t *testing.T) {
	svc := NewService(Config{Enabled: true})
	err := svc.init()
	if err == nil {
		t.Fatal("expected init to fail without trust id or observed mode")
	}

	err2 := svc.init()
	if err2 == nil || err2.Error() != err.Error() {
		t.Fatalf("expected cached init error, got %v then %v", err, err2)
	}
}
