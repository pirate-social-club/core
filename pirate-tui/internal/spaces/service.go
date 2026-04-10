package spaces

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"sync"
	"time"

	fabric "github.com/spacesprotocol/fabric-go"
	libveritas "github.com/spacesprotocol/libveritas-go"
)

type Service struct {
	cfg         Config
	mu          sync.Mutex
	fabric      *fabric.Fabric
	initialized bool
	initErr     error
}

func NewService(cfg Config) *Service {
	return &Service{cfg: cfg.normalized()}
}

func (s *Service) Enabled() bool {
	return s != nil && s.cfg.Enabled
}

func (s *Service) Status() string {
	if s == nil || !s.cfg.Enabled {
		return "disabled"
	}
	if s.cfg.TrustID != "" {
		return "pinned trust id"
	}
	if s.cfg.AllowObserved {
		return "observed relays"
	}
	return "trust id required"
}

func (s *Service) ResolveTimeout() time.Duration {
	if s == nil {
		return defaultTimeout
	}
	if s.cfg.Timeout <= 0 {
		return defaultTimeout
	}
	return s.cfg.Timeout
}

func (s *Service) Resolve(ctx context.Context, handle string) (ResolvedHandle, error) {
	if s == nil || !s.cfg.Enabled {
		return ResolvedHandle{}, fmt.Errorf("spaces lookup is disabled")
	}

	handle = normalizeHandle(handle)
	if handle == "" {
		return ResolvedHandle{}, fmt.Errorf("spaces handle is required")
	}
	if !isValidHandle(handle) {
		return ResolvedHandle{}, fmt.Errorf("spaces handle must look like @space or name@space")
	}

	type result struct {
		value ResolvedHandle
		err   error
	}

	done := make(chan result, 1)
	go func() {
		if err := s.init(); err != nil {
			done <- result{err: err}
			return
		}

		resolved, err := s.fabric.Resolve(handle)
		if err != nil {
			done <- result{err: err}
			return
		}

		value, err := s.toResolvedHandle(handle, resolved)
		done <- result{value: value, err: err}
	}()

	select {
	case <-ctx.Done():
		return ResolvedHandle{}, ctx.Err()
	case result := <-done:
		return result.value, result.err
	}
}

func (s *Service) init() error {
	s.mu.Lock()
	defer s.mu.Unlock()

	if s.initialized {
		return s.initErr
	}
	s.initialized = true

	if s.cfg.TrustID == "" && !s.cfg.AllowObserved {
		s.initErr = fmt.Errorf("PIRATE_SPACES_TRUST_ID is required unless PIRATE_SPACES_ALLOW_OBSERVED=1")
		return s.initErr
	}

	f := fabric.New()
	if len(s.cfg.Seeds) > 0 {
		f.SetSeeds(s.cfg.Seeds)
	}
	f.SetHTTPTimeout(s.cfg.Timeout)
	f.SetDevMode(s.cfg.DevMode)
	if s.cfg.TrustID != "" {
		if err := f.Trust(s.cfg.TrustID); err != nil {
			s.initErr = fmt.Errorf("pin spaces trust id: %w", err)
			return s.initErr
		}
	}

	s.fabric = f
	return nil
}

func (s *Service) toResolvedHandle(query string, resolved fabric.Resolved) (ResolvedHandle, error) {
	handle := resolved.Zone.Handle
	space, label := splitHandle(handle)
	raw, err := libveritas.ZoneToJson(resolved.Zone)
	if err != nil {
		return ResolvedHandle{}, fmt.Errorf("encode zone json: %w", err)
	}

	numID := ""
	if resolved.Zone.NumId != nil {
		numID = *resolved.Zone.NumId
	}

	return ResolvedHandle{
		Query:           query,
		CanonicalHandle: handle,
		Space:           space,
		Label:           label,
		Sovereignty:     resolved.Zone.Sovereignty,
		NumID:           numID,
		Roots:           append([]string(nil), resolved.Roots...),
		ZoneJSON:        prettyJSON(raw),
		Verification: VerificationSummary{
			PinnedTrust: s.cfg.TrustID != "",
			TrustSource: s.Status(),
			TrustID:     s.cfg.TrustID,
		},
	}, nil
}

func normalizeHandle(value string) string {
	return strings.TrimSpace(strings.ToLower(value))
}

func isValidHandle(handle string) bool {
	sep := strings.IndexAny(handle, "@#")
	if sep < 0 {
		return false
	}
	return sep < len(handle)-1
}

func splitHandle(handle string) (space, label string) {
	sep := strings.IndexAny(handle, "@#")
	if sep < 0 {
		return handle, ""
	}
	if sep == 0 {
		return handle, ""
	}
	return handle[sep:], handle[:sep]
}

func prettyJSON(value string) string {
	var out bytes.Buffer
	if err := json.Indent(&out, []byte(value), "", "  "); err != nil {
		return value
	}
	return out.String()
}
