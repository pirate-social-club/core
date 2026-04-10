package main

import (
	"errors"
	"flag"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"strings"
	"time"

	"pirate-tui/internal/netx"
)

func main() {
	target := flag.String("url", "", "URL to fetch through pirate-tui's network stack")
	timeout := flag.Duration("timeout", 20*time.Second, "request timeout")
	bodyLimit := flag.Int64("body-limit", 512, "max response body bytes to print")
	wait := flag.Duration("wait-for-ready", 0, "wait for hnsd sync before fetching")
	flag.Parse()

	if strings.TrimSpace(*target) == "" {
		log.Fatal("hns-smoke: pass -url")
	}

	logger := log.New(os.Stderr, "", 0)
	cfg := netx.LoadHNSConfigFromEnv().WithBaseURL(*target)
	client, closer, err := netx.NewHTTPClient(*timeout, cfg, logger)
	if err != nil {
		log.Fatalf("hns-smoke network setup: %v", err)
	}
	defer closer.Close()

	if *wait > 0 {
		waiter, ok := closer.(interface{ WaitUntilReady(time.Duration) error })
		if !ok {
			log.Fatalf("hns-smoke: wait-for-ready requested but HNS mode is disabled")
		}
		if err := waiter.WaitUntilReady(*wait); err != nil {
			log.Fatalf("hns-smoke ready wait: %v", err)
		}
	}

	req, err := http.NewRequest(http.MethodGet, *target, nil)
	if err != nil {
		log.Fatalf("hns-smoke request: %v", err)
	}

	resp, err := client.Do(req)
	if err != nil {
		if errors.Is(err, netx.ErrHNSSyncing()) {
			log.Fatalf("hns-smoke fetch: %v; retry later or use -wait-for-ready", err)
		}
		log.Fatalf("hns-smoke fetch: %v", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(io.LimitReader(resp.Body, *bodyLimit))
	if err != nil {
		log.Fatalf("hns-smoke read body: %v", err)
	}

	fmt.Printf("status: %s\n", resp.Status)
	fmt.Printf("url: %s\n", resp.Request.URL.String())
	fmt.Printf("content-type: %s\n", resp.Header.Get("Content-Type"))
	fmt.Println()
	fmt.Print(string(body))
	if len(body) > 0 && body[len(body)-1] != '\n' {
		fmt.Println()
	}
}
