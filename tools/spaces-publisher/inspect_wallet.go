package main

import (
	"encoding/hex"
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"strings"
)

type inspectWalletOutput struct {
	Handle          string  `json:"handle"`
	CanonicalHandle string  `json:"canonical_handle"`
	RootPubKey      string  `json:"root_pubkey"`
	Matched         bool    `json:"matched"`
	MatchedIndex    *uint32 `json:"matched_index,omitempty"`
	MatchedPubKey   string  `json:"matched_pubkey,omitempty"`
	DescriptorPath  string  `json:"descriptor_path,omitempty"`
	WalletLabel     string  `json:"wallet_label,omitempty"`
	Blockheight     *uint32 `json:"wallet_blockheight,omitempty"`
	ScanLimit       uint    `json:"scan_limit"`
}

func runInspectWallet(args []string) error {
	filteredArgs, handleArg, err := splitHandleArg(args)
	if err != nil {
		return fmt.Errorf("inspect-wallet requires exactly one handle")
	}

	fs := flag.NewFlagSet("inspect-wallet", flag.ContinueOnError)
	fs.SetOutput(os.Stderr)

	seedsValue := fs.String("seeds", strings.Join(seedsFrom(os.Getenv("SPACES_FABRIC_SEEDS")), ","), "Comma-separated relay URLs")
	trustID := fs.String("trust-id", "", "Trusted root ID")
	devMode := fs.Bool("dev-mode", false, "Enable dev mode")
	walletExportPath := fs.String("wallet-export", strings.TrimSpace(os.Getenv("SPACES_WALLET_EXPORT")), "Path to local wallet export JSON with private descriptor material")
	maxIndex := fs.Uint("max-index", defaultMaxDerivationIndex, "Maximum external derivation index to scan")
	if err := fs.Parse(filteredArgs); err != nil {
		return err
	}
	if strings.TrimSpace(*walletExportPath) == "" {
		return fmt.Errorf("inspect-wallet requires --wallet-export")
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
	signer, err := deriveSignerFromWalletExport(context, *walletExportPath, *maxIndex)
	if err != nil {
		return err
	}

	return json.NewEncoder(os.Stdout).Encode(inspectWalletOutput{
		Handle:          handle,
		CanonicalHandle: context.CanonicalHandle,
		RootPubKey:      hex.EncodeToString(context.RootPubKey),
		Matched:         true,
		MatchedIndex:    &signer.MatchedIndex,
		MatchedPubKey:   hex.EncodeToString(signer.MatchedPubKey),
		DescriptorPath:  signer.DescriptorPath,
		WalletLabel:     strings.TrimSpace(signer.WalletLabel),
		Blockheight:     &signer.Blockheight,
		ScanLimit:       *maxIndex,
	})
}
