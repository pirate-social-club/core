#!/usr/bin/env bash
set -euo pipefail

# Match the exact Spaces source revision used by the native verifier proof code.
readonly SPACES_REPO="https://github.com/spacesprotocol/spaces.git"
readonly SPACES_COMMIT="9eb78628318ac1892a82c6275108e7de0cdc7403"
readonly DESTINATION="${1:-/srv/pirate-spaces/bin/spaced-${SPACES_COMMIT:0:7}}"

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

git clone --filter=blob:none --no-checkout "$SPACES_REPO" "$work/spaces"
git -C "$work/spaces" checkout --detach "$SPACES_COMMIT"
[[ "$(git -C "$work/spaces" rev-parse HEAD)" == "$SPACES_COMMIT" ]]

cargo build --locked --release \
  --manifest-path "$work/spaces/Cargo.toml" \
  --package spaces_client \
  --bin spaced

install -D -m 0755 "$work/spaces/target/release/spaced" "$DESTINATION"
"$DESTINATION" --version
