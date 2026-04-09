#!/usr/bin/env bash
set -euo pipefail

branch_name="${1:-core-web-split}"
repo_root="$(git rev-parse --show-toplevel)"

cd "$repo_root"

if [[ ! -d pirate-web ]]; then
  echo "expected pirate-web/ in repo root" >&2
  exit 1
fi

if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "working tree is not clean; commit or stash changes before subtree split" >&2
  exit 1
fi

if git show-ref --verify --quiet "refs/heads/$branch_name"; then
  echo "branch already exists: $branch_name" >&2
  exit 1
fi

echo "creating subtree split branch: $branch_name" >&2
git subtree split --prefix=pirate-web -b "$branch_name"
echo "created branch: $branch_name" >&2
