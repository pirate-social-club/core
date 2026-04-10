package api

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
)

type HTTPClient interface {
	Do(req *http.Request) (*http.Response, error)
}

type Client struct {
	baseURL    string
	httpClient HTTPClient
}

func NewClient(baseURL string, newHTTPClient func() *http.Client) *Client {
	trimmed := strings.TrimRight(strings.TrimSpace(baseURL), "/")
	if trimmed == "" {
		trimmed = "http://127.0.0.1:8787"
	}
	return &Client{
		baseURL:    trimmed,
		httpClient: newHTTPClient(),
	}
}

func (c *Client) GetOnboardingStatus(ctx context.Context, accessToken string) (OnboardingStatus, error) {
	var out OnboardingStatus

	req, err := c.newRequest(ctx, http.MethodGet, "/onboarding/status", accessToken, nil)
	if err != nil {
		return out, err
	}

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return out, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return out, fmt.Errorf("onboarding status returned %s", resp.Status)
	}
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return out, err
	}
	return out, nil
}

func (c *Client) GetHomeFeed(ctx context.Context, accessToken string, limit int) (FeedResponse, error) {
	var out FeedResponse

	path := "/feeds/home"
	if limit > 0 {
		path = fmt.Sprintf("%s?limit=%d", path, limit)
	}

	req, err := c.newRequest(ctx, http.MethodGet, path, accessToken, nil)
	if err != nil {
		return out, err
	}

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return out, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return out, fmt.Errorf("home feed returned %s", resp.Status)
	}
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return out, err
	}
	return out, nil
}

func (c *Client) GetDiscoverableCommunities(ctx context.Context, limit int) (CommunityListResponse, error) {
	var out CommunityListResponse

	path := "/communities/discover"
	if limit > 0 {
		path = fmt.Sprintf("%s?limit=%d", path, limit)
	}

	req, err := c.newRequest(ctx, http.MethodGet, path, "", nil)
	if err != nil {
		return out, err
	}

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return out, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return out, fmt.Errorf("discover communities returned %s", resp.Status)
	}
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return out, err
	}
	return out, nil
}

func (c *Client) StartOrCheckRedditVerification(ctx context.Context, accessToken, redditUsername string) (RedditVerification, error) {
	var out RedditVerification
	req, err := c.newRequest(ctx, http.MethodPost, "/onboarding/reddit-verification", accessToken, map[string]string{
		"reddit_username": redditUsername,
	})
	if err != nil {
		return out, err
	}

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return out, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return out, fmt.Errorf("reddit verification returned %s", resp.Status)
	}
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return out, err
	}
	return out, nil
}

func (c *Client) StartRedditImport(ctx context.Context, accessToken, redditUsername string) (RedditImportStartResult, error) {
	var out RedditImportStartResult
	req, err := c.newRequest(ctx, http.MethodPost, "/onboarding/reddit-imports", accessToken, map[string]string{
		"reddit_username": redditUsername,
	})
	if err != nil {
		return out, err
	}

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return out, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusAccepted {
		return out, fmt.Errorf("reddit import returned %s", resp.Status)
	}
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return out, err
	}
	return out, nil
}

func (c *Client) GetLatestRedditImportSummary(ctx context.Context, accessToken string) (RedditImportSummary, error) {
	var out RedditImportSummary
	req, err := c.newRequest(ctx, http.MethodGet, "/onboarding/reddit-imports/latest", accessToken, nil)
	if err != nil {
		return out, err
	}

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return out, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return out, fmt.Errorf("reddit import summary returned %s", resp.Status)
	}
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return out, err
	}
	return out, nil
}

func (c *Client) newRequest(ctx context.Context, method, path, accessToken string, body any) (*http.Request, error) {
	var payload []byte
	var err error
	if body != nil {
		payload, err = json.Marshal(body)
		if err != nil {
			return nil, err
		}
	}

	req, err := http.NewRequestWithContext(ctx, method, c.baseURL+path, bytes.NewReader(payload))
	if err != nil {
		return nil, err
	}
	if accessToken != "" {
		req.Header.Set("Authorization", "Bearer "+accessToken)
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	return req, nil
}
