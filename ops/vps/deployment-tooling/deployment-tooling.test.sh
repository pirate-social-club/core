#!/usr/bin/env bash
set -euo pipefail

# Executable harness for the deployment tooling. No docker daemon required:
# docker is shimmed on PATH with canned responses. Covers:
#   1. make-release refuses a dirty tree
#   2. make-release stages role assets and records a separately versioned app
#   3. make-app-release archives and checksums the exact app commit
#   4. make-release succeeds for roles without a container image
#   5. verify passes on a clean role + app deployment
#   6. verify fails on role tamper
#   7. verify fails on app tamper, added files, missing manifest, or repoint
#   8. verify fails when config changes after --record-config
#   9. verify fails when the container runs while EXPECT_RUNNING=false
#  10. verify fails when the current symlink points at the wrong release
#  11. verify passes for a running container whose image digest matches the pin
#  12. alert delivery reads bearer auth from a token file and fails closed when unreadable
#  13. successful verification sends an authenticated role heartbeat

tooling_dir="$(cd "$(dirname "$0")" && pwd)"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

fail() { echo "FAIL: $1" >&2; exit 1; }
pass() { echo "ok: $1"; }

# --- fixture repo with a minimal role ---------------------------------------

repo="$work/repo"
mkdir -p "$repo/ops/vps/demo-role/config" "$repo/ops/vps/no-image-role" "$repo/ops/vps/deployment-tooling"
cp "$tooling_dir"/*.sh "$repo/ops/vps/deployment-tooling/"
cp -r "$tooling_dir/systemd" "$repo/ops/vps/deployment-tooling/systemd"
cat > "$repo/ops/vps/demo-role/compose.yaml" <<'EOF'
services:
  demo:
    image: example/demo@sha256:1111111111111111111111111111111111111111111111111111111111111111
    container_name: pirate-demo-role
EOF
echo "setting=1" > "$repo/ops/vps/demo-role/config/demo.conf.example"
echo "no container image" > "$repo/ops/vps/no-image-role/README.md"
mkdir -p "$repo/ops/vps/demo-role/bin"
cat > "$repo/ops/vps/demo-role/bin/stage-release-assets.sh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
release_dir="${1:?release directory required}"
printf '%s\n' 'fixture runtime asset' > "$release_dir/bin/demo-helper"
chmod 0755 "$release_dir/bin/demo-helper"
EOF
chmod +x "$repo/ops/vps/demo-role/bin/stage-release-assets.sh"
git -C "$repo" init -q
git -C "$repo" -c user.email=t@t -c user.name=t add -A
git -C "$repo" -c user.email=t@t -c user.name=t commit -qm "fixture"
commit="$(git -C "$repo" rev-parse HEAD)"

make_release() {
  (cd "$repo" && bash ops/vps/deployment-tooling/make-release.sh \
    ops/vps/demo-role "$@" --app-commit "$commit")
}

# 1. dirty-tree refusal
echo dirty > "$repo/ops/vps/demo-role/scratch.txt"
if make_release "$work/dirty-out" --expect-running false >/dev/null 2>&1; then
  fail "make-release accepted a dirty tree"
fi
rm "$repo/ops/vps/demo-role/scratch.txt"
pass "make-release refuses dirty tree"

# 2. staged release shape
make_release "$work/deploy" --expect-running false >/dev/null
release="$work/deploy/releases/$commit"
[[ -f "$release/DEPLOYMENT" && -f "$release/SHA256SUMS" && -x "$release/bin/deployment-status.sh" ]] \
  || fail "release layout incomplete"
[[ -x "$release/bin/demo-helper" ]] || fail "role-provided runtime asset was not staged"
grep -q 'bin/demo-helper$' "$release/SHA256SUMS" || fail "runtime asset omitted from SHA256SUMS"
grep -q "^CORE_COMMIT=$commit$" "$release/DEPLOYMENT" || fail "DEPLOYMENT missing commit"
grep -q "^APP_COMMIT=$commit$" "$release/DEPLOYMENT" || fail "DEPLOYMENT missing app commit"
grep -q "^IMAGE_DIGEST=example/demo@sha256:1111" "$release/DEPLOYMENT" || fail "DEPLOYMENT missing digest"
grep -q "^CONTAINER_NAME=pirate-demo-role$" "$release/DEPLOYMENT" || fail "DEPLOYMENT missing container"
pass "make-release stages role assets and records app commit"

# 3. separately versioned app release
(cd "$repo" && bash ops/vps/deployment-tooling/make-app-release.sh "$work/deploy" \
  --commit "$commit") >/dev/null
app_release="$work/deploy/app-releases/$commit"
[[ -f "$app_release/.pirate-deployment/DEPLOYMENT" \
  && -f "$app_release/.pirate-deployment/SHA256SUMS" ]] \
  || fail "app release metadata incomplete"
grep -q "^APP_COMMIT=$commit$" "$app_release/.pirate-deployment/DEPLOYMENT" \
  || fail "app release metadata missing commit"
(cd "$app_release" && sha256sum --check --quiet .pirate-deployment/SHA256SUMS) \
  || fail "staged app release checksums do not verify"
pass "make-app-release archives and checksums exact commit"

# 4. roles without a compose image still complete successfully
(cd "$repo" && bash ops/vps/deployment-tooling/make-release.sh \
  ops/vps/no-image-role "$work/no-image-deploy" --expect-running true) >/dev/null \
  || fail "make-release returned failure after staging a no-image role"
pass "make-release succeeds for roles without a container image"

# --- docker shim -------------------------------------------------------------

shim="$work/shim"
mkdir -p "$shim"
cat > "$shim/docker" <<'EOF'
#!/usr/bin/env bash
state_file="${DOCKER_SHIM_STATE:?}"
state="$(cat "$state_file")"
case "$1 $2" in
  "inspect --format")
    if [[ "$state" == "absent" ]]; then exit 1; fi
    if [[ "$4" == img-1 ]]; then
      # image inspect for RepoDigests
      echo "example/demo@sha256:${DOCKER_SHIM_DIGEST:?}"
    else
      echo "$state 2026-07-17T16:00:00Z img-1"
    fi
    ;;
  "image inspect")
    echo "example/demo@sha256:${DOCKER_SHIM_DIGEST:?}"
    ;;
  *) exit 1 ;;
esac
EOF
chmod +x "$shim/docker"
export PATH="$shim:$PATH"
export DOCKER_SHIM_STATE="$work/docker-state"
export DOCKER_SHIM_DIGEST="1111111111111111111111111111111111111111111111111111111111111111"
echo absent > "$DOCKER_SHIM_STATE"

deploy_root="$work/deploy"
ln -s "releases/$commit" "$deploy_root/current"
ln -s "app-releases/$commit" "$deploy_root/app"
mkdir -p "$deploy_root/config"
echo "PRIMARY_DNS_IP=203.0.113.7" > "$deploy_root/config/demo.env"
runtime_tool="$work/runtime-tool"
echo "trusted runtime" > "$runtime_tool"
sha256sum "$runtime_tool" > "$deploy_root/config/RUNTIME_SHA256SUMS"

status() { bash "$deploy_root/current/bin/deployment-status.sh" --deploy-root "$deploy_root" "$@"; }

# 5. clean pre-launch verify (container absent, EXPECT_RUNNING=false)
status --record-config >/dev/null
status --verify >/dev/null || fail "clean pre-launch deployment reported drift"
clean_status="$(status)"
grep -q "drift:   none" <<< "$clean_status" || fail "status did not report drift: none"
grep -q "desired: app  $commit" <<< "$clean_status" \
  || fail "status omitted desired app commit: $clean_status"
grep -q "app:     $commit checksums OK" <<< "$clean_status" \
  || fail "status omitted app integrity: $clean_status"
grep -q "runtime: 1 host executables checksums OK" <<< "$clean_status" \
  || fail "status omitted host runtime integrity: $clean_status"
pass "verify reports and passes clean role + app deployment"

echo tampered >> "$runtime_tool"
status --verify >/dev/null 2>&1 && fail "host runtime executable tamper not detected"
echo "trusted runtime" > "$runtime_tool"
status --verify >/dev/null || fail "restored host runtime executable still drifting"
pass "verify detects host runtime executable tamper"

# 6. tracked role-file tamper
echo tampered >> "$release/compose.yaml"
status --verify >/dev/null 2>&1 && fail "checksum tamper not detected"
git -C "$repo" show "HEAD:ops/vps/demo-role/compose.yaml" > "$release/compose.yaml"
status --verify >/dev/null || fail "restore after tamper still drifting"
pass "verify fails on tracked role-file modification"

# 7. app integrity and symlink checks
app_test_file="$app_release/ops/vps/no-image-role/README.md"
echo tampered >> "$app_test_file"
status --verify >/dev/null 2>&1 && fail "app checksum tamper not detected"
git -C "$repo" show "HEAD:ops/vps/no-image-role/README.md" > "$app_test_file"
status --verify >/dev/null || fail "app restore after tamper still drifting"

echo injected > "$app_release/untracked-runtime-file"
status --verify >/dev/null 2>&1 && fail "added app file not detected"
rm "$app_release/untracked-runtime-file"

mv "$app_release/.pirate-deployment/SHA256SUMS" "$work/app-SHA256SUMS"
status --verify >/dev/null 2>&1 && fail "missing app manifest not detected"
mv "$work/app-SHA256SUMS" "$app_release/.pirate-deployment/SHA256SUMS"

old_app="$deploy_root/app-releases/0000000000000000000000000000000000000000"
cp -r "$app_release" "$old_app"
ln -sfn "app-releases/0000000000000000000000000000000000000000" "$deploy_root/app"
status --verify >/dev/null 2>&1 && fail "app symlink repoint not detected"
ln -sfn "app-releases/$commit" "$deploy_root/app"
status --verify >/dev/null || fail "restored app symlink still drifting"
pass "verify detects app tamper, added files, missing manifest, and repoint"

# 8. config drift
echo "PRIMARY_DNS_IP=198.51.100.9" > "$deploy_root/config/demo.env"
status --verify >/dev/null 2>&1 && fail "config drift not detected"
status --record-config >/dev/null
status --verify >/dev/null || fail "re-recorded config still drifting"
pass "verify fails on unrecorded config change"

# 9. unexpected running container
echo running > "$DOCKER_SHIM_STATE"
status --verify >/dev/null 2>&1 && fail "unexpected running container not detected"
pass "verify fails when container runs while EXPECT_RUNNING=false"

# 10. role symlink mismatch
echo absent > "$DOCKER_SHIM_STATE"
mkdir -p "$deploy_root/releases/deadbeef"
cp -r "$release/." "$deploy_root/releases/deadbeef/"
ln -sfn "releases/deadbeef" "$deploy_root/current"
status --verify >/dev/null 2>&1 && fail "symlink/commit mismatch not detected"
ln -sfn "releases/$commit" "$deploy_root/current"
pass "verify fails on current-symlink mismatch"

# 11. expected running container with matching digest
sed -i 's/^EXPECT_RUNNING=false$/EXPECT_RUNNING=true/' "$release/DEPLOYMENT"
(cd "$release" && find . -type f ! -name SHA256SUMS -print0 | sort -z | xargs -0 sha256sum > SHA256SUMS)
echo running > "$DOCKER_SHIM_STATE"
status --verify >/dev/null || fail "matching running deployment reported drift"
export DOCKER_SHIM_DIGEST="2222222222222222222222222222222222222222222222222222222222222222"
status --verify >/dev/null 2>&1 && fail "digest mismatch not detected"
pass "verify checks running image digest against the pin"

# 12. scoped alert bearer token
cat > "$shim/curl" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "$@" > "${CURL_SHIM_ARGS:?}"
EOF
chmod +x "$shim/curl"
export CURL_SHIM_ARGS="$work/curl-args"
token_file="$work/edge-alert-token"
printf '%s\n' 'test-only-bearer-token-at-least-32-characters' > "$token_file"
OPS_ALERT_WEBHOOK_URL=https://api.example/internal/hns-edge-alerts \
OPS_ALERT_BEARER_TOKEN_FILE="$token_file" \
  bash "$tooling_dir/alert-on-failure.sh" pirate-deployment-verify@observer.service >/dev/null
grep -Fxq 'authorization: Bearer test-only-bearer-token-at-least-32-characters' "$CURL_SHIM_ARGS" \
  || fail "alert request omitted bearer token from token file"
if OPS_ALERT_WEBHOOK_URL=https://api.example/internal/hns-edge-alerts \
  OPS_ALERT_BEARER_TOKEN_FILE="$work/missing-token" \
  bash "$tooling_dir/alert-on-failure.sh" pirate-deployment-verify@observer.service >/dev/null 2>&1; then
  fail "alert delivery accepted an unreadable bearer token file"
fi
pass "alert delivery reads scoped bearer token and fails closed"

# 13. successful verification heartbeat
export DOCKER_SHIM_DIGEST="1111111111111111111111111111111111111111111111111111111111111111"
DEPLOY_ROOT="$deploy_root" \
OPS_ALERT_WEBHOOK_URL=https://api.example/internal/hns-edge-alerts \
OPS_ALERT_BEARER_TOKEN_FILE="$token_file" \
  bash "$deploy_root/current/bin/verify-deployment.sh" >/dev/null \
  || fail "successful verification did not deliver heartbeat"
grep -Fxq 'authorization: Bearer test-only-bearer-token-at-least-32-characters' "$CURL_SHIM_ARGS" \
  || fail "heartbeat request omitted bearer token"
grep -q '"kind":"heartbeat"' "$CURL_SHIM_ARGS" \
  || fail "heartbeat request omitted heartbeat payload"
grep -q "\"role\":\"demo-role\"" "$CURL_SHIM_ARGS" \
  || fail "heartbeat request omitted deployment role"
pass "successful verification sends authenticated role heartbeat"

echo "all deployment-tooling checks passed"
