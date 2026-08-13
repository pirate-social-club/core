#!/usr/bin/env bash
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
role="$(cd "$here/.." && pwd)"
patch_file="$role/patches/ambient-ci-0.16.0-npm-retry.patch"
adapter_patch_file="$role/patches/radicle-ci-ambient-0.21.1-bun-get.patch"
artifacts="$role/rebuild-artifacts.yaml"

test -r "$patch_file"
test -r "$adapter_patch_file"
test -r "$artifacts"
git apply --numstat "$patch_file" >/dev/null
grep -Fq 'diff --git a/src/action_impl/http_get.rs' "$patch_file"
grep -Fq 'diff --git a/src/action_impl/bun.rs' "$patch_file"
grep -Fq 'BunGet' "$patch_file"
grep -Fq '=> "bun_get"' "$patch_file"

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
grep -Fq 'manifest.tsv' "$patch_file"
grep -Fq '"file:", "workspace:", "link:"' "$patch_file"
grep -Fq 'bun_get download attempt {attempt}/{DOWNLOAD_ATTEMPTS}' "$patch_file"
grep -Fq 'package_url(&name, &version)' "$patch_file"
grep -Fq 'cache_version' "$patch_file"
grep -Fq 'd301056781780760' "$patch_file"

# The adapter must be built against the same patched Ambient crate; otherwise
# it rejects bun_get before the isolated guest starts.
grep -Fq 'diff --git a/Cargo.toml b/Cargo.toml' "$adapter_patch_file"
grep -Fq '[patch.crates-io]' "$adapter_patch_file"
grep -Fq 'ambient-ci = { path = "../ambient-ci" }' "$adapter_patch_file"
grep -Fq 'name = "ambient-ci"' "$adapter_patch_file"
grep -Fq 'source = "registry+https://github.com/rust-lang/crates.io-index"' \
  "$adapter_patch_file"

# Installation remains pinned to the reviewed Ambient source and records the
# patched artifact hashes used by host drift verification.
grep -Eq '^expected_source_sha256=[0-9a-f]{64}$' \
  "$here/install-ambient-npm-retry"
grep -Eq '^expected_http_source_sha256=[0-9a-f]{64}$' \
  "$here/install-ambient-npm-retry"
grep -Eq '^expected_action_source_sha256=[0-9a-f]{64}$' \
  "$here/install-ambient-npm-retry"
grep -Eq '^expected_action_impl_source_sha256=[0-9a-f]{64}$' \
  "$here/install-ambient-npm-retry"
grep -Fq 'patch_sha256=' "$here/install-ambient-npm-retry"
grep -Fq 'binary_sha256=' "$here/install-ambient-npm-retry"
grep -Eq '^expected_adapter_cargo_toml_sha256=[0-9a-f]{64}$' \
  "$here/install-ambient-npm-retry"
grep -Eq '^expected_adapter_cargo_lock_sha256=[0-9a-f]{64}$' \
  "$here/install-ambient-npm-retry"
grep -Fq 'adapter_patch_sha256=' "$here/install-ambient-npm-retry"
grep -Fq 'adapter_binary_sha256=' "$here/install-ambient-npm-retry"
grep -Fq 'ambient_cli_binary_sha256=' "$here/install-ambient-npm-retry"
grep -Fq -- '--bin ambient' "$here/install-ambient-npm-retry"

# Rebuild provenance must stay explicit and bind the immutable archives to the
# reviewed public artifacts.
grep -Fq 'source_url: https://files.liw.fi/ambient/ambient.qcow2.xz' "$artifacts"
grep -Fq 'decompressed_sha256: e0e13e9e2d0225cbcb69a6f4f44d6136e9ca50a9a355295c07c90d173840b293' "$artifacts"
grep -Fq 'crate_sha256: 051d8698eac84847b56b8f39577ef186b2816ecf0fca073434ea62d67913f80a' "$artifacts"
[[ $(grep -c 'status: verified' "$artifacts") -eq 2 ]]
grep -Fq 'bucket: pirate-radicle-ci-artifacts' "$artifacts"
grep -Fq 'compressed_sha256: 25b457df9d389559170cf79e955ec68d0306b320fff8f4c36d8d4225bcc2855a' "$artifacts"
grep -Fq 'reassembly_order: ascending_part_number' "$artifacts"
[[ $(grep -c '^      - number:' "$artifacts") -eq 8 ]]
grep -Fq 'key: artifacts/ambient-ci/0.16.0/ambient-ci-0.16.0.crate' "$artifacts"

echo 'Ambient executor patch tests passed'
