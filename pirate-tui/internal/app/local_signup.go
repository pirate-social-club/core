package app

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	tea "charm.land/bubbletea/v2"

	"pirate-tui/internal/api"
)

type LocalSignupResult struct {
	OK                    bool                 `json:"ok"`
	Subject               string               `json:"subject"`
	UserID                string               `json:"user_id"`
	GlobalHandle          string               `json:"global_handle"`
	AccessToken           string               `json:"access_token"`
	Onboarding            api.OnboardingStatus `json:"onboarding"`
	NamespaceVerification string               `json:"namespace_verification_id"`
	CommunityID           string               `json:"community_id"`
	CommunityDisplayName  string               `json:"community_display_name"`
	ProvisioningJobID     string               `json:"provisioning_job_id"`
	ProvisioningJobStatus string               `json:"provisioning_job_status"`
}

func findRepoRoot(start string) (string, error) {
	current := start
	for {
		if _, err := os.Stat(filepath.Join(current, "scripts", "run-local-new-account-flow.sh")); err == nil {
			return current, nil
		}
		parent := filepath.Dir(current)
		if parent == current {
			return "", fmt.Errorf("repo root not found")
		}
		current = parent
	}
}

func parseLocalSignupResult(output []byte) (LocalSignupResult, error) {
	var result LocalSignupResult
	trimmed := bytes.TrimSpace(output)
	start := bytes.IndexByte(trimmed, '{')
	if start == -1 {
		return result, fmt.Errorf("local signup output did not contain JSON")
	}
	if err := json.Unmarshal(trimmed[start:], &result); err != nil {
		return result, err
	}
	if !result.OK || strings.TrimSpace(result.AccessToken) == "" {
		return result, fmt.Errorf("local signup returned an incomplete result")
	}
	return result, nil
}

func runLocalSignup(ctx context.Context) (LocalSignupResult, error) {
	var result LocalSignupResult

	cwd, err := os.Getwd()
	if err != nil {
		return result, err
	}
	repoRoot, err := findRepoRoot(cwd)
	if err != nil {
		return result, err
	}

	cmd := exec.CommandContext(ctx, filepath.Join(repoRoot, "scripts", "run-local-new-account-flow.sh"))
	cmd.Dir = repoRoot
	cmd.Env = os.Environ()
	output, err := cmd.CombinedOutput()
	if err != nil {
		return result, fmt.Errorf("%w: %s", err, strings.TrimSpace(string(output)))
	}
	return parseLocalSignupResult(output)
}

func localSignupCmd() tea.Cmd {
	return func() tea.Msg {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
		defer cancel()

		result, err := runLocalSignup(ctx)
		if err != nil {
			return apiErrorMsg{op: "local_signup", err: err}
		}
		return localSignupCompletedMsg{result: result}
	}
}
