#!/usr/bin/env bash
set -euo pipefail

readonly RELEASE_DIR="${1:?release directory required}"
readonly PUBLISHER_VERSION="v0.1.5"
readonly PUBLISHER_REPO="pirate-social-club/pirate-spaces-publisher"
readonly ARCHIVE_NAME="spaces-publisher-linux-x64.tar.gz"
readonly ARCHIVE_SHA256="a34de454c71715e76eae6738150b5e6af5d80796f7d6905c6ddd8644c48bdeb6"
readonly BINARY_SHA256="e343c56e50880d11d2d0652f73923abdbb446db6b6e7af3dd903502c527a557c"
readonly DOWNLOAD_URL="https://github.com/${PUBLISHER_REPO}/releases/download/${PUBLISHER_VERSION}/${ARCHIVE_NAME}"
readonly REPO_ROOT="$(git rev-parse --show-toplevel)"

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

curl --fail --location --silent --show-error "$DOWNLOAD_URL" -o "$work/$ARCHIVE_NAME"
echo "$ARCHIVE_SHA256  $work/$ARCHIVE_NAME" | sha256sum -c -

mkdir -p "$work/extracted"
tar -C "$work/extracted" -xzf "$work/$ARCHIVE_NAME"
test -f "$work/extracted/spaces-publisher"
echo "$BINARY_SHA256  $work/extracted/spaces-publisher" | sha256sum -c -

install -D -m 0755 "$work/extracted/spaces-publisher" "$RELEASE_DIR/bin/spaces-publisher"
install -D -m 0644 \
  "$work/extracted/licenses/spaces-publisher-AGPL-3.0-or-later.txt" \
  "$RELEASE_DIR/licenses/spaces-publisher-AGPL-3.0-or-later.txt"

CARGO_TARGET_DIR="$work/native-target" cargo build --locked --release \
  --manifest-path "$REPO_ROOT/services/verifier/spaces/native/Cargo.toml"
install -D -m 0755 \
  "$work/native-target/release/spaces-verifier-native" \
  "$RELEASE_DIR/bin/spaces-verifier-native"
