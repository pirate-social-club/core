package fabric

import (
	"context"
	"net/http"
	"testing"
	"time"

	libveritas "github.com/spacesprotocol/libveritas-go"
)

type roundTripFunc func(*http.Request) (*http.Response, error)

func (fn roundTripFunc) RoundTrip(request *http.Request) (*http.Response, error) {
	return fn(request)
}

func digestWithByte(value byte) [32]byte {
	var digest [32]byte
	digest[0] = value
	return digest
}

func TestFetchRelayResponsesBoundsSlowRelayByContextDeadline(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Millisecond)
	defer cancel()
	client := &http.Client{Transport: roundTripFunc(func(request *http.Request) (*http.Response, error) {
		<-request.Context().Done()
		return nil, request.Context().Err()
	})}
	responses := fetchRelayResponses(ctx, client, []string{"https://slow.test"}, []string{"@alice"}, nil)
	result := <-responses
	if result.err == nil {
		t.Fatal("expected the slow relay request to be cancelled")
	}
}

func TestReconcileZoneCandidatesSelectsHighestSequence(t *testing.T) {
	candidates := []zoneCandidate{
		{relay: "fast-stale", zone: libveritas.Zone{Handle: "@alice"}, sequence: 4, digest: digestWithByte(4), verified: true},
		{relay: "slow-fresh", zone: libveritas.Zone{Handle: "@alice"}, sequence: 9, digest: digestWithByte(9), verified: true},
	}
	zones, err := reconcileZoneCandidates(candidates)
	if err != nil {
		t.Fatalf("reconcile: %v", err)
	}
	if len(zones) != 1 || zones[0].Handle != "@alice" {
		t.Fatalf("unexpected zones: %#v", zones)
	}
}

func TestReconcileZoneCandidatesAcceptsIdenticalTie(t *testing.T) {
	digest := digestWithByte(7)
	zones, err := reconcileZoneCandidates([]zoneCandidate{
		{relay: "one", zone: libveritas.Zone{Handle: "@alice"}, sequence: 7, digest: digest, verified: true},
		{relay: "two", zone: libveritas.Zone{Handle: "@alice"}, sequence: 7, digest: digest, verified: true},
	})
	if err != nil {
		t.Fatalf("reconcile: %v", err)
	}
	if len(zones) != 1 {
		t.Fatalf("expected one selected zone, got %d", len(zones))
	}
}

func TestReconcileZoneCandidatesRejectsEqualSequenceDisagreement(t *testing.T) {
	_, err := reconcileZoneCandidates([]zoneCandidate{
		{relay: "one", zone: libveritas.Zone{Handle: "@alice"}, sequence: 7, digest: digestWithByte(1), verified: true},
		{relay: "two", zone: libveritas.Zone{Handle: "@alice"}, sequence: 7, digest: digestWithByte(2), verified: true},
	})
	if err == nil {
		t.Fatal("expected equal-sequence disagreement to fail closed")
	}
}

func TestReconcileZoneCandidatesCannotDetectAllRelaysStale(t *testing.T) {
	// This documents the durability boundary: agreement among relays proves
	// signature validity and consistency, not that a lost newer publication
	// does not exist.
	digest := digestWithByte(3)
	zones, err := reconcileZoneCandidates([]zoneCandidate{
		{relay: "one", zone: libveritas.Zone{Handle: "@alice"}, sequence: 3, digest: digest, verified: true},
		{relay: "two", zone: libveritas.Zone{Handle: "@alice"}, sequence: 3, digest: digest, verified: true},
	})
	if err != nil || len(zones) != 1 {
		t.Fatalf("expected internally consistent stale state to remain undetectable: zones=%d err=%v", len(zones), err)
	}
}

func TestReconcileZoneCandidatesIgnoresInvalidClaimedHighest(t *testing.T) {
	zones, err := reconcileZoneCandidates([]zoneCandidate{
		{relay: "valid", zone: libveritas.Zone{Handle: "@alice", Anchor: 4}, sequence: 4, digest: digestWithByte(4), verified: true},
		{relay: "invalid", zone: libveritas.Zone{Handle: "@alice", Anchor: 99}, sequence: 99, digest: digestWithByte(99), verified: false},
	})
	if err != nil || len(zones) != 1 || zones[0].Anchor != 4 {
		t.Fatalf("invalid highest sequence influenced selection: %#v err=%v", zones, err)
	}
}

func TestReconcileZoneCandidatesLetsHigherVerifiedEmptyStateWin(t *testing.T) {
	zones, err := reconcileZoneCandidates([]zoneCandidate{
		{relay: "old-target", zone: libveritas.Zone{Handle: "@alice", Anchor: 4, Records: []byte{1}}, sequence: 4, digest: digestWithByte(4), verified: true},
		{relay: "owner-cleared", zone: libveritas.Zone{Handle: "@alice", Anchor: 10}, sequence: 10, digest: digestWithByte(10), verified: true},
	})
	if err != nil || len(zones) != 1 || zones[0].Anchor != 10 {
		t.Fatalf("higher verified empty state did not win: %#v err=%v", zones, err)
	}
}

func TestRequestedHandlesRejectsCrossHandleSubstitution(t *testing.T) {
	expected := requestedHandles(QueryRequest{Queries: []Query{{Space: "@alice"}}})
	if _, ok := expected["@alice"]; !ok {
		t.Fatal("requested handle missing")
	}
	if _, ok := expected["@bob"]; ok {
		t.Fatal("unrequested handle was admitted")
	}
}

func TestSelectQueryRelaysAlwaysIncludesExplicitSeeds(t *testing.T) {
	relays := selectQueryRelays(
		[]string{"https://seed-one.test/", "https://seed-two.test"},
		[]string{"https://random-one.test", "https://random-two.test", "https://random-three.test"},
		4,
	)
	want := []string{
		"https://seed-one.test",
		"https://seed-two.test",
		"https://random-one.test",
		"https://random-two.test",
	}
	if len(relays) != len(want) {
		t.Fatalf("unexpected relay count: %#v", relays)
	}
	for index := range want {
		if relays[index] != want[index] {
			t.Fatalf("relay %d: got %q want %q", index, relays[index], want[index])
		}
	}
}
