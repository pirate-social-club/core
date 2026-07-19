#!/usr/bin/env bash
set -euo pipefail

# Stages a checksummed, immutable full-repository app release from an exact
# commit. The role release independently pins the expected app commit with
# make-release.sh --app-commit.
#
#   make-app-release.sh <output-root> [--commit REF]
#
# Produces <output-root>/app-releases/<commit>/ with deployment metadata and a
# SHA256SUMS manifest covering every archived repository file plus APP_COMMIT.

output_root="${1:?usage: make-app-release.sh <output-root> [--commit REF]}"
shift
commit_ref="HEAD"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --commit) shift; commit_ref="${1:?}" ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
  shift
done

repo_root="$(git rev-parse --show-toplevel)"
commit="$(git -C "$repo_root" rev-parse --verify "$commit_ref^{commit}")"
release_dir="$output_root/app-releases/$commit"
if [[ -e "$release_dir" ]]; then
  echo "app release already exists: $release_dir" >&2
  exit 1
fi

mkdir -p "$release_dir/.pirate-deployment"
git -C "$repo_root" archive "$commit" | tar -x -C "$release_dir"
printf 'APP_COMMIT=%s\n' "$commit" > "$release_dir/.pirate-deployment/DEPLOYMENT"
(
  cd "$release_dir"
  find . -type f ! -path './.pirate-deployment/SHA256SUMS' -print0 \
    | sort -z | xargs -0 sha256sum > .pirate-deployment/SHA256SUMS
)

echo "app release staged: $release_dir"
echo "app commit:         $commit"
