package main

import (
	"testing"

	libveritas "github.com/spacesprotocol/libveritas-go"
)

func TestParseZoneRecordsExposesHighestSequence(t *testing.T) {
	recordSet, err := libveritas.RecordSetPack([]libveritas.Record{
		libveritas.RecordSeq{Version: 9},
		libveritas.RecordTxt{Key: "web", Value: []string{"https://example.test"}},
	})
	if err != nil {
		t.Fatalf("pack records: %v", err)
	}
	defer recordSet.Destroy()

	parsed, err := parseZoneRecords(libveritas.Zone{Records: recordSet.ToBytes()})
	if err != nil {
		t.Fatalf("parse records: %v", err)
	}
	if parsed.sequence != 9 {
		t.Fatalf("expected sequence 9, got %d", parsed.sequence)
	}
}
