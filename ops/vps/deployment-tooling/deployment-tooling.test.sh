#!/usr/bin/env bash
set -euo pipefail

# Executable harness for the deployment tooling. No docker daemon required:
# docker is shimmed on PATH with canned responses. Covers:
#   1. make-release refuses a dirty tree
#   2. make-release stages role-provided assets inside the checksummed release
#   3. verify passes on a clean pre-launch deployment (EXPECT_RUNNING=false)
#   4. verify fails when a tracked release file is modified
#   5. verify fails when config changes after --record-config
#   6. verify fails when the container runs while EXPECT_RUNNING=false
#   7. verify fails when the current symlink points at the wrong release
#   8. verify passes for a running container whose image digest matches the pin
#   9. alert delivery reads bearer auth from a token file and fails closed when unreadable
#  10. successful verification sends an authenticated role heartbeat

tooling_dir="$(cd "$(dirname "$0")" && pwd)"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

fail() { echo "FAIL: $1" >&2; exit 1; }
pass() { echo "ok: $1"; }

# --- fixture repo with a minimal role ---------------------------------------

repo="$work/repo"
mkdir -p "$repo/ops/vps/demo-role/config" "$repo/ops/vps/deployment-tooling"
cp "$tooling_dir"/*.sh "$repo/ops/vps/deployment-tooling/"
cp -r "$tooling_dir/systemd" "$repo/ops/vps/deployment-tooling/systemd"
cat > "$repo/ops/vps/demo-role/compose.yaml" <<'EOF'
services:
  demo:
    image: example/demo@sha256:1111111111111111111111111111111111111111111111111111111111111111
    container_name: pirate-demo-role
EOF
echo "setting=1" > "$repo/ops/vps/demo-role/config/demo.conf.example"
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
  (cd "$repo" && bash ops/vps/deployment-tooling/make-release.sh ops/vps/demo-role "$@")
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
grep -q "^IMAGE_DIGEST=example/demo@sha256:1111" "$release/DEPLOYMENT" || fail "DEPLOYMENT missing digest"
grep -q "^CONTAINER_NAME=pirate-demo-role$" "$release/DEPLOYMENT" || fail "DEPLOYMENT missing container"
pass "make-release stages role assets in checksummed release"

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
mkdir -p "$deploy_root/config"
echo "PRIMARY_DNS_IP=203.0.113.7" > "$deploy_root/config/demo.env"

status() { bash "$deploy_root/current/bin/deployment-status.sh" --deploy-root "$deploy_root" "$@"; }

# 3. clean pre-launch verify (container absent, EXPECT_RUNNING=false)
status --record-config >/dev/null
status --verify >/dev/null || fail "clean pre-launch deployment reported drift"
status | grep -q "drift:   none" || fail "status did not report drift: none"
pass "verify passes on clean pre-launch deployment"

# 4. tracked-file tamper
echo tampered >> "$release/compose.yaml"
status --verify >/dev/null 2>&1 && fail "checksum tamper not detected"
git -C "$repo" show "HEAD:ops/vps/demo-role/compose.yaml" > "$release/compose.yaml"
status --verify >/dev/null || fail "restore after tamper still drifting"
pass "verify fails on tracked-file modification"

# 5. config drift
echo "PRIMARY_DNS_IP=198.51.100.9" > "$deploy_root/config/demo.env"
status --verify >/dev/null 2>&1 && fail "config drift not detected"
status --record-config >/dev/null
status --verify >/dev/null || fail "re-recorded config still drifting"
pass "verify fails on unrecorded config change"

# 6. unexpected running container
echo running > "$DOCKER_SHIM_STATE"
status --verify >/dev/null 2>&1 && fail "unexpected running container not detected"
pass "verify fails when container runs while EXPECT_RUNNING=false"

# 7. symlink mismatch
echo absent > "$DOCKER_SHIM_STATE"
mkdir -p "$deploy_root/releases/deadbeef"
cp -r "$release/." "$deploy_root/releases/deadbeef/"
ln -sfn "releases/deadbeef" "$deploy_root/current"
status --verify >/dev/null 2>&1 && fail "symlink/commit mismatch not detected"
ln -sfn "releases/$commit" "$deploy_root/current"
pass "verify fails on current-symlink mismatch"

# 8. expected running container with matching digest
sed -i 's/^EXPECT_RUNNING=false$/EXPECT_RUNNING=true/' "$release/DEPLOYMENT"
(cd "$release" && find . -type f ! -name SHA256SUMS -print0 | sort -z | xargs -0 sha256sum > SHA256SUMS)
echo running > "$DOCKER_SHIM_STATE"
status --verify >/dev/null || fail "matching running deployment reported drift"
export DOCKER_SHIM_DIGEST="2222222222222222222222222222222222222222222222222222222222222222"
status --verify >/dev/null 2>&1 && fail "digest mismatch not detected"
pass "verify checks running image digest against the pin"

# 9. scoped alert bearer token
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

# 10. successful verification heartbeat
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
