# Namespace Verification — Production Promotion Checklist

Status: **pending**

Purpose: promote the staging-verified namespace verification + community creation flow
to production, completing all hardening, schema, operator, and smoke steps.

Source of truth for the hardened code:
- `services/api/src/lib/communities/community-service.ts` — `resolveProvisioningRetryAction()`
- `services/api/tests/community-routes.test.ts` — three new regression tests
- `docs/runbooks/namespace-verification-smoke.md` — staging results and hardening notes

---

## 0. Context

What already works on staging:

- auth/session exchange
- self verification
- HNS namespace verification
- Spaces namespace verification
- community creation with verified namespace (both HNS and Spaces)

What was hardened for production:

- retry logic replaced with `resolveProvisioningRetryAction()` (in-flight guard, finalize path, no blanket retry)
- fallback `cdc_*` credential ID now logs a warning
- duplicate `getPrimaryCommunityDatabaseBinding()` call eliminated
- three regression tests added (fallback cred, stale finalize, in-flight guard)

What is not yet done:

- production schema readiness
- production operator readiness
- production deploy
- production smoke
- release hygiene

---

## 1. Production Control-Plane Schema Readiness

**Blocker: yes — must pass before deploy**

### 1.1 Identify production control-plane DB

```bash
# The production worker reads TURSO_CONTROL_PLANE_DATABASE_URL from its env.
# Find it from the canonical secret source (Infisical, Wrangler secrets, etc.)
#
# Example:
#   libsql://prod-control-plane-xxxxx.turso.io
```

Production DB URL: _______________________

### 1.2 Verify required tables exist

```bash
# Connect and check
libsql --url "<PROD_CONTROL_PLANE_URL>" --auth "<token>" <<'SQL'
  SELECT name FROM sqlite_master WHERE type='table' AND name IN ('community_db_credentials', 'audit_log') ORDER BY name;
SQL
```

Expected output:
```
audit_log
community_db_credentials
```

- [ ] `audit_log` exists
- [ ] `community_db_credentials` exists

### 1.3 If tables are missing, apply migrations

The authoritative schema is in:
```
db/control-plane/migrations/0002_control_plane_communities.sql   — community_db_credentials
db/control-plane/migrations/0004_control_plane_jobs_and_audit.sql — audit_log
```

Apply using the project migration runner:
```bash
./scripts/community/apply-sqlite-migrations.sh \
  --db <path-or-connection> \
  --migrations db/control-plane/migrations \
  --label control-plane
```

Or if the production DB is remote libsql, apply the specific DDL statements from those two migration files.

### 1.4 Verify column shape

```bash
libsql --url "<PROD_CONTROL_PLANE_URL>" --auth "<token>" <<'SQL'
  PRAGMA table_info(community_db_credentials);
  PRAGMA table_info(audit_log);
SQL
```

`community_db_credentials` must include at minimum:
- `community_db_credential_id` TEXT PK
- `community_database_binding_id` TEXT NOT NULL
- `credential_kind` TEXT NOT NULL
- `token_name` TEXT NOT NULL
- `encrypted_token` TEXT NOT NULL
- `encryption_key_version` INTEGER NOT NULL
- `status` TEXT NOT NULL
- `issued_at` TEXT NOT NULL
- `created_at` / `updated_at` TEXT NOT NULL

`audit_log` must include at minimum:
- `audit_event_id` TEXT PK
- `actor_type` TEXT NOT NULL
- `action` TEXT NOT NULL
- `target_type` TEXT NOT NULL
- `target_id` TEXT NOT NULL
- `community_id` TEXT
- `metadata_json` TEXT
- `created_at` TEXT NOT NULL

- [ ] community_db_credentials schema correct
- [ ] audit_log schema correct

### 1.5 Verify required indexes

```bash
libsql --url "<PROD_CONTROL_PLANE_URL>" --auth "<token>" <<'SQL'
  SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='community_db_credentials' ORDER BY name;
  SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='audit_log' ORDER BY name;
SQL
```

Key indexes from migration 0002:
- `idx_community_db_credentials_active_binding` (partial, WHERE status = 'active')
- `idx_community_db_credentials_token_name` (unique)

Key indexes from migration 0004:
- `idx_audit_log_actor`
- `idx_audit_log_target`
- `idx_audit_log_club`

- [ ] community_db_credentials indexes present
- [ ] audit_log indexes present

### Step 1 pass criteria

- [ ] Both tables exist with correct columns and indexes in production

---

## 2. Production Operator Readiness

**Blocker: yes — must pass before deploy**

### 2.1 Identify production operator host

```bash
# The production operator runs on the VPS.
# Find the host and service name.
ssh <prod-vps-host> "systemctl status pirate-community-provision-operator.service"
```

Production operator host: _______________________

### 2.2 Verify operator code matches staging

The staging operator was fixed with these files synced to `/srv/pirate-spaces/app`:

- `scripts/lib/turso-control-plane.ts`
- `scripts/lib/community-bootstrap.ts`
- `scripts/lib/turso-platform.ts`

```bash
# On production VPS, verify these files are current.
# Compare against the known-good parent repo revision or explicit file checksums,
# not just the `pirate-api` repo HEAD.
ssh <prod-vps-host> "cd /srv/pirate-spaces/app && git log --oneline -1 scripts/lib/turso-control-plane.ts scripts/lib/community-bootstrap.ts scripts/lib/turso-platform.ts"
```

Compare the revision or file contents against the known-good source in:

- `/home/t42/Documents/pirate-v2/scripts/lib/turso-control-plane.ts`
- `/home/t42/Documents/pirate-v2/scripts/lib/community-bootstrap.ts`
- `/home/t42/Documents/pirate-v2/scripts/lib/turso-platform.ts`

- [ ] Operator code matches staging (same revision)

### 2.3 Verify operator env

```bash
# The staging operator used a dedicated config env file, not /srv/pirate-spaces/app/.env.
# Verify the real operator env file on the VPS.
ssh <prod-vps-host> "cat /srv/pirate-spaces/config/community-provision-operator.env" | grep -E \
  'CONTROL_PLANE_DATABASE_URL|TURSO_CONTROL_PLANE_AUTH_TOKEN|TURSO_PLATFORM_API_TOKEN|TURSO_ORGANIZATION_SLUG|TURSO_COMMUNITY_DB_WRAP_KEY|TURSO_COMMUNITY_DB_WRAP_KEY_VERSION|COMMUNITY_PROVISION_OPERATOR_AUTH_TOKEN'
```

Required variables:

- [ ] `CONTROL_PLANE_DATABASE_URL` — points to **production** control plane (not staging)
- [ ] `TURSO_CONTROL_PLANE_AUTH_TOKEN` — valid for prod control plane
- [ ] `TURSO_PLATFORM_API_TOKEN` — valid for prod Turso org
- [ ] `TURSO_ORGANIZATION_SLUG` — correct prod organization
- [ ] `TURSO_COMMUNITY_DB_WRAP_KEY` — matches what the API worker uses
- [ ] `TURSO_COMMUNITY_DB_WRAP_KEY_VERSION` — matches what the API worker uses
- [ ] `COMMUNITY_PROVISION_OPERATOR_AUTH_TOKEN` — matches `COMMUNITY_PROVISION_OPERATOR_AUTH_TOKEN` in the production API worker

### 2.4 Verify operator health

```bash
ssh <prod-vps-host> "curl -sS http://127.0.0.1:8789/health"
```

Expected:
```json
{"ok":true,"bind_host":"127.0.0.1","bind_port":8789,"requires_bearer_auth":true}
```

- [ ] Operator health endpoint returns ok

### Step 2 pass criteria

- [ ] Production operator is running, code is current, env is correct, health is ok

---

## 3. Production Worker Config Readiness

**Blocker: yes — must pass before deploy**

### 3.1 Identify production worker

Production worker name: _______________________

Production API origin: _______________________

### 3.2 Verify required runtime vars

The production worker must have these vars set (from Infisical, Wrangler secrets, or equivalent):

**Auth:**
- [ ] Upstream JWT shared secret (for `pirate-production-upstream`)
- [ ] Upstream issuer/audience pair for production

**Verifiers:**
- [ ] `HNS_VERIFIER_BASE_URL`
- [ ] `HNS_VERIFIER_AUTH_TOKEN`
- [ ] `SPACES_VERIFIER_BASE_URL`
- [ ] `SPACES_VERIFIER_AUTH_TOKEN`
- [ ] `SPACES_VERIFIER_CHALLENGE_DOMAIN`

**Operator:**
- [ ] `COMMUNITY_PROVISION_OPERATOR_BASE_URL` — points to prod operator
- [ ] `COMMUNITY_PROVISION_OPERATOR_AUTH_TOKEN` — matches operator's `COMMUNITY_PROVISION_OPERATOR_AUTH_TOKEN`
- [ ] `COMMUNITY_PROVISION_DEFAULT_GROUP_LOCATION` — e.g. `aws-us-east-1`
- [ ] `COMMUNITY_PROVISION_OPERATOR_TIMEOUT_MS`

**Control plane:**
- [ ] `TURSO_CONTROL_PLANE_DATABASE_URL` — production control plane
- [ ] `TURSO_CONTROL_PLANE_AUTH_TOKEN`
- [ ] `TURSO_COMMUNITY_DB_WRAP_KEY` — matches operator's wrap key
- [ ] `TURSO_COMMUNITY_DB_WRAP_KEY_VERSION` — matches operator's wrap key version

**Registry publisher (if not using local stub):**
- [ ] `REGISTRY_PUBLISHER_URL`
- [ ] `REGISTRY_PUBLISHER_AUTH_TOKEN`
- [ ] `REGISTRY_PUBLISHER_TIMEOUT_MS`

### 3.3 Verify wrap key consistency

The wrap key + version MUST match between the API worker and the operator. If they differ,
credentials encrypted by one cannot be decrypted by the other.

```bash
# Compare:
# - API worker: TURSO_COMMUNITY_DB_WRAP_KEY / TURSO_COMMUNITY_DB_WRAP_KEY_VERSION
# - Operator:   TURSO_COMMUNITY_DB_WRAP_KEY / TURSO_COMMUNITY_DB_WRAP_KEY_VERSION
```

- [ ] Wrap key and version match between API worker and operator

### Step 3 pass criteria

- [ ] All required production worker vars are set and consistent

---

## 4. Deploy Hardened API to Production

**Depends on: steps 1, 2, 3 passing**

### 4.1 Confirm the exact revision to deploy

```bash
cd /home/t42/Documents/pirate-v2/pirate-api
git log --oneline -1
```

Revision: _______________________

### 4.2 Deploy

Use the project's standard deploy path:

```bash
# Example (adjust to actual deploy method):
# wrangler deploy --name <production-worker> --env production
# or
# bun run deploy:production
```

- [ ] Deploy completed without errors

### 4.3 Verify deployment

```bash
curl -sS https://<prod-api-origin>/health 2>/dev/null || echo "no /health endpoint; check logs instead"
```

Check deployment logs for the new code path (look for the `[community-provision]` warning prefix if triggered).

- [ ] Production worker is running the hardened revision

### Step 4 pass criteria

- [ ] Hardened API is deployed and serving requests in production

---

## 5. Production Auth Smoke

**Depends on: step 4**

### 5.1 Mint production upstream JWT

```bash
# Use the production issuer/audience/secret
# Adjust to match your production JWT minting method
```

### 5.2 Exchange

```bash
curl -sS -X POST https://<prod-api-origin>/auth/session/exchange \
  -H "Content-Type: application/json" \
  -d '{
    "proof": {
      "type": "jwt_based_auth",
      "jwt": "<production upstream JWT>"
    }
  }'
```

- [ ] Response: 200
- [ ] `access_token` present
- [ ] `user.user_id` present

### 5.3 Verify token stability

Repeat the exchange 3 times in quick succession. All should return 200 with the same `user_id`.

- [ ] Auth is stable across 3 consecutive exchanges

Production `user_id`: _______________________
Production `access_token`: _______________________

### Step 5 pass criteria

- [ ] Production auth path works and is stable

---

## 6. Production HNS Smoke

**Depends on: step 5**

### 6.1 Start HNS namespace session

```bash
curl -sS -X POST https://<prod-api-origin>/namespace-verification-sessions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <production-access-token>" \
  -d '{"family":"hns","root_label":"<your-production-hns-root>"}'
```

- [ ] Response: 201
- [ ] `namespace_verification_session_id` present
- [ ] Challenge host and value returned

Session ID: _______________________
Challenge host: _______________________
Challenge TXT value: _______________________

### 6.2 Publish TXT record

```bash
# Publish the TXT record on the HNS root using your HNS tooling
# Then confirm it resolves from the verifier's perspective
```

- [ ] TXT record published and resolvable

### 6.3 Complete HNS verification

```bash
curl -sS -X POST https://<prod-api-origin>/namespace-verification-sessions/<session-id>/complete \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <production-access-token>"
```

- [ ] Response: 200
- [ ] `namespace_verification_id` present
- [ ] `status = "verified"`
- [ ] `club_attach_allowed = true`

HNS namespace_verification_id: _______________________

### 6.4 Create community with HNS namespace

```bash
curl -sS -X POST https://<prod-api-origin>/communities \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <production-access-token>" \
  -d '{
    "display_name": "<Production HNS Smoke Community>",
    "namespace": {
      "namespace_verification_id": "<hns-namespace-verification-id>"
    },
    "membership_mode": "open"
  }'
```

- [ ] Response: 202
- [ ] `community.provisioning_state = "active"`
- [ ] `community.registry_publication_state = "published"`
- [ ] `community.namespace_verification_id` matches

HNS community_id: _______________________
HNS job_id: _______________________

### 6.5 Confirm community state via GET

```bash
curl -sS https://<prod-api-origin>/communities/<hns-community-id> \
  -H "Authorization: Bearer <production-access-token>"
```

- [ ] `provisioning_state = "active"`
- [ ] `registry_publication_state = "published"`
- [ ] `namespace_verification_id` bound correctly

### Step 6 pass criteria

- [ ] Full HNS production path passes end-to-end

---

## 7. Production Spaces Smoke

**Depends on: step 5**

### 7.1 Start Spaces namespace session

```bash
curl -sS -X POST https://<prod-api-origin>/namespace-verification-sessions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <production-access-token>" \
  -d '{"family":"spaces","root_label":"<your-production-spaces-root>"}'
```

- [ ] Response: 201
- [ ] `namespace_verification_session_id` present
- [ ] Challenge payload returned

Session ID: _______________________
Digest: _______________________

### 7.2 Sign the challenge

```bash
# Use the same signing method proven on staging:
#   rtk bun services/verifier/spaces/scripts/sign-digest.ts \
#     --space <root> \
#     --digest <challenge_payload.digest> \
#     --wallet-dir <wallet-path> \
#     --outpoint <outpoint> \
#     --network mainnet \
#     --native-bin <native-bin-path>
```

- [ ] Signature produced

Signature hex: _______________________
Signer pubkey hex: _______________________

### 7.3 Complete Spaces verification

```bash
curl -sS -X POST https://<prod-api-origin>/namespace-verification-sessions/<session-id>/complete \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <production-access-token>" \
  -d '{
    "signature_payload": {
      "signature": "<signature-hex>",
      "signer_pubkey": "<pubkey-hex>"
    }
  }'
```

- [ ] Response: 200
- [ ] `namespace_verification_id` present
- [ ] `status = "verified"`
- [ ] `club_attach_allowed = true`

Spaces namespace_verification_id: _______________________

### 7.4 Create community with Spaces namespace

```bash
curl -sS -X POST https://<prod-api-origin>/communities \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <production-access-token>" \
  -d '{
    "display_name": "<Production Spaces Smoke Community>",
    "namespace": {
      "namespace_verification_id": "<spaces-namespace-verification-id>"
    },
    "membership_mode": "open"
  }'
```

- [ ] Response: 202
- [ ] `community.provisioning_state = "active"`
- [ ] `community.registry_publication_state = "published"`
- [ ] `community.namespace_verification_id` matches

Spaces community_id: _______________________
Spaces job_id: _______________________

### 7.5 Confirm community state via GET

```bash
curl -sS https://<prod-api-origin>/communities/<spaces-community-id> \
  -H "Authorization: Bearer <production-access-token>"
```

- [ ] `provisioning_state = "active"`
- [ ] `registry_publication_state = "published"`
- [ ] `namespace_verification_id` bound correctly

### Step 7 pass criteria

- [ ] Full Spaces production path passes end-to-end

---

## 8. Retry Safety Verification in Production

**Depends on: steps 6 and 7**

### 8.1 Verify no duplicate resources

```bash
# Check the Turso platform for duplicate groups/databases
# List groups for the production org:
#   turso group list <org>
# Look for any groups matching club-cmt-* that are duplicates
```

- [ ] No duplicate Turso groups for any production community
- [ ] No duplicate databases for any production community

### 8.2 Verify retry behavior

For each community created in steps 6 and 7, retry the same `POST /communities` call:

```bash
# HNS retry
curl -sS -X POST https://<prod-api-origin>/communities \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <production-access-token>" \
  -d '{
    "display_name": "<Production HNS Smoke Community>",
    "namespace": {
      "namespace_verification_id": "<hns-namespace-verification-id>"
    },
    "membership_mode": "open"
  }'
```

- [ ] Returns existing community (same `community_id`)
- [ ] `provisioning_state = "active"` (not re-provisioned)
- [ ] No new job created (same `job_id`)
- [ ] No new Turso resources created

### Step 8 pass criteria

- [ ] Retry is idempotent, no duplicate side effects

---

## 9. Operator Contract Follow-Up

**Not a blocker, but must be resolved or explicitly accepted**

### 9.1 Decide on the fallback `cdc_*` path

**Option A: Keep fallback as permanent defensive guard**

- Document it as intentional in the operator contract
- Ensure `[community-provision]` warning logs are observable in production monitoring
- Accept that synthetic `cdc_*` IDs have no operator-side referent

**Option B: Fix the operator to always return `credential_id`**

Steps:
1. Update `ProvisionCommunityRuntimeResult` in `scripts/lib/turso-control-plane.ts` to include `communityDbCredentialId`
2. Update `mapProvisionResponse()` in `scripts/lib/turso-control-plane-operator.ts` to return `credential_id` from the runtime result
3. Re-sync and redeploy the operator on the VPS
4. Verify the API no longer triggers the fallback in the happy path

Decision: _______________________

- [ ] Decision recorded and acted on

---

## 10. Release Hygiene / Closeout

### 10.1 Review git status

```bash
cd /home/t42/Documents/pirate-v2/pirate-api
git status
git diff --stat
```

- [ ] All rollout-relevant changes are understood
- [ ] Unrelated dirty work is stashed or separated
- [ ] No secrets in the diff

### 10.2 Commit relevant changes

The final diff should contain:
- `services/api/src/lib/communities/community-service.ts` — hardened retry logic
- `services/api/tests/community-routes.test.ts` — three new regression tests
- `docs/runbooks/namespace-verification-smoke.md` — staging results + production readiness notes
- `docs/runbooks/namespace-verification-production-promotion.md` — this checklist

Important repo boundary note:

- `services/api/...` lives in `/home/t42/Documents/pirate-v2/pirate-api`
- `docs/runbooks/...` lives in the parent monorepo `/home/t42/Documents/pirate-v2`

So do **not** run one `git add` command from `pirate-api/` that tries to stage `docs/runbooks/...`.
Either:

- commit code changes from `pirate-api`, and docs from the parent monorepo separately
- or do closeout from the monorepo root if that is the intended release boundary

```bash
# Code repo
cd /home/t42/Documents/pirate-v2/pirate-api
git add services/api/src/lib/communities/community-service.ts \
       services/api/tests/community-routes.test.ts
git commit -m "harden community provisioning retry logic for production rollout"

# Parent monorepo docs
cd /home/t42/Documents/pirate-v2
git add docs/runbooks/namespace-verification-smoke.md \
       docs/runbooks/namespace-verification-production-promotion.md
git commit -m "document namespace verification production promotion"
```

- [ ] Clean commit with only rollout-relevant changes

### 10.3 Update runbook with production results

After production smoke passes, update the runbook with:

- Production auth results
- Production HNS results
- Production Spaces results
- Production community IDs
- Any production-specific fixes needed

- [ ] Runbook updated with production results

### Step 10 pass criteria

- [ ] Repo state is clean enough for another engineer to understand and reproduce

---

## 11. Final Completion Criteria

The task is fully complete only when **all** of the following are checked:

- [ ] 1. Production control-plane schema confirmed ready (community_db_credentials + audit_log)
- [ ] 2. Production operator confirmed running with correct code and env
- [ ] 3. Production worker config verified (all vars set, wrap key consistent)
- [ ] 4. Hardened API deployed to production
- [ ] 5. Production auth smoke passes
- [ ] 6. Production HNS smoke passes (including community create)
- [ ] 7. Production Spaces smoke passes (including community create)
- [ ] 8. Retry safety verified (no duplicate resources, idempotent retries)
- [ ] 9. Operator contract decision made (fallback accepted or fixed)
- [ ] 10. Release hygiene complete (clean commit, updated runbook, no secrets)

---

## Quick Reference: Staging Results

For comparison when running production smoke:

| Item | Staging Value |
|------|---------------|
| API origin | `https://api-staging.pirate.sc` |
| Worker name | `pirate-api-staging` |
| Upstream issuer | `pirate-staging-upstream` |
| Upstream audience | `pirate-api-staging` |
| HNS namespace_verification_id | `nv_6d90612f2873416fa01b7328a9ce3209` |
| HNS community_id | `cmt_e093d673aba54ff79bce9b11977ea58f` |
| Spaces namespace_verification_id | `nv_e891b6fb92e34bf88885565e9a8a5d75` |
| Spaces community_id | `cmt_11274b9e442f49ee831c479d31b9ce23` |
| User ID used | `usr_8364330e5ab3463d890da6b987427830` |
