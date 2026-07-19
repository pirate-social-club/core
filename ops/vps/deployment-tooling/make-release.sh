#!/usr/bin/env bash
set -euo pipefail

# Stages an immutable release for a VPS role from a CLEAN, exact git commit.
#
#   make-release.sh <role-dir> <output-root> [--expect-running true|false] [--db-path REL]
#
# Example:
#   make-release.sh ops/vps/hns-secondary-dns /tmp/ns2-out --expect-running false \
#     --db-path shared/data/pdns.sqlite3
#
# Produces <output-root>/releases/<core-commit>/ containing the role's tracked
# files, the deployment tooling under bin/, a DEPLOYMENT metadata file, and
# SHA256SUMS covering every file in the release. The operator copies the
# release directory to $DEPLOY_ROOT/releases/ on the host and flips the
# `current` symlink. Configuration and persistent data live outside releases.
#
# Refuses to run from a dirty tree: deployments must map to exact commits.

role_dir="${1:?usage: make-release.sh <role-dir> <output-root> [flags]}"
output_root="${2:?usage: make-release.sh <role-dir> <output-root> [flags]}"
shift 2

expect_running="true"
db_path=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --expect-running) shift; expect_running="${1:?}" ;;
    --db-path) shift; db_path="${1:?}" ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
  shift
done

repo_root="$(git rev-parse --show-toplevel)"
cd "$repo_root"

if [[ ! -d "$role_dir" ]]; then
  echo "role directory not found: $role_dir" >&2
  exit 1
fi

if [[ -n "$(git status --porcelain)" ]]; then
  echo "refusing to build a release from a dirty tree; commit or stash first" >&2
  exit 1
fi

core_commit="$(git rev-parse HEAD)"
release_dir="$output_root/releases/$core_commit"
if [[ -e "$release_dir" ]]; then
  echo "release already exists: $release_dir" >&2
  exit 1
fi
mkdir -p "$release_dir/bin"

# Tracked role files only — anything untracked cannot enter a release.
git ls-files -z -- "$role_dir" | while IFS= read -r -d '' f; do
  rel="${f#"$role_dir"/}"
  mkdir -p "$release_dir/$(dirname "$rel")"
  cp "$f" "$release_dir/$rel"
done

tooling_dir="ops/vps/deployment-tooling"
for script in deployment-status.sh verify-deployment.sh alert-on-failure.sh heartbeat.sh; do
  cp "$tooling_dir/$script" "$release_dir/bin/$script"
  chmod 0755 "$release_dir/bin/$script"
done
mkdir -p "$release_dir/systemd"
cp "$tooling_dir"/systemd/*.service "$tooling_dir"/systemd/*.timer "$release_dir/systemd/"

# A role may stage digest-pinned, generated or downloaded runtime assets into
# its immutable release. The stager is itself tracked at the exact core commit,
# receives only the empty release destination, and must fail closed on any
# provenance or checksum mismatch. Its output is covered by SHA256SUMS below.
asset_stager="$role_dir/bin/stage-release-assets.sh"
if [[ -f "$asset_stager" ]]; then
  if [[ ! -x "$asset_stager" ]]; then
    echo "release asset stager is not executable: $asset_stager" >&2
    exit 1
  fi
  "$repo_root/$asset_stager" "$release_dir"
fi

# Pinned image digest and container name from the role's compose file, if any.
image_digest=""
container_name=""
compose_file="$role_dir/compose.yaml"
if [[ -f "$compose_file" ]]; then
  image_digest="$(grep -Eo 'image:\s*\S+@sha256:[a-f0-9]{64}' "$compose_file" | head -1 | awk '{print $2}' || true)"
  container_name="$(grep -Eo 'container_name:\s*\S+' "$compose_file" | head -1 | awk '{print $2}' || true)"
fi

{
  echo "ROLE=$(basename "$role_dir")"
  echo "CORE_COMMIT=$core_commit"
  [[ -n "$image_digest" ]] && echo "IMAGE_DIGEST=$image_digest"
  [[ -n "$container_name" ]] && echo "CONTAINER_NAME=$container_name"
  echo "EXPECT_RUNNING=$expect_running"
  [[ -n "$db_path" ]] && echo "DB_PATH=$db_path"
  echo "DEPLOYED_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
} > "$release_dir/DEPLOYMENT"

(
  cd "$release_dir"
  find . -type f ! -name SHA256SUMS -print0 | sort -z | xargs -0 sha256sum > SHA256SUMS
)

echo "release staged: $release_dir"
echo "core commit:    $core_commit"
if [[ -n "$image_digest" ]]; then
  echo "image digest:   $image_digest"
fi
