package main

import (
	"os"
	"path/filepath"
	"runtime"
	"testing"
)

func TestRetainSignedMessageWritesExactExclusivePrivateFile(t *testing.T) {
	path := filepath.Join(t.TempDir(), "publication.fabric-message")
	want := []byte{0x01, 0x02, 0x03, 0x04}
	if err := retainSignedMessage(path, want); err != nil {
		t.Fatalf("retain: %v", err)
	}
	got, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read retained message: %v", err)
	}
	if string(got) != string(want) {
		t.Fatalf("retained bytes changed: got %x want %x", got, want)
	}
	if runtime.GOOS != "windows" {
		info, err := os.Stat(path)
		if err != nil {
			t.Fatalf("stat retained message: %v", err)
		}
		if info.Mode().Perm() != 0o600 {
			t.Fatalf("retained mode = %o, want 600", info.Mode().Perm())
		}
	}
	if err := retainSignedMessage(path, []byte{0xff}); err == nil {
		t.Fatal("expected an existing archive to be preserved, not overwritten")
	}
	got, err = os.ReadFile(path)
	if err != nil || string(got) != string(want) {
		t.Fatalf("exclusive create changed existing archive: got %x err=%v", got, err)
	}
}

func TestLoadSignedMessageRejectsUnsafeOrInvalidInput(t *testing.T) {
	dir := t.TempDir()
	if _, err := loadSignedMessage(""); err == nil {
		t.Fatal("expected empty path rejection")
	}
	if _, err := loadSignedMessage(dir); err == nil {
		t.Fatal("expected directory rejection")
	}
	path := filepath.Join(dir, "invalid.fabric-message")
	if err := os.WriteFile(path, []byte("not a Fabric message"), 0o600); err != nil {
		t.Fatalf("write invalid fixture: %v", err)
	}
	if _, err := loadSignedMessage(path); err == nil {
		t.Fatal("expected structurally invalid message rejection")
	}
}

func TestSignedMessageDigestIsStable(t *testing.T) {
	const want = "039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81"
	if got := signedMessageDigest([]byte{1, 2, 3}); got != want {
		t.Fatalf("digest = %s, want %s", got, want)
	}
}
