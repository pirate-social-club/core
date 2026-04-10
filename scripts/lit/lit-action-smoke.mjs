#!/usr/bin/env bun

import { execFileSync } from "node:child_process";
import path from "node:path";
import { bundleLitActionSource, findCriticalExpectedPlaceholders } from "./_lib/action-source.mjs";
import { DEFAULT_BASE_URL, asNonEmpty, litApiRequest, maybe } from "./_lib/lit-api.mjs";
import { getFamily, loadLitFamilies, loadStoryDelivery, resolveFamilyAddress, resolveStoryDeliveryContract } from "./_lib/config.mjs";

function parseArgs(argv) {
  const args = {};
  const flags = new Set();
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2).trim();
    const value = (argv[index + 1] || "").trim();
    if (!key) continue;
    if (!value || value.startsWith("--")) {
      flags.add(key);
      continue;
    }
    args[key] = value;
    index += 1;
  }
  return { args, flags };
}

function buildPublishAssetCalldata(contractAddress, params) {
  return execFileSync(
    "cast",
    [
      "calldata",
      "publishAssetVersion(address,bytes32,uint32,bytes32,bytes32,bytes32,uint256,address,address)",
      params.publisher,
      params.assetVersionId,
      String(params.cdrVaultUuid),
      params.namespace,
      params.contentHash,
      params.storageRefHash,
      String(params.entitlementTokenId),
      params.readCondition,
      params.writeCondition
    ],
    { encoding: "utf8" }
  ).trim();
}

async function executeLitAction({ baseUrl, usageApiKey, sourceCode, jsParams }) {
  return litApiRequest({
    baseUrl,
    path: "/core/v1/lit_action",
    method: "POST",
    apiKey: usageApiKey,
    body: {
      code: sourceCode,
      js_params: jsParams
    }
  });
}

async function main() {
  const { args } = parseArgs(process.argv.slice(2));
  const env = process.env;

  const filePath = path.resolve(asNonEmpty(args.file, "file"));
  const familyName = maybe(args.family) || "story-operator";
  const baseUrl = (maybe(args["base-url"]) || maybe(env.LIT_CHIPOTLE_API_BASE_URL) || DEFAULT_BASE_URL).replace(/\/+$/, "");
  const usageApiKey = maybe(args["usage-key"]) || maybe(env.LIT_CHIPOTLE_OPERATOR_API_KEY);
  if (!usageApiKey) {
    throw new Error("Missing usage key: set --usage-key or LIT_CHIPOTLE_OPERATOR_API_KEY");
  }

  const litFamilies = loadLitFamilies();
  const storyDelivery = loadStoryDelivery();
  const family = getFamily(litFamilies, familyName, "dev");
  const expectedSigner = resolveFamilyAddress(family, familyName);
  const contractAddress = resolveStoryDeliveryContract(storyDelivery, "assetPublishCoordinatorV1");

  const rawSource = await Bun.file(filePath).text();
  const placeholderFields = findCriticalExpectedPlaceholders(rawSource);
  if (placeholderFields.length > 0) {
    throw new Error(`stamped Lit Action still has placeholders: ${placeholderFields.join(", ")}`);
  }
  const { sourceCode } = await bundleLitActionSource(filePath, undefined);

  const smokeParams = {
    publisher: maybe(args.publisher) || "0x1111111111111111111111111111111111111111",
    assetVersionId: maybe(args["asset-version-id"]) || "0x" + "11".repeat(32),
    cdrVaultUuid: Number(maybe(args["cdr-vault-uuid"]) || "77"),
    namespace: maybe(args.namespace) || "0x" + "22".repeat(32),
    contentHash: maybe(args["content-hash"]) || "0x" + "33".repeat(32),
    storageRefHash: maybe(args["storage-ref-hash"]) || "0x" + "44".repeat(32),
    entitlementTokenId: BigInt(maybe(args["entitlement-token-id"]) || "123456789"),
    readCondition: maybe(args["read-condition"]) || storyDelivery.contracts.tokenGateCondition,
    writeCondition: maybe(args["write-condition"]) || "0x5555555555555555555555555555555555555555"
  };

  const data = buildPublishAssetCalldata(contractAddress, smokeParams);
  const jsParams = {
    unsignedTx: {
      type: 2,
      chainId: 1315,
      nonce: 0,
      to: contractAddress,
      value: "0",
      data,
      gasLimit: "300000",
      maxFeePerGas: "1000000000",
      maxPriorityFeePerGas: "100000000"
    }
  };

  const execution = await executeLitAction({
    baseUrl,
    usageApiKey,
    sourceCode,
    jsParams
  });

  let parsedResponse = null;
  try {
    parsedResponse = typeof execution.response === "string"
      ? JSON.parse(execution.response)
      : execution.response;
  } catch {
    parsedResponse = execution.response;
  }

  if (!parsedResponse || parsedResponse.ok !== true) {
    throw new Error(`lit_action_response_invalid:${JSON.stringify(execution).slice(0, 1000)}`);
  }
  if (String(parsedResponse.signerAddress || "").toLowerCase() !== expectedSigner.toLowerCase()) {
    throw new Error(
      `lit_action_signer_mismatch:${JSON.stringify({ actual: parsedResponse.signerAddress, expected: expectedSigner })}`
    );
  }
  if (typeof parsedResponse.serializedTx !== "string" || !parsedResponse.serializedTx.startsWith("0x")) {
    throw new Error("lit_action_missing_serialized_tx");
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        filePath,
        expectedSigner,
        action: parsedResponse.action,
        signerAddress: parsedResponse.signerAddress,
        serializedTxPrefix: parsedResponse.serializedTx.slice(0, 42),
        logs: execution.logs || null,
        jsParams
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[lit-action-smoke] ${message}`);
  process.exit(1);
});
