package main

import (
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"regexp"
	"strconv"
	"strings"

	"github.com/btcsuite/btcd/btcec/v2/schnorr"
	"github.com/btcsuite/btcd/btcutil/hdkeychain"
	"github.com/btcsuite/btcd/txscript"
	fabric "github.com/spacesprotocol/fabric-go"
	libveritas "github.com/spacesprotocol/libveritas-go"
)

const defaultMaxDerivationIndex uint = 10000

var privateDescriptorKeyPattern = regexp.MustCompile(`(xprv[1-9A-HJ-NP-Za-km-z]+|tprv[1-9A-HJ-NP-Za-km-z]+)`)

type walletExport struct {
	Descriptor  string `json:"descriptor"`
	Blockheight uint32 `json:"blockheight"`
	Label       string `json:"label"`
}

type parsedWalletDescriptor struct {
	RawDescriptor string
	BaseXPrv      string
	BranchPath    string
	PathSegments  []uint32
}

type resolvedHandleContext struct {
	Handle          string
	CanonicalHandle string
	Roots           []string
	Zone            libveritas.Zone
	RootPubKey      []byte
}

type derivedSigner struct {
	SecretKey       []byte
	MatchedIndex    uint32
	MatchedPubKey   []byte
	CanonicalHandle string
	DescriptorPath  string
	WalletLabel     string
	Blockheight     uint32
}

func resolveHandleContext(client *fabric.Fabric, handle string) (*resolvedHandleContext, error) {
	resolved, err := client.Resolve(handle)
	if err != nil {
		return nil, fmt.Errorf("resolve %s: %w", handle, err)
	}

	rootPubKey, err := extractTaprootKey(resolved.Zone.ScriptPubkey)
	if err != nil {
		return nil, err
	}

	canonicalHandle := resolved.Zone.Canonical
	if canonicalHandle == "" {
		canonicalHandle = handle
	}

	return &resolvedHandleContext{
		Handle:          handle,
		CanonicalHandle: canonicalHandle,
		Roots:           resolved.Roots,
		Zone:            resolved.Zone,
		RootPubKey:      rootPubKey,
	}, nil
}

func extractTaprootKey(scriptPubKey []byte) ([]byte, error) {
	if len(scriptPubKey) != 34 {
		return nil, fmt.Errorf("expected p2tr script pubkey length 34, got %d", len(scriptPubKey))
	}
	if scriptPubKey[0] != txscript.OP_1 || scriptPubKey[1] != txscript.OP_DATA_32 {
		return nil, errors.New("zone script pubkey is not a taproot output")
	}

	pubkey := make([]byte, 32)
	copy(pubkey, scriptPubKey[2:])
	return pubkey, nil
}

func loadWalletExport(path string) (*walletExport, error) {
	payload, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("read wallet export: %w", err)
	}

	var export walletExport
	if err := json.Unmarshal(payload, &export); err != nil {
		return nil, fmt.Errorf("decode wallet export: %w", err)
	}
	if strings.TrimSpace(export.Descriptor) == "" {
		return nil, errors.New("wallet export is missing descriptor")
	}

	return &export, nil
}

func parseWalletDescriptor(raw string) (*parsedWalletDescriptor, error) {
	descriptor := strings.TrimSpace(raw)
	if descriptor == "" {
		return nil, errors.New("descriptor is required")
	}

	if before, _, found := strings.Cut(descriptor, "#"); found {
		descriptor = before
	}

	if !strings.HasPrefix(descriptor, "tr(") || !strings.HasSuffix(descriptor, ")") {
		return nil, errors.New("wallet export descriptor must be a taproot descriptor")
	}

	inner := strings.TrimSuffix(strings.TrimPrefix(descriptor, "tr("), ")")
	if strings.Contains(inner, ",") {
		return nil, errors.New("script tree taproot descriptors are not supported")
	}

	match := privateDescriptorKeyPattern.FindStringIndex(inner)
	if match == nil {
		return nil, errors.New("wallet export descriptor does not contain an xprv/tprv")
	}

	baseXPrv := inner[match[0]:match[1]]
	branchPath := strings.TrimSpace(inner[match[1]:])
	if !strings.HasSuffix(branchPath, "/*") {
		return nil, errors.New("wallet export descriptor must end with a wildcard branch")
	}

	pathWithoutWildcard := strings.TrimSuffix(branchPath, "/*")
	pathSegments, err := parseDerivationPath(pathWithoutWildcard)
	if err != nil {
		return nil, err
	}
	if len(pathSegments) == 0 {
		return nil, errors.New("wallet export descriptor must include an external branch before the wildcard")
	}
	lastSegment := pathSegments[len(pathSegments)-1]
	if lastSegment != 0 {
		return nil, fmt.Errorf("wallet export descriptor must point to the external branch /0/*, got %s", branchPath)
	}

	return &parsedWalletDescriptor{
		RawDescriptor: descriptor,
		BaseXPrv:      baseXPrv,
		BranchPath:    branchPath,
		PathSegments:  pathSegments,
	}, nil
}

func parseDerivationPath(path string) ([]uint32, error) {
	trimmed := strings.TrimSpace(path)
	if trimmed == "" {
		return nil, nil
	}

	parts := strings.Split(strings.TrimPrefix(trimmed, "/"), "/")
	segments := make([]uint32, 0, len(parts))
	for _, part := range parts {
		segment := strings.TrimSpace(part)
		if segment == "" {
			continue
		}

		hardened := strings.HasSuffix(segment, "'") || strings.HasSuffix(strings.ToLower(segment), "h")
		if hardened {
			segment = segment[:len(segment)-1]
		}

		index, err := strconv.ParseUint(segment, 10, 31)
		if err != nil {
			return nil, fmt.Errorf("parse derivation path segment %q: %w", part, err)
		}

		value := uint32(index)
		if hardened {
			value += hdkeychain.HardenedKeyStart
		}
		segments = append(segments, value)
	}

	return segments, nil
}

func deriveSignerFromWalletExport(context *resolvedHandleContext, walletExportPath string, maxIndex uint) (*derivedSigner, error) {
	export, err := loadWalletExport(walletExportPath)
	if err != nil {
		return nil, err
	}

	descriptor, err := parseWalletDescriptor(export.Descriptor)
	if err != nil {
		return nil, err
	}

	baseKey, err := hdkeychain.NewKeyFromString(descriptor.BaseXPrv)
	if err != nil {
		return nil, fmt.Errorf("parse descriptor xprv: %w", err)
	}

	branchKey := baseKey
	for _, child := range descriptor.PathSegments {
		branchKey, err = branchKey.Derive(child)
		if err != nil {
			return nil, fmt.Errorf("derive descriptor path %s: %w", descriptor.BranchPath, err)
		}
	}

	for index := uint32(0); index <= uint32(maxIndex); index++ {
		candidate, err := branchKey.Derive(index)
		if errors.Is(err, hdkeychain.ErrInvalidChild) {
			continue
		}
		if err != nil {
			return nil, fmt.Errorf("derive child %d: %w", index, err)
		}

		internalPrivKey, err := candidate.ECPrivKey()
		if err != nil {
			return nil, fmt.Errorf("derive child private key %d: %w", index, err)
		}
		tweakedPrivKey := txscript.TweakTaprootPrivKey(*internalPrivKey, nil)
		tweakedPubKey := schnorr.SerializePubKey(tweakedPrivKey.PubKey())
		if !equalBytes(tweakedPubKey, context.RootPubKey) {
			continue
		}

		return &derivedSigner{
			SecretKey:       tweakedPrivKey.Serialize(),
			MatchedIndex:    index,
			MatchedPubKey:   append([]byte(nil), tweakedPubKey...),
			CanonicalHandle: context.CanonicalHandle,
			DescriptorPath:  descriptor.BranchPath,
			WalletLabel:     export.Label,
			Blockheight:     export.Blockheight,
		}, nil
	}

	return nil, fmt.Errorf("no external descriptor child matched root pubkey %s within index range 0..%d", hex.EncodeToString(context.RootPubKey), maxIndex)
}

func resolvePublishSecretKey(context *resolvedHandleContext, walletExportPath string, secretKeyHex string, maxIndex uint) ([]byte, *derivedSigner, string, error) {
	walletExportPath = strings.TrimSpace(walletExportPath)
	secretKeyHex = strings.TrimSpace(secretKeyHex)

	switch {
	case walletExportPath != "" && secretKeyHex != "":
		return nil, nil, "", errors.New("provide either --wallet-export or --secret-key, not both")
	case walletExportPath != "":
		signer, err := deriveSignerFromWalletExport(context, walletExportPath, maxIndex)
		if err != nil {
			return nil, nil, "", err
		}
		return signer.SecretKey, signer, "wallet_export", nil
	case secretKeyHex != "":
		secretKey, err := decodeSecretKey(secretKeyHex)
		if err != nil {
			return nil, nil, "", err
		}
		return secretKey, nil, "secret_key", nil
	default:
		return nil, nil, "", errors.New("publish requires either --wallet-export or --secret-key")
	}
}

func equalBytes(left []byte, right []byte) bool {
	if len(left) != len(right) {
		return false
	}
	for index := range left {
		if left[index] != right[index] {
			return false
		}
	}
	return true
}
