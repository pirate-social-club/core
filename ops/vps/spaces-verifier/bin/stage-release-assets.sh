#!/usr/bin/env bash
set -euo pipefail

readonly RELEASE_DIR="${1:?release directory required}"
readonly PUBLISHER_VERSION="v0.1.2"
readonly PUBLISHER_REPO="pirate-social-club/pirate-spaces-publisher"
readonly ARCHIVE_NAME="spaces-publisher-linux-x64.tar.gz"
readonly ARCHIVE_SHA256="59f85de472a6aecbaae084b315fa7f5dcd90f45140575a3330397892c14a8020"
readonly BINARY_SHA256="54f76f4b5b4b011d708716cdb2905e8599b43a46ddfda8e79f5d8c07f23aa48f"
readonly DOWNLOAD_URL="https://github.com/${PUBLISHER_REPO}/releases/download/${PUBLISHER_VERSION}/${ARCHIVE_NAME}"

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
