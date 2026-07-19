package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"strings"
)

type rebroadcastOutput struct {
	Rebroadcasted bool   `json:"rebroadcasted"`
	MessageSHA256 string `json:"message_sha256"`
}

func runRebroadcast(args []string) error {
	fs := flag.NewFlagSet("rebroadcast", flag.ContinueOnError)
	fs.SetOutput(os.Stderr)
	messageFile := fs.String("message-file", "", "Previously retained signed Fabric message")
	seedsValue := fs.String("seeds", strings.Join(seedsFrom(os.Getenv("SPACES_FABRIC_SEEDS")), ","), "Comma-separated relay URLs")
	trustID := fs.String("trust-id", "", "Trusted root ID")
	devMode := fs.Bool("dev-mode", false, "Enable dev mode")
	if err := fs.Parse(args); err != nil {
		return err
	}
	if fs.NArg() != 0 {
		return fmt.Errorf("rebroadcast does not accept positional arguments")
	}
	message, err := loadSignedMessage(*messageFile)
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
	if err := client.Broadcast(message); err != nil {
		return fmt.Errorf("rebroadcast signed message: %w", err)
	}
	return json.NewEncoder(os.Stdout).Encode(rebroadcastOutput{
		Rebroadcasted: true,
		MessageSHA256: signedMessageDigest(message),
	})
}
