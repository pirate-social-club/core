package main

import (
	"errors"
	"fmt"
	"os"
	"strings"
)

func main() {
	if len(os.Args) < 2 {
		printUsage()
		os.Exit(1)
	}

	var err error
	switch os.Args[1] {
	case "resolve":
		err = runResolve(os.Args[2:])
	case "inspect-wallet":
		err = runInspectWallet(os.Args[2:])
	case "publish":
		err = runPublish(os.Args[2:])
	case "clear":
		err = runClear(os.Args[2:])
	case "-h", "--help", "help":
		printUsage()
		return
	default:
		err = fmt.Errorf("unknown subcommand: %s", os.Args[1])
	}

	if err != nil {
		fmt.Fprintf(os.Stderr, "error: %s\n", err)
		os.Exit(1)
	}
}

func printUsage() {
	fmt.Print(`Usage:
  spaces-publisher resolve @handle [--seeds url,url] [--trust-id hex] [--dev-mode]
  spaces-publisher inspect-wallet @handle --wallet-export ~/safe/wallet.json [--max-index 10000]
  spaces-publisher publish @handle --web https://example.com [--freedom https://example/] [--txt key=value] [--wallet-export ~/safe/wallet.json | --secret-key hex] [--dry-run]
  spaces-publisher clear @handle --key web [--key freedom] [--wallet-export ~/safe/wallet.json | --secret-key hex] [--dry-run]

Conventions:
  - Txt("web", ...) is the canonical website target
  - Txt("freedom", ...) is the Freedom-specific override

Environment:
  SPACES_WALLET_EXPORT      Local wallet export JSON path
  SPACES_SECRET_KEY_HEX     Pre-tweaked 32-byte BIP-340 private key for advanced publish/clear
  SPACES_FABRIC_SEEDS       Optional comma-separated relay URLs

Security:
  Wallet export JSON contains private descriptor material. Keep it local and never upload it to the VPS.

Examples:
  spaces-publisher inspect-wallet @pirate --wallet-export ~/safe/pirate-wallet.json
  spaces-publisher publish @pirate --wallet-export ~/safe/pirate-wallet.json --web https://pirate.sc/ --dry-run
`)
}

func splitHandleArg(args []string) ([]string, string, error) {
	filtered := make([]string, 0, len(args))
	handle := ""

	for _, arg := range args {
		if strings.HasPrefix(strings.TrimSpace(arg), "@") {
			if handle != "" {
				return nil, "", errors.New("expected exactly one handle")
			}
			handle = arg
			continue
		}
		filtered = append(filtered, arg)
	}

	if handle == "" {
		return nil, "", errors.New("expected exactly one handle")
	}

	return filtered, handle, nil
}
