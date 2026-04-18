#!/usr/bin/env bun

import path from "node:path";
import { execFileSync } from "node:child_process";
import { bundleLitActionSource } from "./_lib/action-source.mjs";
import { DEFAULT_BASE_URL, asNonEmpty, litApiRequest, maybe } from "./_lib/lit-api.mjs";
import { getFamily, loadLitFamilies } from "./_lib/config.mjs";

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2).trim();
    const value = (argv[index + 1] || "").trim();
    if (!key || !value || value.startsWith("--")) continue;
    args[key] = value;
    index += 1;
  }
  return args;
}

function toDecString(value) {
  return typeof value === "bigint" ? value.toString() : String(value);
}

function parseGweiToWei(value) {
  const normalized = String(value || "").trim();
  if (!/^\d+(\.\d+)?$/.test(normalized)) {
    throw new Error(`invalid_gwei:${value}`);
  }
  const [whole, fractionRaw = ""] = normalized.split(".");
  const fraction = `${fractionRaw}000000000`.slice(0, 9);
  return BigInt(whole) * 1_000_000_000n + BigInt(fraction);
}

function castJson(args) {
  return JSON.parse(execFileSync("cast", args, { encoding: "utf8" }));
}

function castText(args) {
  return execFileSync("cast", args, { encoding: "utf8" }).trim();
}

async function executeLitAction({ baseUrl, usageApiKey, sourceCode, jsParams }) {
  return litApiRequest({
    baseUrl,
    path: "/core/v1/lit_action",
    method: "POST",
    apiKey: usageApiKey,
    body: {
      code: sourceCode,
      js_params: jsParams,
    },
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const familyName = maybe(args.family) || "story-operator";
  const litFamilies = loadLitFamilies();
  const family = getFamily(litFamilies, familyName, "dev");
  const usageKeyEnvVar = String(family.usageKeyEnvVar || "").trim();
  const usageApiKey = maybe(args["usage-key"]) || maybe(process.env[usageKeyEnvVar]);
  if (!usageApiKey) {
    throw new Error(`Missing usage key: set --usage-key or ${usageKeyEnvVar}`);
  }

  const rpcUrl = maybe(args["rpc-url"]) || "https://aeneid.storyrpc.io";
  const chainId = Number(maybe(args["chain-id"]) || "1315");
  const sender = asNonEmpty(family.pkpAddress, `${familyName}.pkpAddress`);
  const recipient = asNonEmpty(args.to, "to");
  const value = BigInt(asNonEmpty(args["value-wei"], "value-wei"));
  const gasLimit = BigInt(maybe(args["gas-limit"]) || "21000");

  const pendingNonce = Number(castText(["nonce", "--rpc-url", rpcUrl, "--block", "pending", sender]));
  const gasPrice = BigInt(castText(["gas-price", "--rpc-url", rpcUrl]));
  const floorMaxFee = parseGweiToWei(maybe(args["min-max-fee-gwei"]) || "1");
  const floorPriorityFee = parseGweiToWei(maybe(args["min-priority-fee-gwei"]) || "0.1");
  const maxFeePerGas = gasPrice > floorMaxFee ? gasPrice : floorMaxFee;
  const maxPriorityFeePerGas = floorPriorityFee > maxFeePerGas ? maxFeePerGas : floorPriorityFee;

  const sourcePath = path.resolve(
    maybe(args.file) || path.join(process.cwd(), "lit-actions/probes/sign-native-transfer.js"),
  );
  const { sourceCode } = await bundleLitActionSource(sourcePath, undefined);

  const execution = await executeLitAction({
    baseUrl: (maybe(args["base-url"]) || maybe(process.env.LIT_CHIPOTLE_API_BASE_URL) || DEFAULT_BASE_URL).replace(/\/+$/, ""),
    usageApiKey,
    sourceCode,
    jsParams: {
      expectedSignerAddress: sender,
      expectedPkpId: maybe(family.pkpId) || undefined,
      unsignedTx: {
        type: 2,
        chainId,
        nonce: pendingNonce,
        to: recipient,
        value: toDecString(value),
        data: "0x",
        gasLimit: toDecString(gasLimit),
        maxFeePerGas: toDecString(maxFeePerGas),
        maxPriorityFeePerGas: toDecString(maxPriorityFeePerGas),
      },
    },
  });

  const parsed = typeof execution.response === "string"
    ? JSON.parse(execution.response)
    : execution.response;
  if (!parsed || parsed.ok !== true) {
    throw new Error(`lit_action_response_invalid:${JSON.stringify(execution).slice(0, 1000)}`);
  }
  if (String(parsed.signerAddress || "").toLowerCase() !== sender.toLowerCase()) {
    throw new Error(`lit_action_signer_mismatch:${String(parsed.signerAddress || "")}:${sender}`);
  }
  const serializedTx = String(parsed.serializedTx || "").trim();
  if (!serializedTx.startsWith("0x")) {
    throw new Error("lit_action_missing_serialized_tx");
  }

  const txHash = castText(["rpc", "--rpc-url", rpcUrl, "eth_sendRawTransaction", serializedTx]);
  const receipt = castJson(["receipt", "--rpc-url", rpcUrl, "--json", txHash]);

  console.log(JSON.stringify({
    ok: true,
    family: familyName,
    sender,
    recipient,
    valueWei: value.toString(),
    nonce: pendingNonce,
    maxFeePerGas: maxFeePerGas.toString(),
    maxPriorityFeePerGas: maxPriorityFeePerGas.toString(),
    txHash,
    receiptStatus: receipt.status,
    blockNumber: String(receipt.blockNumber),
  }, null, 2));
}

main().catch((error) => {
  const message = error instanceof Error ? error.stack || error.message : String(error);
  console.error(message);
  process.exit(1);
});
