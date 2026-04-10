package app

import (
	"strings"
	"testing"
)

func TestRenderRootShowsHomeScreenWithoutWindowSize(t *testing.T) {
	t.Parallel()

	model := New(nil, nil, nil, SessionState{}, nil)

	view := model.View()
	if !strings.Contains(view.Content, "Browse first. Account optional.") {
		t.Fatalf("expected home screen content, got %q", view.Content)
	}
	if !strings.Contains(view.Content, "Home") {
		t.Fatalf("expected home feed section, got %q", view.Content)
	}
}
