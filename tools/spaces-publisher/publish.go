package main

import (
	"encoding/hex"
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"strings"
)

type publishOutput struct {
	Published      bool    `json:"published"`
	DryRun         bool    `json:"dry_run,omitempty"`
	Handle         string  `json:"handle"`
	WebURL         string  `json:"web_url,omitempty"`
	FreedomURL     string  `json:"freedom_url,omitempty"`
	Sequence       uint64  `json:"sequence"`
	Primary        bool    `json:"primary"`
	AuthMode       string  `json:"auth_mode,omitempty"`
	MatchedIndex   *uint32 `json:"matched_index,omitempty"`
	MatchedPubKey  string  `json:"matched_pubkey,omitempty"`
	DescriptorPath string  `json:"descriptor_path,omitempty"`
	WalletLabel    string  `json:"wallet_label,omitempty"`
	Blockheight    *uint32 `json:"wallet_blockheight,omitempty"`
}

func runPublish(args []string) error {
	filteredArgs, handleArg, err := splitHandleArg(args)
	if err != nil {
		return fmt.Errorf("publish requires exactly one handle")
	}

	fs := flag.NewFlagSet("publish", flag.ContinueOnError)
	fs.SetOutput(os.Stderr)

	seedsValue := fs.String("seeds", strings.Join(seedsFrom(os.Getenv("SPACES_FABRIC_SEEDS")), ","), "Comma-separated relay URLs")
	trustID := fs.String("trust-id", "", "Trusted root ID")
	devMode := fs.Bool("dev-mode", false, "Enable dev mode")
	webURL := fs.String("web", "", "Canonical website URL")
	freedomURL := fs.String("freedom", "", "Freedom-specific website URL")
	var txtRecords stringListFlag
	fs.Var(&txtRecords, "txt", "TXT record as key=value (repeatable)")
	walletExportPath := fs.String("wallet-export", strings.TrimSpace(os.Getenv("SPACES_WALLET_EXPORT")), "Path to local wallet export JSON with private descriptor material")
	secretKeyHex := fs.String("secret-key", strings.TrimSpace(os.Getenv("SPACES_SECRET_KEY_HEX")), "Pre-tweaked 32-byte hex secret key")
	maxIndex := fs.Uint("max-index", defaultMaxDerivationIndex, "Maximum external derivation index to scan when using --wallet-export")
	primary := fs.Bool("primary", true, "Set the published recordset as primary")
	dryRun := fs.Bool("dry-run", false, "Validate signer and record updates without publishing")
	if err := fs.Parse(filteredArgs); err != nil {
		return err
	}
	handle, err := normalizeHandle(handleArg)
	if err != nil {
		return err
	}
	if strings.TrimSpace(*webURL) == "" && strings.TrimSpace(*freedomURL) == "" && len(txtRecords) == 0 {
		return fmt.Errorf("publish requires at least one of --web, --freedom, or --txt")
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
	existing, err := parseZoneRecords(context.Zone)
	if err != nil {
		return err
	}
	secretKey, signer, authMode, err := resolvePublishSecretKey(context, *walletExportPath, *secretKeyHex, *maxIndex)
	if err != nil {
		return err
	}

	if trimmed := strings.TrimSpace(*webURL); trimmed != "" {
		existing.txt["web"] = []string{trimmed}
	}
	if trimmed := strings.TrimSpace(*freedomURL); trimmed != "" {
		existing.txt["freedom"] = []string{trimmed}
	}
	for _, entry := range txtRecords {
		key, value, ok := strings.Cut(entry, "=")
		key = strings.TrimSpace(key)
		value = strings.TrimSpace(value)
		if !ok || key == "" || value == "" {
			return fmt.Errorf("--txt must be key=value")
		}
		existing.txt[key] = append(existing.txt[key], value)
	}

	recordBytes, nextSeq, err := buildRecordSet(existing)
	if err != nil {
		return err
	}
	output := publishOutput{
		Published:  !*dryRun,
		DryRun:     *dryRun,
		Handle:     handle,
		WebURL:     firstValue(existing.txt["web"]),
		FreedomURL: firstValue(existing.txt["freedom"]),
		Sequence:   nextSeq,
		Primary:    *primary,
		AuthMode:   authMode,
	}
	if signer != nil {
		output.MatchedIndex = &signer.MatchedIndex
		output.MatchedPubKey = hex.EncodeToString(signer.MatchedPubKey)
		output.DescriptorPath = signer.DescriptorPath
		output.WalletLabel = strings.TrimSpace(signer.WalletLabel)
		output.Blockheight = &signer.Blockheight
	}
	if *dryRun {
		return json.NewEncoder(os.Stdout).Encode(output)
	}
	cert, err := client.Export(handle)
	if err != nil {
		return fmt.Errorf("export certificate chain: %w", err)
	}
	if err := client.Publish(cert, recordBytes, secretKey, *primary); err != nil {
		return fmt.Errorf("publish records: %w", err)
	}

	return json.NewEncoder(os.Stdout).Encode(output)
}

func runClear(args []string) error {
	filteredArgs, handleArg, err := splitHandleArg(args)
	if err != nil {
		return fmt.Errorf("clear requires exactly one handle")
	}

	fs := flag.NewFlagSet("clear", flag.ContinueOnError)
	fs.SetOutput(os.Stderr)

	seedsValue := fs.String("seeds", strings.Join(seedsFrom(os.Getenv("SPACES_FABRIC_SEEDS")), ","), "Comma-separated relay URLs")
	trustID := fs.String("trust-id", "", "Trusted root ID")
	devMode := fs.Bool("dev-mode", false, "Enable dev mode")
	walletExportPath := fs.String("wallet-export", strings.TrimSpace(os.Getenv("SPACES_WALLET_EXPORT")), "Path to local wallet export JSON with private descriptor material")
	secretKeyHex := fs.String("secret-key", strings.TrimSpace(os.Getenv("SPACES_SECRET_KEY_HEX")), "Pre-tweaked 32-byte hex secret key")
	maxIndex := fs.Uint("max-index", defaultMaxDerivationIndex, "Maximum external derivation index to scan when using --wallet-export")
	primary := fs.Bool("primary", true, "Set the published recordset as primary")
	dryRun := fs.Bool("dry-run", false, "Validate signer and record updates without publishing")
	var clearKeys stringListFlag
	fs.Var(&clearKeys, "key", "Record key to clear (repeatable)")
	if err := fs.Parse(filteredArgs); err != nil {
		return err
	}
	if len(clearKeys) == 0 {
		return fmt.Errorf("clear requires at least one --key")
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
	existing, err := parseZoneRecords(context.Zone)
	if err != nil {
		return err
	}
	secretKey, signer, authMode, err := resolvePublishSecretKey(context, *walletExportPath, *secretKeyHex, *maxIndex)
	if err != nil {
		return err
	}

	for _, key := range clearKeys {
		delete(existing.txt, strings.TrimSpace(key))
	}

	recordBytes, nextSeq, err := buildRecordSet(existing)
	if err != nil {
		return err
	}
	output := publishOutput{
		Published:  !*dryRun,
		DryRun:     *dryRun,
		Handle:     handle,
		WebURL:     firstValue(existing.txt["web"]),
		FreedomURL: firstValue(existing.txt["freedom"]),
		Sequence:   nextSeq,
		Primary:    *primary,
		AuthMode:   authMode,
	}
	if signer != nil {
		output.MatchedIndex = &signer.MatchedIndex
		output.MatchedPubKey = hex.EncodeToString(signer.MatchedPubKey)
		output.DescriptorPath = signer.DescriptorPath
		output.WalletLabel = strings.TrimSpace(signer.WalletLabel)
		output.Blockheight = &signer.Blockheight
	}
	if *dryRun {
		return json.NewEncoder(os.Stdout).Encode(output)
	}
	cert, err := client.Export(handle)
	if err != nil {
		return fmt.Errorf("export certificate chain: %w", err)
	}
	if err := client.Publish(cert, recordBytes, secretKey, *primary); err != nil {
		return fmt.Errorf("publish records: %w", err)
	}

	return json.NewEncoder(os.Stdout).Encode(output)
}
