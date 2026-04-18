package main

import (
	"encoding/hex"
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"strings"
)

type resolveOutput struct {
	Handle          string              `json:"handle"`
	CanonicalHandle string              `json:"canonical_handle"`
	RootPubKey      string              `json:"root_pubkey,omitempty"`
	Roots           []string            `json:"roots,omitempty"`
	WebURL          string              `json:"web_url,omitempty"`
	FreedomURL      string              `json:"freedom_url,omitempty"`
	Records         map[string][]string `json:"records,omitempty"`
}

func runResolve(args []string) error {
	filteredArgs, handleArg, err := splitHandleArg(args)
	if err != nil {
		return fmt.Errorf("resolve requires exactly one handle")
	}

	fs := flag.NewFlagSet("resolve", flag.ContinueOnError)
	fs.SetOutput(os.Stderr)

	seedsValue := fs.String("seeds", strings.Join(seedsFrom(os.Getenv("SPACES_FABRIC_SEEDS")), ","), "Comma-separated relay URLs")
	trustID := fs.String("trust-id", "", "Trusted root ID")
	devMode := fs.Bool("dev-mode", false, "Enable dev mode")
	if err := fs.Parse(filteredArgs); err != nil {
		return err
	}
	handle, err := normalizeHandle(handleArg)
	if err != nil {
		return err
	}

	client := newFabricClient(cliConfig{
		seeds:   seedsFrom(*seedsValue),
		trustID: *trustID,
		devMode: *devMode,
	})
	if *trustID != "" {
		if err := client.Trust(*trustID); err != nil {
			return fmt.Errorf("pin trust id: %w", err)
		}
	}

	context, err := resolveHandleContext(client, handle)
	if err != nil {
		return err
	}

	parsed, err := parseZoneRecords(context.Zone)
	if err != nil {
		return err
	}

	output := resolveOutput{
		Handle:          handle,
		CanonicalHandle: context.CanonicalHandle,
		RootPubKey:      hex.EncodeToString(context.RootPubKey),
		Roots:           context.Roots,
		Records:         parsed.txt,
		WebURL:          firstValue(parsed.txt["web"]),
		FreedomURL:      firstValue(parsed.txt["freedom"]),
	}

	return json.NewEncoder(os.Stdout).Encode(output)
}
