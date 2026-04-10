# Tableland Worker Spike

Standalone Cloudflare Worker prototype for answering one narrow question:

- can a Worker directly talk to the Tableland gateway?
- can a Worker bundle and import `@tableland/sdk`?
- can a Worker bundle and import Lit packages needed for a future signer-backed publish path?

This is intentionally separate from the main Pirate API runtime.

## Routes

- `GET /`
  - service manifest
- `GET /health`
  - local Worker health
- `GET /probe/gateway/health`
  - fetches `${TABLELAND_GATEWAY_URL}/health`
- `GET /probe/gateway/query?statement=select%201`
  - runs a read query through the Tableland gateway
  - defaults to `select * from healthbot_80002_1`, matching the public testnet example from the Tableland docs
- `GET /probe/sdk/import`
  - dynamically imports `@tableland/sdk` inside the Worker runtime and reports export keys
- `GET /probe/lit/import`
  - dynamically imports `@lit-protocol/lit-node-client-nodejs`
- `GET /probe/lit/pkp-ethers-import`
  - dynamically imports `@lit-protocol/pkp-ethers`
  - uses a local shim for `@walletconnect/modal` so we can see whether the package is otherwise Worker-bundle-safe
- `POST /probe/publish/create-table`
  - `mode=wallet` is implemented
  - attempts a real `CREATE TABLE ...` mutation on Tableland testnets from inside the Worker
  - requires:
    - `BASE_SEPOLIA_RPC_URL`
    - `TABLELAND_TEST_PRIVATE_KEY`
    - Base Sepolia ETH on the signer
  - optional body:
    - `prefix`
    - `insert_row`
  - `mode=lit` is reserved for the next spike
- `POST /probe/publish/community-create`
  - reserved for the future direct publish spike

## Default Gateway

Uses the Tableland testnet gateway by default:

- `https://testnets.tableland.network/api/v1`

## Local Run

```bash
cd /home/t42/Documents/pirate-v2/references/prototypes/tableland-worker-spike
rtk bun install
rtk bun run dev
```

Then hit:

```bash
curl http://127.0.0.1:8791/probe/gateway/health
curl "http://127.0.0.1:8791/probe/gateway/query?statement=select%201%20as%20worker_probe"
curl http://127.0.0.1:8791/probe/sdk/import
curl http://127.0.0.1:8791/probe/lit/import
```

## Current Scope

This spike does **not** publish to Tableland yet. It only proves the Worker runtime shape needed before adding:

- Lit auth/session setup
- signer-backed Tableland writes
- finality/receipt waiting
- request timeout behavior under realistic publication latency

That statement is now partially outdated:

- real Tableland create-table writes are implemented for `wallet` mode
- Lit-backed signing is still the remaining unproven step
