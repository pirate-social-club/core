import { Database } from "@tableland/sdk"
import { JsonRpcProvider, Wallet } from "ethers"

export interface Env {
  TABLELAND_GATEWAY_URL?: string
  TABLELAND_HEALTH_TIMEOUT_MS?: string
  TABLELAND_QUERY_TIMEOUT_MS?: string
  TABLELAND_CREATE_TIMEOUT_MS?: string
  BASE_SEPOLIA_RPC_URL?: string
  TABLELAND_TEST_PRIVATE_KEY?: string
}

type JsonRecord = Record<string, unknown>
type PublishCreateTableBody = {
  mode?: string
  prefix?: string
  insert_row?: boolean
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

function gatewayBase(env: Env): string {
  return String(env.TABLELAND_GATEWAY_URL || "https://testnets.tableland.network/api/v1").replace(/\/+$/, "")
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

function sanitizePrefix(input: string | undefined): string {
  const normalized = String(input || "worker_probe")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 24)

  return normalized || "worker_probe"
}

async function fetchWithTimeout(input: RequestInfo | URL, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort("timeout"), timeoutMs)
  try {
    return await fetch(input, {
      ...init,
      signal: controller.signal,
    })
  } finally {
    clearTimeout(timer)
  }
}

async function probeGatewayHealth(env: Env): Promise<JsonRecord> {
  const base = gatewayBase(env)
  const response = await fetchWithTimeout(`${base}/health`, {
    headers: { accept: "application/json" },
  }, parseTimeout(env.TABLELAND_HEALTH_TIMEOUT_MS, 8000))
  const text = await response.text()
  return {
    ok: response.ok,
    status: response.status,
    gateway_url: base,
    body: text,
  }
}

async function probeGatewayQuery(env: Env, request: Request): Promise<JsonRecord> {
  const url = new URL(request.url)
  const statement = url.searchParams.get("statement")?.trim() || "select * from healthbot_80002_1"
  const base = gatewayBase(env)
  const response = await fetchWithTimeout(`${base}/query`, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      statement,
      format: "objects",
      extract: false,
      unwrap: false,
    }),
  }, parseTimeout(env.TABLELAND_QUERY_TIMEOUT_MS, 8000))
  const raw = await response.text()
  let parsed: unknown = raw
  try {
    parsed = JSON.parse(raw)
  } catch {}
  return {
    ok: response.ok,
    status: response.status,
    gateway_url: base,
    statement,
    response: parsed,
  }
}

async function probeSdkImport(): Promise<JsonRecord> {
  const startedAt = Date.now()

  try {
    const sdk = await import("@tableland/sdk")
    const durationMs = Date.now() - startedAt
    return {
      ok: true,
      duration_ms: durationMs,
      exports: Object.keys(sdk).sort(),
    }
  } catch (error) {
    return {
      ok: false,
      duration_ms: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

async function probeLitImport(): Promise<JsonRecord> {
  const startedAt = Date.now()

  try {
    const litNodeClient = await import("@lit-protocol/lit-node-client-nodejs")
    const durationMs = Date.now() - startedAt
    return {
      ok: true,
      duration_ms: durationMs,
      lit_node_client_nodejs_exports: Object.keys(litNodeClient).sort(),
      notes: [
        "@lit-protocol/lit-node-client-nodejs bundled successfully in the Worker spike",
        "@lit-protocol/pkp-ethers is intentionally not imported here because Wrangler bundling currently fails on its WalletConnect modal dependency",
      ],
    }
  } catch (error) {
    return {
      ok: false,
      duration_ms: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

async function probePkpEthersImport(): Promise<JsonRecord> {
  const startedAt = Date.now()

  try {
    const pkpEthers = await import("@lit-protocol/pkp-ethers")
    return {
      ok: true,
      duration_ms: Date.now() - startedAt,
      exports: Object.keys(pkpEthers).sort(),
      notes: [
        "Bundle/import succeeded with a Worker-side shim for @walletconnect/modal",
        "This only proves import shape. It does not prove signer/session execution works in a Worker.",
      ],
    }
  } catch (error) {
    return {
      ok: false,
      duration_ms: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

function notConfigured(message: string): Response {
  return json({
    ok: false,
    error: message,
  }, { status: 501 })
}

async function probeCreateTableWalletMode(env: Env, request: Request): Promise<Response> {
  let body: PublishCreateTableBody = {}

  try {
    body = await request.json()
  } catch {}

  const startedAt = Date.now()
  const prefix = sanitizePrefix(body.prefix)
  const statement = `CREATE TABLE ${prefix} (id integer primary key, val text);`

  try {
    const rpcUrl = requireEnv(env.BASE_SEPOLIA_RPC_URL, "BASE_SEPOLIA_RPC_URL")
    const privateKey = requireEnv(env.TABLELAND_TEST_PRIVATE_KEY, "TABLELAND_TEST_PRIVATE_KEY")
    const timeoutMs = parseTimeout(env.TABLELAND_CREATE_TIMEOUT_MS, 15000)
    const provider = new JsonRpcProvider(rpcUrl, 84532)
    const signer = new Wallet(privateKey, provider)
    const db = new Database({ signer })

    const createPromise = (async () => {
      const { meta: create } = await db.prepare(statement).run()
      const txn = create.txn
      if (!txn) {
        throw new Error("tableland_create_missing_txn")
      }

      const receipt = await txn.wait()
      const tableName = txn.names[0] ?? ""
      if (!tableName) {
        throw new Error("tableland_create_missing_table_name")
      }

      let insertSummary: JsonRecord | null = null
      if (body.insert_row) {
        const { meta: insert } = await db
          .prepare(`INSERT INTO ${tableName} (val) VALUES (?);`)
          .bind("worker-spike")
          .run()
        await insert.txn?.wait()

        const read = await db.prepare(`SELECT * FROM ${tableName};`).all()
        insertSummary = {
          inserted: true,
          rows: read.results,
        }
      }

      return {
        ok: true,
        mode: "wallet",
        duration_ms: Date.now() - startedAt,
        chain_id: 84532,
        signer_address: await signer.getAddress(),
        statement,
        table_name: tableName,
        tx_hash: ((txn as { hash?: string }).hash ?? (receipt as { transactionHash?: string }).transactionHash ?? null),
        receipt_block_number: receipt?.blockNumber ?? null,
        insert: insertSummary,
      }
    })()

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error(`tableland_create_timeout:${timeoutMs}`)), timeoutMs)
    })

    return json(await Promise.race([createPromise, timeoutPromise]))
  } catch (error) {
    return json({
      ok: false,
      mode: "wallet",
      duration_ms: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
      statement,
      prefix,
    }, { status: 500 })
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)

    if (request.method === "GET" && url.pathname === "/") {
      return json({
        service: "tableland-worker-spike",
        purpose: [
          "prove basic Tableland gateway fetches from a Cloudflare Worker",
          "prove the Tableland SDK can import in a Worker bundle",
          "probe Lit package import shape for a future signer-backed publish path",
        ],
        routes: {
          "GET /health": "Worker health and configured gateway",
          "GET /probe/gateway/health": "Fetch Tableland validator health endpoint",
          "GET /probe/gateway/query?statement=...": "Run a read query through the Tableland gateway",
          "GET /probe/sdk/import": "Dynamically import @tableland/sdk inside the Worker runtime",
          "GET /probe/lit/import": "Dynamically import Lit packages inside the Worker runtime",
          "GET /probe/lit/pkp-ethers-import": "Dynamically import @lit-protocol/pkp-ethers inside the Worker runtime",
          "POST /probe/publish/create-table": "Attempt a real Tableland create-table mutation from the Worker",
          "POST /probe/publish/community-create": "Reserved for a future direct publish spike",
        },
      })
    }

    if (request.method === "GET" && url.pathname === "/health") {
      return json({
        ok: true,
        gateway_url: gatewayBase(env),
      })
    }

    if (request.method === "GET" && url.pathname === "/probe/gateway/health") {
      return json(await probeGatewayHealth(env))
    }

    if (request.method === "GET" && url.pathname === "/probe/gateway/query") {
      return json(await probeGatewayQuery(env, request))
    }

    if (request.method === "GET" && url.pathname === "/probe/sdk/import") {
      return json(await probeSdkImport())
    }

    if (request.method === "GET" && url.pathname === "/probe/lit/import") {
      return json(await probeLitImport())
    }

    if (request.method === "GET" && url.pathname === "/probe/lit/pkp-ethers-import") {
      return json(await probePkpEthersImport())
    }

    if (request.method === "POST" && url.pathname === "/probe/publish/create-table") {
      const bodyUnknown = await request.clone().json().catch(() => ({}))
      const body: PublishCreateTableBody =
        typeof bodyUnknown === "object" && bodyUnknown !== null ? (bodyUnknown as PublishCreateTableBody) : {}
      const mode = typeof body.mode === "string" ? body.mode : "wallet"

      if (mode === "wallet") {
        return probeCreateTableWalletMode(env, request)
      }

      if (mode === "lit") {
        return notConfigured(
          "Lit signer mode is not implemented yet. The next step is generating Worker-side PKP session signatures and constructing a signer/account for Base Sepolia publication.",
        )
      }

      return json({
        ok: false,
        error: `unsupported_mode:${mode}`,
      }, { status: 400 })
    }

    if (request.method === "POST" && url.pathname === "/probe/publish/community-create") {
      return notConfigured(
        "Direct publish probe is not implemented yet. This spike currently proves Worker fetch + package import shape before adding a signer-backed write path.",
      )
    }

    return json({
      ok: false,
      error: "not_found",
    }, { status: 404 })
  },
}
