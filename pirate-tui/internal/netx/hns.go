package netx

import (
	"bufio"
	"crypto/tls"
	"crypto/x509"
	"errors"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/buffrr/letsdane"
	"github.com/buffrr/letsdane/resolver"
)

const (
	defaultRootAddr      = "127.0.0.1:9591"
	defaultRecursiveAddr = "127.0.0.1:9592"
	startProbeWindow     = 300 * time.Millisecond
	defaultCloseTimeout  = 2 * time.Second
	defaultSyncQuietTime = 20 * time.Second
)

var processExitWaitTimeout = defaultCloseTimeout
var syncQuietTime = defaultSyncQuietTime
var errHNSSyncing = errors.New("hnsd is still syncing")

func ErrHNSSyncing() error {
	return errHNSSyncing
}

type HNSSyncStatus struct {
	Enabled        bool
	Synced         bool
	Height         uint64
	LastProgressAt time.Time
	Error          error
}

type HNSSyncStatusProvider interface {
	HNSSyncStatus() HNSSyncStatus
}

type HNSConfig struct {
	Enabled       bool
	HNSDPath      string
	RootAddr      string
	RecursiveAddr string
	ProxyHosts    []string
	UserAgent     string
}

func LoadHNSConfigFromEnv() HNSConfig {
	return HNSConfig{
		Enabled:       envEnabled("PIRATE_ENABLE_HNS"),
		HNSDPath:      strings.TrimSpace(os.Getenv("PIRATE_HNSD_PATH")),
		RootAddr:      envOrDefault("PIRATE_HNS_ROOT_ADDR", defaultRootAddr),
		RecursiveAddr: envOrDefault("PIRATE_HNS_RECURSIVE_ADDR", defaultRecursiveAddr),
		ProxyHosts:    parseProxyHosts(os.Getenv("PIRATE_HNS_PROXY_HOSTS")),
		UserAgent:     envOrDefault("PIRATE_HNS_USER_AGENT", "pirate-tui"),
	}
}

func (c HNSConfig) WithBaseURL(baseURL string) HNSConfig {
	if len(c.ProxyHosts) > 0 {
		c.ProxyHosts = normalizeProxyHosts(c.ProxyHosts)
		return c
	}

	u, err := url.Parse(strings.TrimSpace(baseURL))
	if err != nil {
		return c
	}

	host := normalizeHost(u.Hostname())
	if host == "" || isLoopbackHost(host) {
		return c
	}

	c.ProxyHosts = []string{host}
	return c
}

func NewHTTPClient(timeout time.Duration, cfg HNSConfig, logger *log.Logger) (*http.Client, io.Closer, error) {
	if !cfg.Enabled {
		return &http.Client{Timeout: timeout}, noopCloser{}, nil
	}

	runtime, err := startHNSRuntime(cfg, logger)
	if err != nil {
		return nil, nil, err
	}

	return runtime.HTTPClient(timeout), runtime, nil
}

type hnsRuntime struct {
	hnsd     *hnsdProc
	server   *http.Server
	listener net.Listener
	proxyURL *url.URL
	ca       *x509.Certificate
	hosts    []string
	state    runtimeState
}

type runtimeState struct {
	mu  sync.RWMutex
	err error
}

func startHNSRuntime(cfg HNSConfig, logger *log.Logger) (*hnsRuntime, error) {
	hnsdPath, err := resolveHNSDPath(cfg.HNSDPath)
	if err != nil {
		return nil, err
	}

	hnsd, err := startHNSD(hnsdPath, cfg, logger)
	if err != nil {
		return nil, err
	}

	stub, err := resolver.NewStub(cfg.RecursiveAddr)
	if err != nil {
		hnsd.Close()
		return nil, fmt.Errorf("create hns stub resolver: %w", err)
	}

	ca, priv, err := letsdane.NewAuthority("PIRATE TUI DNSSEC", "Pirate", 24*time.Hour, nil)
	if err != nil {
		hnsd.Close()
		return nil, fmt.Errorf("create letsdane authority: %w", err)
	}

	handler, err := (&letsdane.Config{
		Certificate:    ca,
		PrivateKey:     priv,
		Validity:       time.Hour,
		Resolver:       stub,
		SkipNameChecks: false,
		Verbose:        false,
	}).NewHandler()
	if err != nil {
		hnsd.Close()
		return nil, fmt.Errorf("create letsdane handler: %w", err)
	}

	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		hnsd.Close()
		return nil, fmt.Errorf("listen for letsdane proxy: %w", err)
	}

	proxyURL, err := url.Parse("http://" + listener.Addr().String())
	if err != nil {
		listener.Close()
		hnsd.Close()
		return nil, fmt.Errorf("parse proxy url: %w", err)
	}

	server := &http.Server{Handler: handler}
	serverErr := make(chan error, 1)
	go func() {
		err := server.Serve(listener)
		if err != nil && !errors.Is(err, http.ErrServerClosed) {
			serverErr <- err
			if logger != nil {
				logger.Printf("pirate-tui: letsdane proxy stopped: %v", err)
			}
		}
		close(serverErr)
	}()

	select {
	case err := <-serverErr:
		listener.Close()
		hnsd.Close()
		if err != nil {
			return nil, fmt.Errorf("start letsdane proxy: %w", err)
		}
	case <-time.After(startProbeWindow):
	}

	runtime := &hnsRuntime{
		hnsd:     hnsd,
		server:   server,
		listener: listener,
		proxyURL: proxyURL,
		ca:       ca,
		hosts:    normalizeProxyHosts(cfg.ProxyHosts),
	}

	go runtime.watchHNSD()
	go runtime.watchProxy(serverErr, logger)

	return runtime, nil
}

func (r *hnsRuntime) HTTPClient(timeout time.Duration) *http.Client {
	roots, err := x509.SystemCertPool()
	if err != nil || roots == nil {
		roots = x509.NewCertPool()
	}
	roots.AddCert(r.ca)

	// Clone isolates this client from future mutations to the process-wide default transport.
	transport := http.DefaultTransport.(*http.Transport).Clone()
	transport.Proxy = func(req *http.Request) (*url.URL, error) {
		if !shouldProxyRequest(req, r.hosts) {
			return nil, nil
		}
		if err := r.syncErr(); err != nil {
			return nil, err
		}
		if err := r.err(); err != nil {
			return nil, err
		}
		return r.proxyURL, nil
	}
	transport.TLSClientConfig = &tls.Config{
		MinVersion: tls.VersionTLS12,
		RootCAs:    roots,
	}

	return &http.Client{
		Timeout:   timeout,
		Transport: transport,
	}
}

func (r *hnsRuntime) Close() error {
	var errs []error
	if r.server != nil {
		if err := r.server.Close(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			errs = append(errs, err)
		}
	}
	if r.listener != nil {
		if err := r.listener.Close(); err != nil && !errors.Is(err, net.ErrClosed) {
			errs = append(errs, err)
		}
	}
	if r.hnsd != nil {
		if err := r.hnsd.Close(); err != nil {
			errs = append(errs, err)
		}
	}
	return errors.Join(errs...)
}

func (r *hnsRuntime) WaitUntilReady(timeout time.Duration) error {
	if r.hnsd == nil {
		return nil
	}
	return r.hnsd.WaitUntilSynced(timeout)
}

func (r *hnsRuntime) HNSSyncStatus() HNSSyncStatus {
	status := HNSSyncStatus{Enabled: r.hnsd != nil}
	if r.hnsd != nil {
		status.Height = r.hnsd.Height()
		status.LastProgressAt = r.hnsd.LastProgressAt()
		status.Synced = r.hnsd.Synced()
	}
	status.Error = r.err()
	return status
}

func (r *hnsRuntime) watchHNSD() {
	if r.hnsd == nil {
		return
	}
	<-r.hnsd.done
	if err := r.hnsd.exitErr(); err != nil && !errors.Is(err, errProcessStopped) {
		r.setErr(fmt.Errorf("hnsd unavailable: %w", err))
	}
}

func (r *hnsRuntime) watchProxy(serverErr <-chan error, logger *log.Logger) {
	err, ok := <-serverErr
	if !ok || err == nil {
		return
	}
	if logger != nil {
		logger.Printf("pirate-tui: disabling HNS proxy after proxy failure: %v", err)
	}
	r.setErr(fmt.Errorf("letsdane proxy unavailable: %w", err))
}

func (r *hnsRuntime) setErr(err error) {
	r.state.mu.Lock()
	defer r.state.mu.Unlock()
	if r.state.err == nil {
		r.state.err = err
	}
}

func (r *hnsRuntime) err() error {
	r.state.mu.RLock()
	defer r.state.mu.RUnlock()
	return r.state.err
}

func (r *hnsRuntime) syncErr() error {
	if r.hnsd == nil || r.hnsd.Synced() {
		return nil
	}

	height := r.hnsd.Height()
	if height == 0 {
		return errHNSSyncing
	}

	return fmt.Errorf("%w (current height %d)", errHNSSyncing, height)
}

type hnsdProc struct {
	cmd        *exec.Cmd
	done       chan struct{}
	mu         sync.Mutex
	stopped    bool
	processErr error
	height     uint64
	lastHeight time.Time
	synced     bool
}

func startHNSD(binaryPath string, cfg HNSConfig, logger *log.Logger) (*hnsdProc, error) {
	args := []string{
		"--ns-host", cfg.RootAddr,
		"--rs-host", cfg.RecursiveAddr,
		"--pool-size", "4",
	}
	if cfg.UserAgent != "" {
		args = append(args, "--user-agent", cfg.UserAgent)
	}

	cmd := exec.Command(binaryPath, args...)
	pipe, err := cmd.StdoutPipe()
	if err != nil {
		return nil, fmt.Errorf("open hnsd stdout: %w", err)
	}
	cmd.Stderr = cmd.Stdout

	if err := cmd.Start(); err != nil {
		return nil, fmt.Errorf("start hnsd: %w", err)
	}

	proc := &hnsdProc{
		cmd:  cmd,
		done: make(chan struct{}),
	}

	go proc.monitor(pipe)

	select {
	case <-proc.done:
		return nil, fmt.Errorf("hnsd exited during startup: %w", proc.exitErr())
	case <-time.After(startProbeWindow):
		return proc, nil
	}
}

func (p *hnsdProc) monitor(pipe io.ReadCloser) {
	scanner := bufio.NewScanner(pipe)
	for scanner.Scan() {
		line := scanner.Text()
		if height, ok := parseHNSDHeight(line); ok {
			p.setHeight(height)
		}
	}

	err := p.cmd.Wait()
	if scanErr := scanner.Err(); scanErr != nil && err == nil {
		err = scanErr
	}
	if err == nil {
		err = errProcessStopped
	}
	p.mu.Lock()
	p.processErr = err
	p.mu.Unlock()
	close(p.done)
}

var errProcessStopped = errors.New("process stopped")

func (p *hnsdProc) Close() error {
	p.mu.Lock()
	if p.stopped {
		p.mu.Unlock()
		return nil
	}
	p.stopped = true
	p.mu.Unlock()

	if p.cmd != nil && p.cmd.Process != nil {
		if err := p.cmd.Process.Kill(); err != nil && !errors.Is(err, os.ErrProcessDone) {
			return err
		}
	}

	select {
	case <-p.done:
		err := p.exitErr()
		if err == nil || errors.Is(err, errProcessStopped) || strings.Contains(err.Error(), "killed") {
			return nil
		}
		return err
	case <-time.After(processExitWaitTimeout):
		return fmt.Errorf("timed out waiting for hnsd to stop after %s", processExitWaitTimeout)
	}
}

type noopCloser struct{}

func (noopCloser) Close() error {
	return nil
}

func shouldProxyRequest(req *http.Request, proxyHosts []string) bool {
	if req == nil || req.URL == nil {
		return false
	}

	host := normalizeHost(req.URL.Hostname())
	if host == "" || isLoopbackHost(host) {
		return false
	}

	for _, candidate := range normalizeProxyHosts(proxyHosts) {
		if host == candidate || strings.HasSuffix(host, "."+candidate) {
			return true
		}
	}

	return false
}

func (p *hnsdProc) exitErr() error {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.processErr
}

func (p *hnsdProc) Height() uint64 {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.height
}

func (p *hnsdProc) LastProgressAt() time.Time {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.lastHeight
}

func (p *hnsdProc) Synced() bool {
	p.mu.Lock()
	defer p.mu.Unlock()

	if p.synced {
		return true
	}

	p.synced = !p.lastHeight.IsZero() && time.Since(p.lastHeight) > syncQuietTime
	return p.synced
}

func (p *hnsdProc) WaitUntilSynced(timeout time.Duration) error {
	deadline := time.Now().Add(timeout)
	for {
		if err := p.exitErr(); err != nil {
			return err
		}
		if p.Synced() {
			return nil
		}
		if timeout > 0 && time.Now().After(deadline) {
			height := p.Height()
			if height == 0 {
				return fmt.Errorf("timed out waiting for hnsd sync after %s", timeout)
			}
			return fmt.Errorf("timed out waiting for hnsd sync after %s (current height %d)", timeout, height)
		}

		select {
		case <-p.done:
			if err := p.exitErr(); err != nil {
				return err
			}
			return errProcessStopped
		case <-time.After(500 * time.Millisecond):
		}
	}
}

func (p *hnsdProc) setHeight(height uint64) {
	p.mu.Lock()
	defer p.mu.Unlock()
	if height <= p.height {
		return
	}

	p.height = height
	p.lastHeight = time.Now()
	p.synced = false
}

func parseHNSDHeight(line string) (uint64, bool) {
	const prefix = "chain ("
	if !strings.HasPrefix(line, prefix) {
		return 0, false
	}

	end := strings.IndexByte(line[len(prefix):], ')')
	if end == -1 {
		return 0, false
	}

	value := line[len(prefix) : len(prefix)+end]
	height, err := strconv.ParseUint(value, 10, 64)
	if err != nil {
		return 0, false
	}

	return height, true
}

func resolveHNSDPath(explicit string) (string, error) {
	if explicit != "" {
		return existingFile(explicit)
	}

	candidates := []string{
		"hnsd",
		filepath.Join("fingertip", "builds", "linux", "appdir", "usr", "bin", "hnsd"),
		filepath.Join("pirate-tui", "fingertip", "builds", "linux", "appdir", "usr", "bin", "hnsd"),
		filepath.Join("fingertip", "builds", "macos", "Fingertip.app", "Contents", "MacOS", "hnsd"),
		filepath.Join("pirate-tui", "fingertip", "builds", "macos", "Fingertip.app", "Contents", "MacOS", "hnsd"),
	}

	for _, candidate := range candidates {
		if candidate == "hnsd" {
			if path, err := exec.LookPath(candidate); err == nil {
				return path, nil
			}
			continue
		}

		if path, err := existingFile(candidate); err == nil {
			return path, nil
		}

		// Dev convenience: also check relative to the current executable, since CWD is unstable.
		if exePath, err := os.Executable(); err == nil {
			if path, err := existingFile(filepath.Join(filepath.Dir(exePath), candidate)); err == nil {
				return path, nil
			}
		}
	}

	return "", fmt.Errorf("hnsd binary not found; set PIRATE_HNSD_PATH or install hnsd on PATH")
}

func normalizeHost(host string) string {
	return strings.TrimSpace(strings.ToLower(strings.TrimSuffix(host, ".")))
}

func isLoopbackHost(host string) bool {
	host = normalizeHost(host)
	if host == "" {
		return false
	}
	if host == "localhost" || strings.HasSuffix(host, ".localhost") {
		return true
	}
	if ip := net.ParseIP(host); ip != nil {
		return ip.IsLoopback()
	}
	return false
}

func parseProxyHosts(value string) []string {
	if strings.TrimSpace(value) == "" {
		return nil
	}

	return normalizeProxyHosts(strings.Split(value, ","))
}

func normalizeProxyHosts(hosts []string) []string {
	seen := make(map[string]struct{}, len(hosts))
	out := make([]string, 0, len(hosts))
	for _, host := range hosts {
		host = normalizeHost(host)
		if host == "" || isLoopbackHost(host) {
			continue
		}
		if _, ok := seen[host]; ok {
			continue
		}
		seen[host] = struct{}{}
		out = append(out, host)
	}
	return out
}

func existingFile(path string) (string, error) {
	info, err := os.Stat(path)
	if err != nil {
		return "", err
	}
	if info.IsDir() {
		return "", fmt.Errorf("%s is a directory", path)
	}
	return path, nil
}

func envOrDefault(key, fallback string) string {
	value := strings.TrimSpace(os.Getenv(key))
	if value == "" {
		return fallback
	}
	return value
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
