# Namespace Verification Smoke

Date: 2026-04-15

## Scope

This runbook records the completed live staging smoke for:

- auth session exchange
- self verification
- HNS namespace verification
- Spaces namespace verification
- community creation with a verified namespace

## Runtime Used

- deployed API origin: `https://api-staging.pirate.sc`
- live worker name: `pirate-api-staging`
- verifier public endpoints:
  - HNS: `https://verifier.pirate.sc/hns`
  - Spaces: `https://verifier.pirate.sc/spaces`
- verifier traffic goes through Caddy on the VPS at `verifier.pirate.sc`

Important discovery:

- `api-staging.pirate.sc` is backed by `pirate-api-staging`, not `pirate-api-core`

## Auth Secret Resolution

The staging auth path was validated against the staging upstream issuer/audience pair:

- upstream issuer: `pirate-staging-upstream`
- upstream audience: `pirate-api-staging`

The returned Pirate app token used:

- issuer: `pirate-api-staging`
- audience: `pirate-app-staging`
- TTL: `3600` seconds

Canonical source used during the successful smoke:

- staging runtime vars/secrets synced into `pirate-api-staging`
- local staging smoke commands matched the deployed staging worker config

## Auth Smoke Result

Successful session exchange returned a stable staging user:

- `user_id = usr_8364330e5ab3463d890da6b987427830`

That user had `unique_human` verified and was used for the final namespace and community smoke.

## HNS Smoke Result

Root tested:

- `infinity`

Verified namespace:

- `namespace_verification_id = nv_6d90612f2873416fa01b7328a9ce3209`
- status: `verified`
- `club_attach_allowed = true`

Community creation result:

- `community_id = cmt_e093d673aba54ff79bce9b11977ea58f`
- `job_id = job_e127c17d24704a0e8aa267b30c6e6084`
- create response status: `202`
- community state after success:
  - `status = active`
  - `provisioning_state = active`
- bound namespace:
  - `namespace_verification_id = nv_6d90612f2873416fa01b7328a9ce3209`

Control-plane confirmation:

- `community_database_binding_id = cdb_25d88fd9f7d84699be7f385278088b6d`
- active `database_url = libsql://main-cmt-e093d673aba54ff79bce9b11977ea58f-pirate-prod.aws-us-east-1.turso.io`
- active credential:
  - `community_db_credential_id = cdc_2c142ac9e1534a10828e0886556c213a`

## Spaces Smoke Result

Root tested:

- `@pirate`

Verified namespace:

- `namespace_verification_id = nv_e891b6fb92e34bf88885565e9a8a5d75`
- status: `verified`
- `club_attach_allowed = true`

Current flow note:

- Spaces verification now uses a Fabric publish check instead of a separate signature upload
- the operator publishes `web`, `freedom`, and `pirate-verify` records with
  `pirate-spaces-publisher`
- Pirate completes verification after those records resolve from the VPS verifier

Community creation result:

- `community_id = cmt_11274b9e442f49ee831c479d31b9ce23`
- `job_id = job_7edec2e2d96d40e1a1b3726ccb5c7396`
- create response status: `202`
- community state after success:
  - `status = active`
  - `provisioning_state = active`
- bound namespace:
  - `namespace_verification_id = nv_e891b6fb92e34bf88885565e9a8a5d75`

Control-plane confirmation:

- `community_database_binding_id = cdb_e0955612ec65490db38e617c19fda8b8`
- active `database_url = libsql://main-cmt-11274b9e442f49ee831c479d31b9ce23-pirate-prod.aws-us-east-1.turso.io`
- active credential:
  - `community_db_credential_id = cdc_7ca7c7198b97451490e4f68cab21f0cb`

## Required Remediation That Unblocked Community Creation

These were required to get staging fully green.

### API fixes

- `services/api/src/lib/communities/community-service.ts`
  - operator-provisioned community DB credentials now fall back to a locally generated `cdc_*` id when the operator runtime response omits `credential_id`
  - stale provisioning detection now retries/finalizes communities that already have a real binding and active credential but were left in `provisioning`

### Operator / VPS fixes

Files synced to the VPS app checkout under `/srv/pirate-spaces/app`:

- `scripts/lib/turso-control-plane.ts`
- `scripts/lib/community-bootstrap.ts`
- `scripts/lib/turso-platform.ts`

Runtime env fixed on the operator host:

- `CONTROL_PLANE_DATABASE_URL` set to the staging libsql control plane
- `TURSO_CONTROL_PLANE_AUTH_TOKEN` added so the operator can read/write Turso libsql over auth

Service restarted successfully:

- `pirate-community-provision-operator.service`

### Staging control-plane schema fixes

The staging libsql control plane was missing tables expected by the current code path.

Created manually:

- `community_db_credentials`
- `audit_log`

Also repaired one bad historical row:

- updated the empty-string `community_db_credential_id` on the Spaces community to a real `cdc_*` id

## Exact Successful Command Shapes

These command shapes succeeded during the live staging smoke.

### Session exchange

```bash
curl -sS -X POST https://api-staging.pirate.sc/auth/session/exchange \
  -H "Content-Type: application/json" \
  -d '{
    "proof": {
      "type": "jwt_based_auth",
      "jwt": "<HS256 jwt with iss=pirate-staging-upstream aud=pirate-api-staging>"
    }
  }'
```

### HNS session start

```bash
curl -sS -X POST https://api-staging.pirate.sc/namespace-verification-sessions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <pirate-access-token>" \
  -d '{"family":"hns","root_label":"infinity"}'
```

### HNS owner-managed root-resource check

Use this shape for the product flow where the user publishes NS/TXT in Bob/HNS and Pirate only
observes the live Handshake root resource. This does not call `/publish-txt` and must return a
trusted owner-managed provider such as `hns_parent_chain`.

```bash
curl -sS "https://verifier.pirate.sc/hns/inspect-public?root_label=<root>" \
  -H "Authorization: Bearer <HNS_VERIFIER_AUTH_TOKEN>"
```

```bash
curl -sS -X POST https://verifier.pirate.sc/hns/verify-txt-public \
  -H "Authorization: Bearer <HNS_VERIFIER_AUTH_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "root_label":"<root>",
    "challenge_txt_value":"pirate-verification=<session-challenge>"
  }'
```

Expected owner-managed success shape:

- `observation_provider = hns_parent_chain`
- `operation_class = owner_managed_namespace`
- `pirate_dns_authority_verified = true` when the HNS-visible NS set contains `ns1.pirate.`
- `verified = true` when the live HNS root resource contains the session challenge TXT value

### HNS Pirate-managed TXT publish

```bash
curl -sS -X POST https://verifier.pirate.sc/hns/publish-txt \
  -H "Authorization: Bearer <HNS_VERIFIER_AUTH_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "root_label":"infinity",
    "challenge_host":"_pirate.infinity",
    "challenge_txt_value":"pirate-verification=<session-id>"
  }'
```

### HNS complete

```bash
curl -sS -X POST https://api-staging.pirate.sc/namespace-verification-sessions/<session-id>/complete \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <pirate-access-token>"
```

### Spaces session start

```bash
curl -sS -X POST https://api-staging.pirate.sc/namespace-verification-sessions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <pirate-access-token>" \
  -d '{"family":"spaces","root_label":"@pirate"}'
```

### Spaces Fabric publish

```bash
go version
go run github.com/pirate/pirate-spaces-publisher@v0.1.0 publish @pirate \
  --wallet-export /path/to/wallet-export.json \
  --web <challenge_payload.web_url> \
  --freedom <challenge_payload.freedom_url> \
  --txt pirate-verify=<challenge_payload.txt_value>
```

### Spaces complete

```bash
curl -sS -X POST https://api-staging.pirate.sc/namespace-verification-sessions/<session-id>/complete \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <pirate-access-token>"
```

### Community create

```bash
curl -sS -X POST https://api-staging.pirate.sc/communities \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <pirate-access-token>" \
  -d '{
    "display_name": "Smoke Community",
    "namespace": {
      "namespace_verification_id": "<verified-namespace-id>"
    },
    "membership_mode": "open"
  }'
```

### Community fetch

```bash
curl -sS https://api-staging.pirate.sc/communities/<community-id> \
  -H "Authorization: Bearer <pirate-access-token>"
```

## Outcome

Completed:

- staging auth smoke
- staging self verification
- staging HNS verification
- staging Spaces verification
- staging community creation through `POST /communities`

Final status:

- namespace verification rollout is live and working on staging for both HNS and Spaces
- community creation with a verified namespace is also working on staging

## Production Readiness

Staging is proven end-to-end. Production rollout requires:

### 1. Control-plane schema

Run `scripts/community/apply-sqlite-migrations.sh` against the production control plane DB. The tables `community_db_credentials` and `audit_log` are defined in migrations `0002` and `0004` and must exist before deploying.

### 2. Operator idempotency

Verified in code: `provisionCommunityRuntime` in `scripts/lib/turso-control-plane.ts` is safe for duplicate calls:

- Turso groups and databases use find-or-create (`listGroups`/`listDatabases` before `createGroup`/`createDatabase`)
- Community DB bootstrap uses `ON CONFLICT DO UPDATE` for all inserts
- Token minting creates a new token each call (old tokens superseded, not leaked)
- The `ProvisionCommunityRuntimeResult` type does not include `communityDbCredentialId`, so the API-side fallback for empty `credential_id` remains necessary until the operator is updated to return it

### 3. API retry policy

The staging fix used `hasStaleProvisioningRecord()` which treated all non-active communities as retryable. This has been replaced with `resolveProvisioningRetryAction()` which implements a production-safe policy:

- `provisioning_state = active` → return existing
- job `status = failed` → retry
- job `status = running` and updated within 30s → return existing (in-flight guard)
- job `status = running` and stale (>30s) → retry
- binding missing / pending URL / no credential → retry
- binding + credential real but community not finalized → finalize (no operator call)

### 4. Fallback credential ID

When the operator returns an empty `credential_id`, the API generates a synthetic `cdc_*` id and logs a warning. This is a temporary fallback; the operator should be updated to always return `credential_id`.

### 5. Known limitation

The `ProvisionCommunityRuntimeResult` type (used by the VPS operator) does not include `communityDbCredentialId`. The API-side `provisionCommunityViaOperator` client maps this to an empty string, triggering the fallback. This is the root cause of the staging issue and should be fixed in the operator contract.
