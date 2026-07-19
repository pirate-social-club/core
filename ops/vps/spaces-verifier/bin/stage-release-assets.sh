#!/usr/bin/env bash
set -euo pipefail

readonly RELEASE_DIR="${1:?release directory required}"
readonly PUBLISHER_VERSION="v0.1.3"
readonly PUBLISHER_REPO="pirate-social-club/pirate-spaces-publisher"
readonly ARCHIVE_NAME="spaces-publisher-linux-x64.tar.gz"
readonly ARCHIVE_SHA256="d424b43b84ad73dfa0197f67f897adc51cb1d2fba72eb771abc89946464a030a"
readonly BINARY_SHA256="a469607640ce9501f679aeae66ab13d5228e69778049da983a28d6b3b2cde826"
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
