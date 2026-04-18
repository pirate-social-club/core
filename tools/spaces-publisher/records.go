package main

import (
	"encoding/hex"
	"errors"
	"fmt"
	"slices"
	"strings"

	fabric "github.com/spacesprotocol/fabric-go"
	libveritas "github.com/spacesprotocol/libveritas-go"
	"golang.org/x/text/unicode/norm"
)

type cliConfig struct {
	seeds   []string
	trustID string
	devMode bool
}

type parsedZoneRecords struct {
	sequence uint64
	txt      map[string][]string
	others   []libveritas.Record
}

type stringListFlag []string

func (f *stringListFlag) String() string {
	return strings.Join(*f, ",")
}

func (f *stringListFlag) Set(value string) error {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return errors.New("value cannot be empty")
	}
	*f = append(*f, trimmed)
	return nil
}

func normalizeHandle(value string) (string, error) {
	trimmed := strings.TrimSpace(value)
	match := strings.TrimPrefix(trimmed, "@")
	if match == "" {
		return "", errors.New("handle must be a root label like @pirate")
	}
	if strings.ContainsAny(match, " \t\r\n/?#:@") {
		return "", errors.New("handle must be a root label like @pirate")
	}
	return "@" + strings.ToLower(norm.NFKC.String(strings.TrimSpace(match))), nil
}

func newFabricClient(config cliConfig) *fabric.Fabric {
	client := fabric.New()
	if len(config.seeds) > 0 {
		client.SetSeeds(config.seeds)
	}
	client.SetDevMode(config.devMode)
	return client
}

func seedsFrom(value string) []string {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return nil
	}
	parts := strings.Split(trimmed, ",")
	out := make([]string, 0, len(parts))
	for _, part := range parts {
		if seed := strings.TrimSpace(part); seed != "" {
			out = append(out, seed)
		}
	}
	return out
}

func decodeSecretKey(hexValue string) ([]byte, error) {
	trimmed := strings.TrimSpace(hexValue)
	if trimmed == "" {
		return nil, errors.New("secret key is required")
	}
	decoded, err := hex.DecodeString(trimmed)
	if err != nil {
		return nil, fmt.Errorf("decode secret key: %w", err)
	}
	if len(decoded) != 32 {
		return nil, fmt.Errorf("secret key must be 32 bytes, got %d", len(decoded))
	}
	return decoded, nil
}

func copyStrings(values []string) []string {
	if len(values) == 0 {
		return nil
	}
	out := make([]string, len(values))
	copy(out, values)
	return out
}

func parseZoneRecords(zone libveritas.Zone) (*parsedZoneRecords, error) {
	result := &parsedZoneRecords{
		txt:    make(map[string][]string),
		others: make([]libveritas.Record, 0),
	}
	if len(zone.Records) == 0 {
		return result, nil
	}

	recordSet := libveritas.NewRecordSet(zone.Records)
	defer recordSet.Destroy()

	records, err := recordSet.Unpack()
	if err != nil {
		return nil, fmt.Errorf("unpack records: %w", err)
	}

	for _, parsed := range records {
		switch value := parsed.(type) {
		case libveritas.ParsedRecordSeq:
			if value.Version > result.sequence {
				result.sequence = value.Version
			}
		case libveritas.ParsedRecordTxt:
			result.txt[value.Key] = copyStrings(value.Value)
		case libveritas.ParsedRecordAddr:
			result.others = append(result.others, libveritas.RecordAddr{
				Key:   value.Key,
				Value: copyStrings(value.Value),
			})
		case libveritas.ParsedRecordBlob:
			result.others = append(result.others, libveritas.RecordBlob{
				Key:   value.Key,
				Value: append([]byte(nil), value.Value...),
			})
		case libveritas.ParsedRecordSig:
			continue
		case libveritas.ParsedRecordMalformed:
			return nil, fmt.Errorf("cannot safely republish malformed record type %d", value.Rtype)
		case libveritas.ParsedRecordUnknown:
			result.others = append(result.others, libveritas.RecordUnknown{
				Rtype: value.Rtype,
				Rdata: append([]byte(nil), value.Rdata...),
			})
		default:
			return nil, fmt.Errorf("unsupported parsed record type %T", parsed)
		}
	}

	return result, nil
}

func buildRecordSet(existing *parsedZoneRecords) ([]byte, uint64, error) {
	nextSequence := existing.sequence + 1
	records := make([]libveritas.Record, 0, 1+len(existing.txt)+len(existing.others))
	records = append(records, libveritas.RecordSeq{Version: nextSequence})

	txtKeys := make([]string, 0, len(existing.txt))
	for key := range existing.txt {
		txtKeys = append(txtKeys, key)
	}
	slices.Sort(txtKeys)
	for _, key := range txtKeys {
		values := existing.txt[key]
		if len(values) == 0 {
			continue
		}
		records = append(records, libveritas.RecordTxt{
			Key:   key,
			Value: copyStrings(values),
		})
	}

	records = append(records, existing.others...)
	recordSet, err := libveritas.RecordSetPack(records)
	if err != nil {
		return nil, 0, fmt.Errorf("pack record set: %w", err)
	}
	defer recordSet.Destroy()

	return recordSet.ToBytes(), nextSequence, nil
}

func firstValue(values []string) string {
	for _, value := range values {
		if trimmed := strings.TrimSpace(value); trimmed != "" {
			return trimmed
		}
	}
	return ""
}
