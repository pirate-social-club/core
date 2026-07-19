package main

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"os"
	"strings"

	fabric "github.com/spacesprotocol/fabric-go"
)

const maxSignedMessageBytes = 16 << 20

func retainSignedMessage(path string, message []byte) error {
	path = strings.TrimSpace(path)
	if path == "" {
		return nil
	}
	file, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
	if err != nil {
		return fmt.Errorf("create signed message archive: %w", err)
	}
	removeOnFailure := true
	defer func() {
		_ = file.Close()
		if removeOnFailure {
			_ = os.Remove(path)
		}
	}()
	if _, err := file.Write(message); err != nil {
		return fmt.Errorf("write signed message archive: %w", err)
	}
	if err := file.Sync(); err != nil {
		return fmt.Errorf("sync signed message archive: %w", err)
	}
	if err := file.Close(); err != nil {
		return fmt.Errorf("close signed message archive: %w", err)
	}
	removeOnFailure = false
	return nil
}

func loadSignedMessage(path string) ([]byte, error) {
	path = strings.TrimSpace(path)
	if path == "" {
		return nil, fmt.Errorf("message file is required")
	}
	info, err := os.Lstat(path)
	if err != nil {
		return nil, fmt.Errorf("inspect signed message archive: %w", err)
	}
	if !info.Mode().IsRegular() {
		return nil, fmt.Errorf("signed message archive must be a regular file")
	}
	if info.Size() < 1 || info.Size() > maxSignedMessageBytes {
		return nil, fmt.Errorf("signed message archive size must be between 1 and %d bytes", maxSignedMessageBytes)
	}
	message, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("read signed message archive: %w", err)
	}
	if err := fabric.ValidateMessage(message); err != nil {
		return nil, fmt.Errorf("validate signed message archive: %w", err)
	}
	return message, nil
}

func signedMessageDigest(message []byte) string {
	digest := sha256.Sum256(message)
	return hex.EncodeToString(digest[:])
}

func signRetainAndBroadcast(client *fabric.Fabric, cert, records, secretKey []byte, primary bool, outputPath string) (string, bool, error) {
	message, err := client.Sign(cert, records, secretKey, primary)
	if err != nil {
		return "", false, err
	}
	digest := signedMessageDigest(message)
	retained := strings.TrimSpace(outputPath) != ""
	if err := retainSignedMessage(outputPath, message); err != nil {
		return "", false, err
	}
	if err := client.Broadcast(message); err != nil {
		return digest, retained, err
	}
	return digest, retained, nil
}
