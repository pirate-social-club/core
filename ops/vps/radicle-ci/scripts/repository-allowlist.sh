#!/usr/bin/env bash

repository_allowlist_path() {
  if [[ -n "${RADICLE_CI_REPOSITORIES_FILE:-}" ]]; then
    printf '%s\n' "$RADICLE_CI_REPOSITORIES_FILE"
    return
  fi
  local script_dir tracked
  script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  tracked="$script_dir/../config/repositories"
  if [[ -f "$tracked" ]]; then
    printf '%s\n' "$tracked"
  else
    printf '%s\n' /etc/pirate-radicle/repositories
  fi
}

load_repository_allowlist() {
  local file=${1:-$(repository_allowlist_path)} line_number=0 rid name extra
  declare -ga RADICLE_CI_RIDS=()
  declare -gA RADICLE_CI_REPOSITORY_NAMES=()

  if [[ ! -r "$file" ]]; then
    echo "repository allowlist is not readable: $file" >&2
    return 1
  fi
  while read -r rid name extra; do
    line_number=$((line_number + 1))
    [[ -n "$rid" && "$rid" != \#* ]] || continue
    if [[ -z "$name" || -n "$extra" \
      || ! "$rid" =~ ^rad:z[1-9A-HJ-NP-Za-km-z]+$ \
      || ! "$name" =~ ^[a-z0-9][a-z0-9-]*$ ]]; then
      echo "invalid repository allowlist entry at $file:$line_number" >&2
      return 1
    fi
    if [[ -n "${RADICLE_CI_REPOSITORY_NAMES[$rid]+present}" ]]; then
      echo "duplicate RID in repository allowlist: $rid" >&2
      return 1
    fi
    RADICLE_CI_RIDS+=("$rid")
    RADICLE_CI_REPOSITORY_NAMES["$rid"]=$name
  done < "$file"
  if (( ${#RADICLE_CI_RIDS[@]} == 0 )); then
    echo "repository allowlist is empty: $file" >&2
    return 1
  fi
}

repository_name() {
  local rid=$1
  [[ -n "${RADICLE_CI_REPOSITORY_NAMES[$rid]+present}" ]] || return 1
  printf '%s\n' "${RADICLE_CI_REPOSITORY_NAMES[$rid]}"
}
