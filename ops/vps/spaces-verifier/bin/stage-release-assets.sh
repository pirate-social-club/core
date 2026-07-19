#!/usr/bin/env bash
set -euo pipefail

readonly RELEASE_DIR="${1:?release directory required}"
readonly PUBLISHER_VERSION="v0.1.4"
readonly PUBLISHER_REPO="pirate-social-club/pirate-spaces-publisher"
readonly ARCHIVE_NAME="spaces-publisher-linux-x64.tar.gz"
readonly ARCHIVE_SHA256="77c72273f0170e077bfd9ba41a6f6248db161ca12b8b1afb19de911ecd008dd3"
readonly BINARY_SHA256="7ecc7942defa967b13dd993ca1694f5d884afd10cc09831b9fbf1d4935aab7ad"
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
