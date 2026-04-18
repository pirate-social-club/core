import { Wallet, getAddress } from "ethers";

function fail(message, details = {}) {
  throw new Error(`${message}${Object.keys(details).length ? ` ${JSON.stringify(details)}` : ""}`);
}

function requireAddress(value, field) {
  try {
    return getAddress(String(value || "")).toLowerCase();
  } catch {
    fail("invalid_address", { field });
  }
}

function requireUintString(value, field) {
  const normalized = String(value ?? "").trim();
  if (!/^\d+$/.test(normalized)) fail("invalid_uint", { field });
  return normalized;
}

function normalizePrivateKey(value) {
  if (typeof value === "string") {
    const withPrefix = value.trim().startsWith("0x") ? value.trim() : `0x${value.trim()}`;
    if (!/^0x[0-9a-fA-F]{64}$/.test(withPrefix)) fail("invalid_private_key_string");
    return withPrefix.toLowerCase();
  }
  if (value instanceof Uint8Array) {
    if (value.length !== 32) fail("invalid_private_key_bytes");
    return `0x${Array.from(value).map((b) => b.toString(16).padStart(2, "0")).join("")}`;
  }
  fail("unsupported_private_key_type", { actualType: typeof value });
}

function resolveGetPrivateKey() {
  if (typeof Lit?.Actions?.getPrivateKey === "function") return Lit.Actions.getPrivateKey.bind(Lit.Actions);
  if (typeof LitActions?.getPrivateKey === "function") return LitActions.getPrivateKey.bind(LitActions);
  fail("get_private_key_unavailable");
}

function resolveJsParams(firstArg) {
  const rootParams = (firstArg && typeof firstArg === "object" ? firstArg : null)
    || globalThis.jsParams
    || globalThis.js_params
    || globalThis.params
    || {};
  const params = rootParams && typeof rootParams === "object" ? rootParams : {};
  return params.jsParams && typeof params.jsParams === "object" ? { ...params.jsParams, ...params } : params;
}

async function resolveExpectedPrivateKey(expectedSignerAddress, expectedPkpId = null) {
  const getPrivateKey = resolveGetPrivateKey();
  const attempts = [
    { payload: { pkpId: typeof expectedPkpId === "string" && expectedPkpId.trim() ? expectedPkpId.trim() : expectedSignerAddress } },
    { payload: { pkpAddress: expectedSignerAddress } },
  ];
  for (const attempt of attempts) {
    try {
      const privateKey = normalizePrivateKey(await getPrivateKey(attempt.payload));
      const signerAddress = requireAddress(new Wallet(privateKey).address, "pkpAddress");
      if (signerAddress === expectedSignerAddress) return privateKey;
    } catch {}
  }
  fail("pkp_private_key_resolution_failed", { expected: expectedSignerAddress });
}

export async function main(firstArg) {
  const params = resolveJsParams(firstArg);
  const unsignedTx = params.unsignedTx || {};
  const expectedSignerAddress = requireAddress(params.expectedSignerAddress, "expectedSignerAddress");
  const expectedPkpId = typeof params.expectedPkpId === "string" ? params.expectedPkpId.trim() : "";
  const txTo = requireAddress(unsignedTx.to, "unsignedTx.to");
  const txValue = BigInt(requireUintString(unsignedTx.value ?? "0", "unsignedTx.value"));
  const txChainId = Number(unsignedTx.chainId);
  const txType = Number(unsignedTx.type ?? 2);
  const gasLimit = BigInt(requireUintString(unsignedTx.gasLimit ?? "0", "unsignedTx.gasLimit"));
  const maxFeePerGas = BigInt(requireUintString(unsignedTx.maxFeePerGas ?? "0", "unsignedTx.maxFeePerGas"));
  const maxPriorityFeePerGas = BigInt(requireUintString(unsignedTx.maxPriorityFeePerGas ?? "0", "unsignedTx.maxPriorityFeePerGas"));
  const txData = String(unsignedTx.data || "0x").toLowerCase();
  if (!Number.isInteger(txChainId) || txChainId !== 1315) fail("tx_chain_id_mismatch", { txChainId, expected: 1315 });
  if (!Number.isInteger(txType) || txType !== 2) fail("tx_type_mismatch", { txType, expected: 2 });
  if (txData !== "0x") fail("tx_data_not_empty");
  if (txValue <= 0n) fail("tx_value_not_positive", { txValue: txValue.toString() });
  if (gasLimit <= 0n || maxFeePerGas <= 0n || maxPriorityFeePerGas <= 0n) fail("tx_fee_or_gas_invalid");
  if (maxPriorityFeePerGas > maxFeePerGas) fail("tx_fee_priority_exceeds_max");

  const privateKey = await resolveExpectedPrivateKey(expectedSignerAddress, expectedPkpId || null);
  const wallet = new Wallet(privateKey);
  const signerAddress = requireAddress(wallet.address, "wallet.address");
  if (signerAddress !== expectedSignerAddress) fail("pkp_address_mismatch", { signerAddress, expected: expectedSignerAddress });

  const signedTx = await wallet.signTransaction({
    type: txType,
    chainId: txChainId,
    nonce: Number(unsignedTx.nonce ?? 0),
    to: txTo,
    value: txValue,
    data: txData,
    gasLimit,
    maxFeePerGas,
    maxPriorityFeePerGas,
  });

  return JSON.stringify({
    ok: true,
    action: "sign-native-transfer-v1",
    signerAddress,
    serializedTx: signedTx,
  });
}
