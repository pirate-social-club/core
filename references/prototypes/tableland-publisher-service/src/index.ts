import { randomUUID } from "node:crypto"
import { createServer, type IncomingMessage, type ServerResponse } from "node:http"
import { Database } from "@tableland/sdk"
import { JsonRpcProvider, NonceManager, Wallet } from "ethers"

type JsonRecord = Record<string, unknown>

type Env = {
  PORT?: string
  TABLELAND_GATEWAY_URL?: string
  TABLELAND_CREATE_TIMEOUT_MS?: string
  TABLELAND_ATTEMPTS_TABLE?: string
  BASE_SEPOLIA_RPC_URL?: string
  TABLELAND_TEST_PRIVATE_KEY?: string
  REGISTRY_PUBLISHER_AUTH_TOKEN?: string
}

type CreateCommunityAttemptBody = {
  actor_user_id?: string
  actor_primary_wallet_snapshot?: string | null
  actor_governance_address_snapshot?: string | null
  namespace_verification_id?: string
  normalized_root_label?: string
  created_at?: string
}

type PublishCommunityCreateBody = {
  registry_attempt_id?: string
  community_id?: string
  created_at?: string
  existing_table_refs?: {
    club_registry_table?: string | null
    club_namespace_table?: string | null
  }
  canonical_seed?: Record<string, unknown>
}

function json(body: JsonRecord, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body, null, 2), {
    ...init,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...init?.headers,
    },
  })
}

function sanitizePrefix(input: string | undefined): string {
  const normalized = String(input || "publisher_probe")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 24)

  return normalized || "publisher_probe"
}

function parseTimeout(value: string | undefined, fallbackMs: number): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallbackMs
}

function requireEnv(value: string | undefined, name: string): string {
  const normalized = String(value || "").trim()
  if (!normalized) {
    throw new Error(`missing_env:${name}`)
  }
  return normalized
}

function requirePublisherAuth(req: IncomingMessage, env: Env): Response | null {
  const expected = String((env as Env & { REGISTRY_PUBLISHER_AUTH_TOKEN?: string }).REGISTRY_PUBLISHER_AUTH_TOKEN || "").trim()
  if (!expected) {
    return null
  }

  const actual = String(req.headers.authorization || "").trim()
  if (actual !== `Bearer ${expected}`) {
    return json({
      ok: false,
      error_code: "publisher_unauthorized",
    }, { status: 401 })
  }

  return null
}

function gatewayBase(env: Env): string {
  return String(env.TABLELAND_GATEWAY_URL || "https://testnets.tableland.network/api/v1").replace(/\/+$/, "")
}

function configuredAttemptsTable(env: Env): string | null {
  const normalized = String(env.TABLELAND_ATTEMPTS_TABLE || "").trim()
  return normalized || null
}

const globalScope = globalThis as typeof globalThis & {
  __pirateTablelandAttemptsTableName?: string
  __pirateTablelandRuntimeCache?: {
    cacheKey: string
    db: Database
    signer: NonceManager
  }
}

function buildClubRegistryCurrentPrefix(communityId: string): string {
  const normalizedCommunityId = sanitizePrefix(communityId).replace(/^cmt_/, "")
  return sanitizePrefix(`clubreg_${normalizedCommunityId}`).slice(0, 24)
}

function buildClubNamespaceCurrentPrefix(communityId: string): string {
  const normalizedCommunityId = sanitizePrefix(communityId).replace(/^cmt_/, "")
  return sanitizePrefix(`clubns_${normalizedCommunityId}`).slice(0, 24)
}

async function getDatabase(env: Env): Promise<{
  db: Database
  signer: NonceManager
}> {
  const rpcUrl = requireEnv(env.BASE_SEPOLIA_RPC_URL, "BASE_SEPOLIA_RPC_URL")
  const privateKey = requireEnv(env.TABLELAND_TEST_PRIVATE_KEY, "TABLELAND_TEST_PRIVATE_KEY")
  const cacheKey = `${rpcUrl}|${privateKey}`
  const cached = globalScope.__pirateTablelandRuntimeCache
  if (cached && cached.cacheKey === cacheKey) {
    return cached
  }

  const provider = new JsonRpcProvider(rpcUrl, 84532)
  const signer = new NonceManager(new Wallet(privateKey, provider))
  const runtime = {
    cacheKey,
    db: new Database({ signer }),
    signer,
  }
  globalScope.__pirateTablelandRuntimeCache = runtime
  return {
    db: runtime.db,
    signer: runtime.signer,
  }
}

async function ensureAttemptsTable(env: Env): Promise<string> {
  const configured = configuredAttemptsTable(env)
  if (configured) {
    return configured
  }

  if (globalScope.__pirateTablelandAttemptsTableName) {
    return globalScope.__pirateTablelandAttemptsTableName
  }

  const discovered = await discoverExistingTableByPrefix(env, "community_create_attempts_current").catch(() => null)
  if (discovered) {
    globalScope.__pirateTablelandAttemptsTableName = discovered
    return discovered
  }

  const { db } = await getDatabase(env)
  const { meta } = await db
    .prepare(
      "CREATE TABLE community_create_attempts_current (id integer primary key, registry_attempt_id text, actor_user_id text, actor_primary_wallet_snapshot text, actor_governance_address_snapshot text, namespace_verification_id text, normalized_root_label text, community_id text, attempt_status text, failure_code text, created_at text, updated_at text);",
    )
    .run()
  const txn = meta.txn
  if (!txn) {
    throw new Error("tableland_attempts_create_missing_txn")
  }
  await txn.wait()

  const tableName = txn.names[0] ?? ""
  if (!tableName) {
    throw new Error("tableland_attempts_create_missing_table_name")
  }

  globalScope.__pirateTablelandAttemptsTableName = tableName
  return tableName
}

async function queryTableland(env: Env, statement: string): Promise<unknown[]> {
  const response = await fetch(
    `${gatewayBase(env)}/query?statement=${encodeURIComponent(statement)}`,
  )
  if (!response.ok) {
    throw new Error(`tableland_gateway_query_failed:${response.status}`)
  }

  const payload = await response.json().catch(() => null)
  if (Array.isArray(payload)) {
    return payload
  }

  if (payload && typeof payload === "object" && Array.isArray((payload as { rows?: unknown[] }).rows)) {
    return (payload as { rows: unknown[] }).rows
  }

  return []
}

function canonicalSeedRecord(
  canonicalSeed: Record<string, unknown> | undefined,
  key: "registry" | "namespace_summary",
): Record<string, unknown> {
  if (canonicalSeed && typeof canonicalSeed[key] === "object" && canonicalSeed[key] != null) {
    return canonicalSeed[key] as Record<string, unknown>
  }

  return {}
}

function optionalText(value: unknown): string | null {
  if (value == null) {
    return null
  }

  const normalized = String(value).trim()
  return normalized ? normalized : null
}

function optionalInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) ? value : null
}

async function resolveOrCreateTable(input: {
  env: Env
  db: Database
  configuredTableName: string | null
  prefix: string
  createSql: string
  createMissingTxnError: string
  createMissingTableError: string
}): Promise<string> {
  if (input.configuredTableName) {
    return input.configuredTableName
  }

  try {
    const { meta } = await input.db.prepare(input.createSql).run()
    const txn = meta.txn
    if (!txn) {
      throw new Error(input.createMissingTxnError)
    }
    await txn.wait()

    const tableName = txn.names[0] ?? ""
    if (!tableName) {
      throw new Error(input.createMissingTableError)
    }

    return tableName
  } catch (error) {
    const existing = await discoverExistingTableByPrefix(input.env, input.prefix).catch(() => null)
    if (existing) {
      return existing
    }

    throw error
  }
}

async function discoverExistingTableByPrefix(env: Env, prefix: string): Promise<string | null> {
  const statement =
    `SELECT name FROM sqlite_master ` +
    `WHERE type = 'table' AND name LIKE '${prefix.replace(/'/g, "''")}_%' ` +
    `ORDER BY name DESC LIMIT 1`
  const rows = await queryTableland(env, statement)
  const firstRow = rows[0]
  if (firstRow && typeof firstRow === "object" && firstRow !== null) {
    const tableName = (firstRow as { name?: unknown }).name
    return typeof tableName === "string" && tableName.trim() ? tableName : null
  }

  return null
}

async function createCommunityAttempt(env: Env, body: CreateCommunityAttemptBody): Promise<JsonRecord> {
  const actorUserId = String(body.actor_user_id || "").trim()
  const actorPrimaryWalletSnapshot =
    body.actor_primary_wallet_snapshot == null ? null : String(body.actor_primary_wallet_snapshot).trim() || null
  const actorGovernanceAddressSnapshot =
    body.actor_governance_address_snapshot == null ? null : String(body.actor_governance_address_snapshot).trim() || null
  const namespaceVerificationId = String(body.namespace_verification_id || "").trim()
  const normalizedRootLabel = String(body.normalized_root_label || "").trim()
  const createdAt = String(body.created_at || new Date().toISOString())
  if (!actorUserId || !namespaceVerificationId || !normalizedRootLabel) {
    throw new Error("publisher_invalid_attempt_request")
  }

  const registryAttemptId = `rga_${randomUUID().replace(/-/g, "")}`
  const attemptsTable = await ensureAttemptsTable(env)
  const { db } = await getDatabase(env)

  const { meta } = await db
    .prepare(
      `INSERT INTO ${attemptsTable} (registry_attempt_id, actor_user_id, actor_primary_wallet_snapshot, actor_governance_address_snapshot, namespace_verification_id, normalized_root_label, community_id, attempt_status, failure_code, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
    )
    .bind(
      registryAttemptId,
      actorUserId,
      actorPrimaryWalletSnapshot,
      actorGovernanceAddressSnapshot,
      namespaceVerificationId,
      normalizedRootLabel,
      null,
      "in_progress",
      null,
      createdAt,
      createdAt,
    )
    .run()
  await meta.txn?.wait()

  return {
    ok: true,
    registry_attempt_id: registryAttemptId,
    actor_user_id: actorUserId,
    actor_primary_wallet_snapshot: actorPrimaryWalletSnapshot,
    actor_governance_address_snapshot: actorGovernanceAddressSnapshot,
    namespace_verification_id: namespaceVerificationId,
    normalized_root_label: normalizedRootLabel,
    created_at: createdAt,
    result_ref: `tableland://${attemptsTable}/${registryAttemptId}`,
    attempts_table: attemptsTable,
  }
}

async function publishCommunityCreate(env: Env, body: PublishCommunityCreateBody): Promise<JsonRecord> {
  const registryAttemptId = String(body.registry_attempt_id || "").trim()
  const communityId = String(body.community_id || "").trim()
  const createdAt = String(body.created_at || new Date().toISOString())
  if (!registryAttemptId || !communityId) {
    throw new Error("publisher_invalid_publish_request")
  }

  const attemptsTable = await ensureAttemptsTable(env)
  const { db } = await getDatabase(env)
  const registryPrefix = buildClubRegistryCurrentPrefix(communityId)
  const namespacePrefix = buildClubNamespaceCurrentPrefix(communityId)
  const requestedTableRefs =
    body.existing_table_refs && typeof body.existing_table_refs === "object"
      ? body.existing_table_refs
      : {}

  const timeoutMs = parseTimeout(env.TABLELAND_CREATE_TIMEOUT_MS, 90000)
  let resolvedRegistryTable: string | null = optionalText(requestedTableRefs.club_registry_table)
  let resolvedNamespaceTable: string | null = optionalText(requestedTableRefs.club_namespace_table)
  const publishPromise = (async () => {
    const attemptRows = await queryTableland(
      env,
      `SELECT registry_attempt_id FROM ${attemptsTable} WHERE registry_attempt_id = '${registryAttemptId.replace(/'/g, "''")}' LIMIT 1`,
    )
    if (attemptRows.length === 0) {
      throw new Error(`publisher_attempt_not_found:${registryAttemptId}`)
    }

    const canonicalSeed = body.canonical_seed ?? {}
    const registrySeed =
      canonicalSeed && typeof canonicalSeed === "object"
        ? canonicalSeedRecord(canonicalSeed as Record<string, unknown>, "registry")
        : {}
    const namespaceSeed =
      canonicalSeed && typeof canonicalSeed === "object"
        ? canonicalSeedRecord(canonicalSeed as Record<string, unknown>, "namespace_summary")
        : {}

    const registryTable = await resolveOrCreateTable({
      env,
      db,
      configuredTableName: resolvedRegistryTable,
      prefix: registryPrefix,
      createSql:
        `CREATE TABLE ${registryPrefix} (id integer primary key, community_id text unique not null, display_name text not null, description text, avatar_ref text, cover_ref text, status text not null, governance_mode text not null, governance_chain_id integer, governance_contract_address text, governance_treasury_address text, observed_owner_set_json text, observed_owner_set_observed_at text, governance_verification_state text, governance_last_verified_at text, donation_policy_mode text, donation_partner_status text, handle_policy_template text, handle_pricing_model text, handle_claims_enabled integer not null, handle_premium_enabled integer not null, handle_auction_enabled integer not null, updated_at text not null);`,
      createMissingTxnError: "tableland_registry_create_missing_txn",
      createMissingTableError: "tableland_registry_create_missing_table_name",
    })
    resolvedRegistryTable = registryTable

    const { meta: insertRegistry } = await db
      .prepare(
        `INSERT INTO ${registryTable} (community_id, display_name, description, avatar_ref, cover_ref, status, governance_mode, governance_chain_id, governance_contract_address, governance_treasury_address, observed_owner_set_json, observed_owner_set_observed_at, governance_verification_state, governance_last_verified_at, donation_policy_mode, donation_partner_status, handle_policy_template, handle_pricing_model, handle_claims_enabled, handle_premium_enabled, handle_auction_enabled, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (community_id) DO UPDATE SET display_name = excluded.display_name, description = excluded.description, avatar_ref = excluded.avatar_ref, cover_ref = excluded.cover_ref, status = excluded.status, governance_mode = excluded.governance_mode, governance_chain_id = excluded.governance_chain_id, governance_contract_address = excluded.governance_contract_address, governance_treasury_address = excluded.governance_treasury_address, observed_owner_set_json = excluded.observed_owner_set_json, observed_owner_set_observed_at = excluded.observed_owner_set_observed_at, governance_verification_state = excluded.governance_verification_state, governance_last_verified_at = excluded.governance_last_verified_at, donation_policy_mode = excluded.donation_policy_mode, donation_partner_status = excluded.donation_partner_status, handle_policy_template = excluded.handle_policy_template, handle_pricing_model = excluded.handle_pricing_model, handle_claims_enabled = excluded.handle_claims_enabled, handle_premium_enabled = excluded.handle_premium_enabled, handle_auction_enabled = excluded.handle_auction_enabled, updated_at = excluded.updated_at;`,
      )
      .bind(
        communityId,
        String(registrySeed.display_name || ""),
        optionalText(registrySeed.description),
        optionalText(registrySeed.avatar_ref),
        optionalText(registrySeed.cover_ref),
        String(registrySeed.status || ""),
        String(registrySeed.governance_mode || ""),
        optionalInteger(registrySeed.governance_chain_id),
        optionalText(registrySeed.governance_contract_address),
        optionalText(registrySeed.governance_treasury_address),
        optionalText(registrySeed.observed_owner_set_json),
        optionalText(registrySeed.observed_owner_set_observed_at),
        optionalText(registrySeed.governance_verification_state),
        optionalText(registrySeed.governance_last_verified_at),
        optionalText(registrySeed.donation_policy_mode),
        optionalText(registrySeed.donation_partner_status),
        optionalText(registrySeed.handle_policy_template),
        optionalText(registrySeed.handle_pricing_model),
        Number(registrySeed.handle_claims_enabled || 0),
        Number(registrySeed.handle_premium_enabled || 0),
        Number(registrySeed.handle_auction_enabled || 0),
        String(registrySeed.updated_at || createdAt),
      )
      .run()
    await insertRegistry.txn?.wait()

    const namespaceTable = await resolveOrCreateTable({
      env,
      db,
      configuredTableName: resolvedNamespaceTable,
      prefix: namespacePrefix,
      createSql:
        `CREATE TABLE ${namespacePrefix} (id integer primary key, community_id text not null, namespace_id text not null, display_label text not null, normalized_label text not null, route_family text not null, namespace_role text not null, status text not null, root_proof_status text not null, delegation_status text not null, last_verified_at text, updated_at text not null, unique (community_id, namespace_id));`,
      createMissingTxnError: "tableland_namespace_create_missing_txn",
      createMissingTableError: "tableland_namespace_create_missing_table_name",
    })
    resolvedNamespaceTable = namespaceTable

    const { meta: insertNamespace } = await db
      .prepare(
        `INSERT INTO ${namespaceTable} (community_id, namespace_id, display_label, normalized_label, route_family, namespace_role, status, root_proof_status, delegation_status, last_verified_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (community_id, namespace_id) DO UPDATE SET display_label = excluded.display_label, normalized_label = excluded.normalized_label, route_family = excluded.route_family, namespace_role = excluded.namespace_role, status = excluded.status, root_proof_status = excluded.root_proof_status, delegation_status = excluded.delegation_status, last_verified_at = excluded.last_verified_at, updated_at = excluded.updated_at;`,
      )
      .bind(
        communityId,
        namespaceSeed.namespace_id == null ? null : String(namespaceSeed.namespace_id),
        namespaceSeed.display_label == null ? null : String(namespaceSeed.display_label),
        namespaceSeed.normalized_label == null ? null : String(namespaceSeed.normalized_label),
        namespaceSeed.route_family == null ? null : String(namespaceSeed.route_family),
        namespaceSeed.namespace_role == null ? null : String(namespaceSeed.namespace_role),
        namespaceSeed.status == null ? null : String(namespaceSeed.status),
        namespaceSeed.root_proof_status == null ? null : String(namespaceSeed.root_proof_status),
        namespaceSeed.delegation_status == null ? null : String(namespaceSeed.delegation_status),
        namespaceSeed.last_verified_at == null ? null : String(namespaceSeed.last_verified_at),
        namespaceSeed.updated_at == null ? createdAt : String(namespaceSeed.updated_at),
      )
      .run()
    await insertNamespace.txn?.wait()

    const { meta: updateAttempt } = await db
      .prepare(
        `UPDATE ${attemptsTable} SET community_id = ?, attempt_status = ?, failure_code = ?, updated_at = ? WHERE registry_attempt_id = ?;`,
      )
      .bind(communityId, "succeeded", null, createdAt, registryAttemptId)
      .run()
    await updateAttempt.txn?.wait()

    return {
      ok: true,
      status: "published",
      result_ref: `tableland://${registryTable}/${communityId}`,
      registry_published_at: createdAt,
      table_refs: {
        attempts_table: attemptsTable,
        club_registry_table: registryTable,
        club_namespace_table: namespaceTable,
      },
    }
  })()

  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error(`tableland_create_timeout:${timeoutMs}`)), timeoutMs)
  })

  try {
    return await Promise.race([publishPromise, timeoutPromise])
  } catch (error) {
    const errorCode = error instanceof Error ? error.message : String(error)
    try {
      const { db } = await getDatabase(env)
      const { meta } = await db
        .prepare(
          `UPDATE ${attemptsTable} SET community_id = ?, attempt_status = ?, failure_code = ?, updated_at = ? WHERE registry_attempt_id = ?;`,
        )
        .bind(communityId || null, "failed", errorCode, createdAt, registryAttemptId)
        .run()
      await meta.txn?.wait()
    } catch {}

    return {
      ok: false,
      status: "publication_error",
      error_code: errorCode,
      registry_attempt_id: registryAttemptId,
      community_id: communityId || null,
      created_at: createdAt,
      table_refs: {
        attempts_table: attemptsTable,
        club_registry_table: resolvedRegistryTable,
        club_namespace_table: resolvedNamespaceTable,
      },
    }
  }
}

const env: Env = process.env
const port = Number(env.PORT || 8789)

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Uint8Array[] = []
  for await (const chunk of req) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk)
  }

  if (chunks.length === 0) {
    return {}
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"))
  } catch {
    return {}
  }
}

async function handle(req: IncomingMessage): Promise<Response> {
  const url = new URL(req.url || "/", `http://${req.headers.host || `127.0.0.1:${port}`}`)

  if (req.method === "GET" && url.pathname === "/health") {
    return json({
      ok: true,
      port,
      gateway_url: gatewayBase(env),
    })
  }

  if (req.method === "POST" && url.pathname === "/internal/v0/create-community-attempt") {
    const unauthorized = requirePublisherAuth(req, env)
    if (unauthorized) {
      return unauthorized
    }

    const parsed = await readJsonBody(req)
    const body: CreateCommunityAttemptBody =
      parsed && typeof parsed === "object" ? parsed as CreateCommunityAttemptBody : {}

    try {
      return json(await createCommunityAttempt(env, body))
    } catch (error) {
      return json({
        ok: false,
        status: "publication_error",
        error_code: error instanceof Error ? error.message : String(error),
      }, { status: 500 })
    }
  }

  if (req.method === "POST" && url.pathname === "/internal/v0/publish-community-create") {
    const unauthorized = requirePublisherAuth(req, env)
    if (unauthorized) {
      return unauthorized
    }

    const parsed = await readJsonBody(req)
    const body: PublishCommunityCreateBody =
      parsed && typeof parsed === "object" ? parsed as PublishCommunityCreateBody : {}

    const result = await publishCommunityCreate(env, body)
    const status = result.ok === false && result.status === "publication_error" ? 200 : result.ok === false ? 500 : 200
    return json(result, { status })
  }

  return json({
    ok: false,
    error_code: "not_found",
  }, { status: 404 })
}

async function writeNodeResponse(res: ServerResponse, response: Response): Promise<void> {
  res.statusCode = response.status
  response.headers.forEach((value, key) => {
    res.setHeader(key, value)
  })
  const buffer = Buffer.from(await response.arrayBuffer())
  res.end(buffer)
}

const server = createServer(async (req, res) => {
  try {
    await writeNodeResponse(res, await handle(req))
  } catch (error) {
    await writeNodeResponse(res, json({
      ok: false,
      error_code: error instanceof Error ? error.message : String(error),
    }, { status: 500 }))
  }
})

server.listen(port, "127.0.0.1", () => {
  console.log(`tableland-publisher-service listening on http://127.0.0.1:${port}`)
})
