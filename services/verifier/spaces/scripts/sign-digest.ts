#!/usr/bin/env bun

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

type Options = {
  space: string;
  digest: string;
  wallet: string;
  walletDir: string | null;
  spacesDataDir: string | null;
  rpcUrl: string;
  rpcAuthToken: string | null;
  rpcCookiePath: string | null;
  network: string;
  nativeBin: string | null;
  outpoint: string | null;
  allowNativeBuildFallback: boolean;
};

type JsonRpcSuccess<T> = {
  jsonrpc: "2.0";
  id: string | number | null;
  result: T;
};

type JsonRpcError = {
  jsonrpc: "2.0";
  id: string | number | null;
  error: {
    code: number;
    message: string;
  };
};

type RpcOutPoint = {
  txid: string;
  vout: number;
};

type RpcFullSpaceOut = {
  txid: string;
  n: number;
};

function usage(): never {
  console.error(`Usage:
  bun services/verifier/spaces/scripts/sign-digest.ts --space @pirate --digest <hex> [options]

Signs a Pirate Spaces verification digest with the current root key from a local Spaces wallet.

Options:
  --space LABEL             Required. Top-level space label, with or without @
  --digest HEX              Required. 32-byte lowercase or 0x-prefixed hex digest
  --wallet NAME             Wallet label. Default: default
  --wallet-dir PATH         Explicit wallet directory containing wallet.json and wallet.db
  --spaces-data-dir PATH    Base spaced data dir; used to derive wallet dir as <dir>/wallets/<wallet>
  --rpc-url URL             spaced RPC URL. Default: $SPACED_RPC_URL or http://127.0.0.1:7222
  --rpc-auth-token TOKEN    Precomputed Basic auth token for spaced RPC
  --rpc-cookie PATH         Cookie file used to derive Basic auth token
  --network NAME            Bitcoin network for wallet load. Default: mainnet
  --native-bin PATH         Prebuilt spaces-verifier-native binary to use
  --outpoint TXID:VOUT      Skip RPC owner lookup and sign for this outpoint directly
  -h, --help                Show this help text
`);
  process.exit(1);
}

function parseArgs(argv: string[]): Options {
  const options: Options = {
    space: "",
    digest: "",
    wallet: process.env.SPACES_WALLET?.trim() || "default",
    walletDir: process.env.SPACES_WALLET_DIR?.trim() || null,
    spacesDataDir: process.env.SPACES_DATA_DIR?.trim() || null,
    rpcUrl: process.env.SPACED_RPC_URL?.trim() || "http://127.0.0.1:7222",
    rpcAuthToken: process.env.SPACED_RPC_AUTH_TOKEN?.trim() || null,
    rpcCookiePath: process.env.SPACED_RPC_COOKIE?.trim() || null,
    network: process.env.SPACES_NETWORK?.trim() || "mainnet",
    nativeBin: process.env.SPACES_VERIFIER_NATIVE_BIN?.trim() || null,
    outpoint: null,
    allowNativeBuildFallback: ["1", "true", "yes", "on"].includes(
      String(process.env.SPACES_NATIVE_ALLOW_BUILD_FALLBACK || "").trim().toLowerCase(),
    ),
  };

  for (let index = 0; index < argv.length; ) {
    const arg = argv[index];
    const value = argv[index + 1];

    switch (arg) {
      case "--space":
        options.space = value ?? "";
        index += 2;
        break;
      case "--digest":
        options.digest = value ?? "";
        index += 2;
        break;
      case "--wallet":
        options.wallet = value ?? options.wallet;
        index += 2;
        break;
      case "--wallet-dir":
        options.walletDir = value ?? options.walletDir;
        index += 2;
        break;
      case "--spaces-data-dir":
        options.spacesDataDir = value ?? options.spacesDataDir;
        index += 2;
        break;
      case "--rpc-url":
        options.rpcUrl = value ?? options.rpcUrl;
        index += 2;
        break;
      case "--rpc-auth-token":
        options.rpcAuthToken = value ?? options.rpcAuthToken;
        index += 2;
        break;
      case "--rpc-cookie":
        options.rpcCookiePath = value ?? options.rpcCookiePath;
        index += 2;
        break;
      case "--network":
        options.network = value ?? options.network;
        index += 2;
        break;
      case "--native-bin":
        options.nativeBin = value ?? options.nativeBin;
        index += 2;
        break;
      case "--outpoint":
        options.outpoint = value ?? null;
        index += 2;
        break;
      case "-h":
      case "--help":
        usage();
        break;
      default:
        console.error(`unknown argument: ${arg}`);
        usage();
    }
  }

  return options;
}

function normalizeSpace(value: string): string {
  const trimmed = value.trim().toLowerCase();
  return trimmed.startsWith("@") ? trimmed : `@${trimmed}`;
}

function normalizeDigest(value: string): string {
  return value.trim().replace(/^0x/i, "").toLowerCase();
}

function resolveWalletDir(options: Options): string {
  if (options.walletDir) {
    return options.walletDir;
  }
  if (!options.spacesDataDir) {
    throw new Error("missing wallet location: set --wallet-dir or --spaces-data-dir");
  }
  const directWalletDir = path.join(options.spacesDataDir, "wallets", options.wallet);
  if (existsSync(directWalletDir)) {
    return directWalletDir;
  }

  const networkWalletDir = path.join(options.spacesDataDir, options.network, "wallets", options.wallet);
  if (existsSync(networkWalletDir)) {
    return networkWalletDir;
  }

  return directWalletDir;
}

function getRpcAuthToken(options: Options): string | null {
  if (options.rpcAuthToken) {
    return options.rpcAuthToken;
  }
  if (!options.rpcCookiePath) {
    return null;
  }
  const cookie = readFileSync(options.rpcCookiePath, "utf8").trim();
  return Buffer.from(cookie).toString("base64");
}

async function rpc<T>(options: Options, method: string, params: unknown[]): Promise<T> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    accept: "application/json",
  };
  const authToken = getRpcAuthToken(options);
  if (authToken) {
    headers.authorization = `Basic ${authToken}`;
  }

  const response = await fetch(options.rpcUrl, {
    method: "POST",
    headers,
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: method,
      method,
      params,
    }),
  });

  const body = await response.json() as JsonRpcSuccess<T> | JsonRpcError;
  if (!response.ok || "error" in body) {
    const message = "error" in body ? body.error.message : `http ${response.status}`;
    throw new Error(`spaced rpc ${method} failed: ${message}`);
  }
  return body.result;
}

async function resolveOutpoint(options: Options, space: string): Promise<string> {
  if (options.outpoint) {
    return options.outpoint;
  }

  try {
    const owner = await rpc<RpcOutPoint | null>(options, "getspaceowner", [space]);
    if (owner?.txid != null && typeof owner.vout === "number") {
      return `${owner.txid}:${owner.vout}`;
    }
  } catch {
    // Fall through to getspace for older or narrower RPC surfaces.
  }

  const spaceout = await rpc<RpcFullSpaceOut | null>(options, "getspace", [space]);
  if (spaceout?.txid != null && typeof spaceout.n === "number") {
    return `${spaceout.txid}:${spaceout.n}`;
  }

  throw new Error(`space not found or current owner outpoint unavailable for ${space}`);
}

function runNative(options: Options, args: string[]) {
  if (options.nativeBin) {
    return Bun.spawnSync([options.nativeBin, ...args], {
      stdout: "pipe",
      stderr: "pipe",
    });
  }

  if (!options.allowNativeBuildFallback) {
    throw new Error(
      "native signer binary is not configured. Set --native-bin or SPACES_VERIFIER_NATIVE_BIN, or explicitly enable SPACES_NATIVE_ALLOW_BUILD_FALLBACK=true for local development",
    );
  }

  return Bun.spawnSync(
    [
      "cargo",
      "run",
      "--quiet",
      "--offline",
      "--locked",
      "--manifest-path",
      path.join(import.meta.dir, "..", "native", "Cargo.toml"),
      "--",
      ...args,
    ],
    {
      stdout: "pipe",
      stderr: "pipe",
    },
  );
}

function decodeNativeJson(result: Bun.SpawnSyncReturns<Uint8Array>) {
  const stdout = Buffer.from(result.stdout).toString("utf8").trim();
  const stderr = Buffer.from(result.stderr).toString("utf8").trim();
  if (result.exitCode !== 0) {
    throw new Error(stderr || stdout || "native signer failed");
  }
  const parsed = JSON.parse(stdout) as { error?: string };
  if (parsed.error) {
    throw new Error(parsed.error);
  }
  return parsed;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const space = normalizeSpace(options.space);
  const digest = normalizeDigest(options.digest);

  if (!/^@[a-z0-9-]+$/.test(space)) {
    throw new Error("space must be a top-level label like @pirate");
  }
  if (!/^[0-9a-f]{64}$/.test(digest)) {
    throw new Error("digest must be a 32-byte hex string");
  }

  const walletDir = resolveWalletDir(options);
  const outpoint = await resolveOutpoint(options, space);
  const parsed = decodeNativeJson(
    runNative(options, ["sign-digest", walletDir, options.network, outpoint, digest]),
  ) as Record<string, unknown>;

  console.log(JSON.stringify({
    ...parsed,
    space,
    wallet: options.wallet,
    wallet_dir: walletDir,
  }));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "spaces digest signing failed");
  process.exit(1);
});
