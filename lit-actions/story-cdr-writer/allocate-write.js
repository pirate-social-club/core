import { Interface, Wallet } from "ethers";
import {
  fail,
  requireAddress,
  requireHex,
  requireUintString,
  resolveExpectedPrivateKey,
  resolveJsParams,
  validateTxEnvelope,
} from "./_shared.js";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

const EXPECTED = Object.freeze({
  actionName: "story-cdr-writer-allocate-write-v1",
  storyChainId: 1315,
  contractAddress: "0x0000000000000000000000000000000000000000",
  pkpAddress: "0x0000000000000000000000000000000000000000",
  pkpPublicKey: "0x",
  rpcUrl: "https://aeneid.storyrpc.io",
});

const ABI = [
  "function allocate(bool updatable,address writeConditionAddr,address readConditionAddr,bytes writeConditionData,bytes readConditionData) payable returns (uint32)",
  "function write(uint32 uuid,bytes accessAuxData,bytes encryptedData)",
];

const ABI_IFACE = new Interface(ABI);
const ALLOCATE_SELECTOR = ABI_IFACE.getFunction("allocate").selector.toLowerCase();
const WRITE_SELECTOR = ABI_IFACE.getFunction("write").selector.toLowerCase();

function requireNonNegative(value, field) {
  const normalized = BigInt(requireUintString(value, field));
  if (normalized < 0n) {
    fail("invalid_uint", { field });
  }
  return normalized;
}

function validateAllocate(unsignedTx) {
  let decoded;
  try {
    decoded = ABI_IFACE.decodeFunctionData("allocate", unsignedTx.data);
  } catch {
    fail("calldata_decode_failed", { functionName: "allocate" });
  }

  const writeConditionAddr = requireAddress(decoded[1], "writeConditionAddr");
  const readConditionAddr = requireAddress(decoded[2], "readConditionAddr");
  const writeConditionData = requireHex(decoded[3], "writeConditionData");
  const readConditionData = requireHex(decoded[4], "readConditionData");

  if (writeConditionAddr === ZERO_ADDRESS) {
    fail("write_condition_zero");
  }
  if (readConditionAddr === ZERO_ADDRESS) {
    fail("read_condition_zero");
  }
  if (!writeConditionData || writeConditionData === "0x") {
    fail("write_condition_data_empty");
  }
  if (!readConditionData || readConditionData === "0x") {
    fail("read_condition_data_empty");
  }
}

function validateWrite(unsignedTx) {
  let decoded;
  try {
    decoded = ABI_IFACE.decodeFunctionData("write", unsignedTx.data);
  } catch {
    fail("calldata_decode_failed", { functionName: "write" });
  }

  const uuid = BigInt(requireUintString(decoded[0], "uuid"));
  const accessAuxData = requireHex(decoded[1], "accessAuxData");
  const encryptedData = requireHex(decoded[2], "encryptedData");

  if (uuid <= 0n || uuid > 0xffff_ffffn) {
    fail("uuid_invalid", { uuid: uuid.toString() });
  }
  if (!encryptedData || encryptedData === "0x") {
    fail("encrypted_data_empty");
  }
  if (accessAuxData.length % 2 !== 0) {
    fail("access_aux_data_invalid");
  }
}

export async function main(firstArg) {
  const params = resolveJsParams(firstArg);
  const unsignedTxValue = params.unsignedTx || {};
  const unsignedTx = {
    type: Number(unsignedTxValue.type ?? 2),
    chainId: Number(unsignedTxValue.chainId),
    nonce: Number(unsignedTxValue.nonce ?? 0),
    to: requireAddress(String(unsignedTxValue.to || ""), "unsignedTx.to"),
    value: BigInt(requireUintString(unsignedTxValue.value ?? "0", "unsignedTx.value")),
    data: requireHex(String(unsignedTxValue.data || ""), "unsignedTx.data"),
    gasLimit: BigInt(requireUintString(unsignedTxValue.gasLimit ?? "0", "unsignedTx.gasLimit")),
    maxFeePerGas: BigInt(requireUintString(unsignedTxValue.maxFeePerGas ?? "0", "unsignedTx.maxFeePerGas")),
    maxPriorityFeePerGas: BigInt(
      requireUintString(unsignedTxValue.maxPriorityFeePerGas ?? "0", "unsignedTx.maxPriorityFeePerGas"),
    ),
  };
  validateTxEnvelope(unsignedTx);

  const selector = unsignedTx.data.slice(0, 10).toLowerCase();
  if (selector !== ALLOCATE_SELECTOR && selector !== WRITE_SELECTOR) {
    fail("selector_mismatch", {
      selector,
      expected: [ALLOCATE_SELECTOR, WRITE_SELECTOR],
    });
  }

  if (unsignedTx.chainId !== EXPECTED.storyChainId) {
    fail("tx_chain_id_mismatch", {
      txChainId: unsignedTx.chainId,
      expected: EXPECTED.storyChainId,
    });
  }
  if (unsignedTx.to !== EXPECTED.contractAddress.toLowerCase()) {
    fail("tx_to_mismatch", {
      txTo: unsignedTx.to,
      expected: EXPECTED.contractAddress,
    });
  }

  requireNonNegative(unsignedTx.value.toString(), "unsignedTx.value");
  if (selector === ALLOCATE_SELECTOR) {
    validateAllocate(unsignedTx);
  } else {
    validateWrite(unsignedTx);
  }

  const privateKey = await resolveExpectedPrivateKey(EXPECTED);
  const wallet = new Wallet(privateKey);
  const signerAddress = requireAddress(wallet.address, "wallet.address");
  if (signerAddress !== EXPECTED.pkpAddress.toLowerCase()) {
    fail("pkp_address_mismatch", {
      signerAddress,
      expected: EXPECTED.pkpAddress,
    });
  }

  const signedTx = await wallet.signTransaction(unsignedTx);
  return JSON.stringify({
    ok: true,
    action: EXPECTED.actionName,
    mode: selector === ALLOCATE_SELECTOR ? "allocate" : "write",
    signerAddress,
    serializedTx: signedTx,
  });
}
