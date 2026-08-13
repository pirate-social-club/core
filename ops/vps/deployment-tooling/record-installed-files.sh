#!/usr/bin/env bash
set -euo pipefail

tooling_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
source "$tooling_dir/systemd-unit-hash.sh"

# Records the complete set of role-owned files installed outside the immutable
# release, then refreshes CONFIG_SHA256 so the manifest itself is protected.

deploy_root=""
systemd_units=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --deploy-root) shift; deploy_root="${1:-}" ;;
    --systemd-unit) shift; systemd_units+=("${1:-}") ;;
    --) shift; break ;;
    -*) echo "unknown argument: $1" >&2; exit 2 ;;
    *) break ;;
  esac
  shift
done

if [[ -z "$deploy_root" || $# -eq 0 ]]; then
  echo "usage: record-installed-files.sh --deploy-root DIR /absolute/file [...]" >&2
  exit 2
fi

config_dir="$deploy_root/config"
status_script="$deploy_root/current/bin/deployment-status.sh"
if [[ ! -d "$config_dir" ]]; then
  echo "deployment config directory not found: $config_dir" >&2
  exit 1
fi
if [[ ! -x "$status_script" ]]; then
  echo "deployment status script not found: $status_script" >&2
  exit 1
fi

paths=()
for path in "$@"; do
  if [[ "$path" != /* || "$path" == *$'\n'* || "$path" == *$'\r'* \
    || "$path" == *'\'* || "$path" == *'/../'* || "$path" == *'/./'* ]]; then
    echo "installed file path must be an absolute single-line path: $path" >&2
    exit 2
  fi
  if [[ ! -f "$path" ]]; then
    echo "installed file not found: $path" >&2
    exit 1
  fi
  # Preserve the installed path rather than its current symlink target. A later
  # repoint must make verification read the new target and detect the change.
  paths+=("$path")
  if inferred_unit="$(systemd_unit_from_installed_path "$path")"; then
    systemd_units+=("$inferred_unit")
  fi
done

for unit in "${systemd_units[@]}"; do
  if ! systemd_unit_is_valid "$unit"; then
    echo "invalid systemd unit name: $unit" >&2
    exit 2
  fi
done

if ((${#systemd_units[@]} > 0)); then
  mapfile -t systemd_units < <(printf '%s\n' "${systemd_units[@]}" | sort -u)
else
  systemd_units=()
fi

umask 077
manifest="$config_dir/INSTALLED_SHA256SUMS"
tmp="$(mktemp "$config_dir/.INSTALLED_SHA256SUMS.XXXXXX")"
systemd_manifest="$config_dir/SYSTEMD_UNIT_SHA256SUMS"
systemd_tmp=""
if ((${#systemd_units[@]} > 0)); then
  systemd_tmp="$(mktemp "$config_dir/.SYSTEMD_UNIT_SHA256SUMS.XXXXXX")"
  for unit in "${systemd_units[@]}"; do
    if ! unit_hash="$(systemd_unit_hash "$unit")" || [[ ! "$unit_hash" =~ ^[a-f0-9]{64}$ ]]; then
      echo "could not hash effective systemd unit: $unit" >&2
      exit 1
    fi
    printf '%s  %s\n' "$unit_hash" "$unit" >> "$systemd_tmp"
  done
fi
trap 'rm -f "$tmp" "$systemd_tmp"' EXIT

printf '%s\n' "${paths[@]}" | sort -u | while IFS= read -r path; do
  sha256sum -- "$path"
done > "$tmp"
mv -f "$tmp" "$manifest"
if [[ -n "$systemd_tmp" ]]; then
  mv -f "$systemd_tmp" "$systemd_manifest"
else
  rm -f "$systemd_manifest"
fi
trap - EXIT

"$status_script" --deploy-root "$deploy_root" --record-config
echo "recorded installed file manifest $manifest"
