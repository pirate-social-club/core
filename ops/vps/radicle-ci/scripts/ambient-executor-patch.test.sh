#!/usr/bin/env bash
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
role="$(cd "$here/.." && pwd)"
patch_file="$role/patches/ambient-ci-0.16.0-npm-retry.patch"

test -r "$patch_file"
git apply --numstat "$patch_file" >/dev/null
grep -Fq 'diff --git a/src/action_impl/http_get.rs' "$patch_file"

# Local and other non-HTTP lock entries must be ignored before URL parsing.
# Reordering these statements would restore the parse failure seen on a
# package-lock entry such as `file:../../dependency`.
skip_line=$(grep -nF 'if !p.resolved.starts_with("https://")' "$patch_file" \
  | cut -d: -f1)
parse_line=$(grep -nF 'NpmError::UrlParse' "$patch_file" | cut -d: -f1)
[[ -n "$skip_line" && -n "$parse_line" && "$skip_line" -lt "$parse_line" ]]
grep -Fq 'npm_get skipping non-HTTP package {name}' "$patch_file"

# A failed attempt must remove any partial tarball before retrying, and the
# final attempt must preserve the original typed error.
grep -Fq 'let _ = fs::remove_file(&filename);' "$patch_file"
grep -Fq 'if attempt == DOWNLOAD_ATTEMPTS' "$patch_file"
grep -Fq 'return Err(NpmError::HttpGet(url, filename, err));' "$patch_file"
grep -Fq '.checked_pow(attempt - 1)' "$patch_file"
grep -Fq '.unwrap_or(u32::MAX);' "$patch_file"
grep -Fq 'DOWNLOAD_RETRY_BASE_DELAY.saturating_mul(multiplier)' "$patch_file"
grep -Fq 'HTTP_DOWNLOAD_RETRY_BASE_DELAY.saturating_mul(multiplier)' "$patch_file"
grep -Fq 'http_get download attempt {attempt}/{HTTP_DOWNLOAD_ATTEMPTS}' "$patch_file"

# Installation remains pinned to the reviewed Ambient source and records the
# patched artifact hashes used by host drift verification.
grep -Eq '^expected_source_sha256=[0-9a-f]{64}$' \
  "$here/install-ambient-npm-retry"
grep -Eq '^expected_http_source_sha256=[0-9a-f]{64}$' \
  "$here/install-ambient-npm-retry"
grep -Fq 'patch_sha256=' "$here/install-ambient-npm-retry"
grep -Fq 'binary_sha256=' "$here/install-ambient-npm-retry"

echo 'Ambient executor patch tests passed'
