package app

import (
	"testing"

	"pirate-tui/internal/api"
)

func TestIsOnboardingComplete(t *testing.T) {
	t.Parallel()

	if !isOnboardingComplete(api.OnboardingStatus{
		CommunityCreationReady: true,
	}) {
		t.Fatal("expected complete onboarding state")
	}

	if isOnboardingComplete(api.OnboardingStatus{
		CommunityCreationReady: false,
	}) {
		t.Fatal("expected incomplete onboarding state")
	}
}

func TestParseLocalSignupResult(t *testing.T) {
	t.Parallel()

	output := []byte("2026-04-11T00:00:00Z INF Injecting 8 Infisical secrets into your application process\n{\n  \"ok\": true,\n  \"subject\": \"local-subject-1\",\n  \"user_id\": \"usr_123\",\n  \"global_handle\": \"demo.pirate\",\n  \"access_token\": \"token\",\n  \"onboarding\": {\n    \"generated_handle_assigned\": true,\n    \"cleanup_rename_available\": true,\n    \"unique_human_verification_status\": \"verified\",\n    \"namespace_verification_status\": \"verified\",\n    \"community_creation_ready\": true,\n    \"missing_requirements\": [],\n    \"reddit_verification_status\": \"not_started\",\n    \"reddit_import_status\": \"not_started\"\n  },\n  \"namespace_verification_id\": \"nv_123\",\n  \"community_id\": \"cmt_123\",\n  \"community_display_name\": \"Demo\",\n  \"provisioning_job_id\": \"job_123\",\n  \"provisioning_job_status\": \"queued\"\n}")

	result, err := parseLocalSignupResult(output)
	if err != nil {
		t.Fatalf("parseLocalSignupResult returned error: %v", err)
	}
	if result.UserID != "usr_123" {
		t.Fatalf("expected user_id usr_123, got %s", result.UserID)
	}
	if !result.Onboarding.CommunityCreationReady {
		t.Fatal("expected community_creation_ready true")
	}
}

func TestNormalizeRedditUsername(t *testing.T) {
	t.Parallel()

	cases := map[string]string{
		"TechnoHippie":   "technohippie",
		"u/TechnoHippie": "technohippie",
		"/u/TestUser":    "testuser",
		"@AnotherUser":   "anotheruser",
	}

	for input, want := range cases {
		if got := normalizeRedditUsername(input); got != want {
			t.Fatalf("normalizeRedditUsername(%q) = %q, want %q", input, got, want)
		}
	}
}

func TestAccountScreen(t *testing.T) {
	t.Parallel()

	guest := New(nil, nil, nil, SessionState{}, nil)
	if got := guest.accountScreen(); got != ScreenAuth {
		t.Fatalf("guest accountScreen = %v, want %v", got, ScreenAuth)
	}

	signedIn := New(nil, nil, nil, SessionState{AccessToken: "token"}, nil)
	if got := signedIn.accountScreen(); got != ScreenOnboarding {
		t.Fatalf("signed in accountScreen = %v, want %v", got, ScreenOnboarding)
	}

	signedIn.onboarding.Status = &api.OnboardingStatus{CommunityCreationReady: true}
	if got := signedIn.accountScreen(); got != ScreenReady {
		t.Fatalf("ready accountScreen = %v, want %v", got, ScreenReady)
	}
}
