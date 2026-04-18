import { Interface } from "ethers";
import { requireAddress, requireBytes32, requireUintString, signConstrainedTx } from "./_shared.js";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

const EXPECTED = Object.freeze({
  actionName: "story-operator-publish-asset-version-v1",
  storyChainId: 1315,
  contractAddress: "0x0000000000000000000000000000000000000000",
  functionSelector: "0xbcb4f79b",
  pkpAddress: "0x0000000000000000000000000000000000000000",
  pkpPublicKey: "0x",
  rpcUrl: "https://aeneid.storyrpc.io"
});

const ABI = [
  "function publishAssetVersion(address publisher, bytes32 assetVersionId, uint32 cdrVaultUuid, bytes32 namespace, bytes32 contentHash, bytes32 storageRefHash, uint256 entitlementTokenId, address readCondition, address writeCondition)"
];

const ABI_IFACE = new Interface(ABI);

export async function main(firstArg) {
  const response = await signConstrainedTx(firstArg, EXPECTED, ABI, "publishAssetVersion", (decoded) => {
    const publisher = requireAddress(decoded[0], "publisher");
    const assetVersionId = requireBytes32(decoded[1], "assetVersionId");
    const cdrVaultUuid = BigInt(requireUintString(decoded[2], "cdrVaultUuid"));
    const namespace = requireBytes32(decoded[3], "namespace");
    const contentHash = requireBytes32(decoded[4], "contentHash");
    const storageRefHash = requireBytes32(decoded[5], "storageRefHash");
    const entitlementTokenId = BigInt(requireUintString(decoded[6], "entitlementTokenId"));
    const readCondition = requireAddress(decoded[7], "readCondition");
    const writeCondition = requireAddress(decoded[8], "writeCondition");

    if (publisher === ZERO_ADDRESS) {
      throw new Error("publisher_zero");
    }
    if (assetVersionId === "0x".padEnd(66, "0")) {
      throw new Error("asset_version_id_zero");
    }
    if (cdrVaultUuid <= 0n || cdrVaultUuid > 0xffff_ffffn) {
      throw new Error(`cdr_vault_uuid_invalid ${JSON.stringify({ cdrVaultUuid: cdrVaultUuid.toString() })}`);
    }
    if (namespace === "0x".padEnd(66, "0")) {
      throw new Error("namespace_zero");
    }
    if (contentHash === "0x".padEnd(66, "0")) {
      throw new Error("content_hash_zero");
    }
    if (storageRefHash === "0x".padEnd(66, "0")) {
      throw new Error("storage_ref_hash_zero");
    }
    if (entitlementTokenId <= 0n) {
      throw new Error("entitlement_token_id_zero");
    }
    if (readCondition === ZERO_ADDRESS) {
      throw new Error("read_condition_zero");
    }
    if (writeCondition === ZERO_ADDRESS) {
      throw new Error("write_condition_zero");
    }

    const encoded = ABI_IFACE.encodeFunctionData("publishAssetVersion", [
      publisher,
      assetVersionId,
      cdrVaultUuid,
      namespace,
      contentHash,
      storageRefHash,
      entitlementTokenId,
      readCondition,
      writeCondition
    ]);

    if (encoded.toLowerCase().slice(0, 10) !== EXPECTED.functionSelector.toLowerCase()) {
      throw new Error(
        `function_selector_mismatch ${JSON.stringify({ actual: encoded.slice(0, 10), expected: EXPECTED.functionSelector })}`
      );
    }
  });

  return JSON.stringify(response);
}
