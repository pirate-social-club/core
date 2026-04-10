import { Interface, Wallet, computeAddress, getAddress } from "ethers";

function fail(message, details = {}) {
  throw new Error(`${message}${Object.keys(details).length ? ` ${JSON.stringify(details)}` : ""}`);
}

function requireHex(value, field, bytesExact = null) {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]*$/.test(value)) {
    fail("invalid_hex", { field });
  }
  if (value.length % 2 !== 0) {
    fail("invalid_hex_length", { field });
  }
  if (bytesExact != null && (value.length - 2) / 2 !== bytesExact) {
    fail("invalid_hex_size", { field, expectedBytes: bytesExact });
  }
  return value.toLowerCase();
}

function requireAddress(value, field) {
  try {
    return getAddress(String(value || "")).toLowerCase();
  } catch {
    fail("invalid_address", { field });
  }
}

function requireBytes32(value, field) {
  return requireHex(value, field, 32);
}

function requireUintString(value, field) {
  const normalized = String(value ?? "").trim();
  if (!/^\d+$/.test(normalized)) {
    fail("invalid_uint", { field });
  }
  return normalized;
}

function normalizePrivateKey(value) {
  if (typeof value === "string") {
    const withPrefix = value.trim().startsWith("0x") ? value.trim() : `0x${value.trim()}`;
    if (!/^0x[0-9a-fA-F]{64}$/.test(withPrefix)) {
      fail("invalid_private_key_string");
    }
    return withPrefix.toLowerCase();
  }
  if (value instanceof Uint8Array) {
    if (value.length !== 32) {
      fail("invalid_private_key_bytes");
    }
    return `0x${Array.from(value).map((b) => b.toString(16).padStart(2, "0")).join("")}`;
  }
  fail("unsupported_private_key_type", { actualType: typeof value });
}

function resolveGetPrivateKey() {
  if (typeof Lit?.Actions?.getPrivateKey === "function") {
    return Lit.Actions.getPrivateKey.bind(Lit.Actions);
  }
  if (typeof LitActions?.getPrivateKey === "function") {
    return LitActions.getPrivateKey.bind(LitActions);
  }
  fail("get_private_key_unavailable");
}

function resolveJsParams(firstArg) {
  const rootParams = (firstArg && typeof firstArg === "object" ? firstArg : null)
    || globalThis.jsParams
    || globalThis.js_params
    || globalThis.params
    || {};
  const params = rootParams && typeof rootParams === "object" ? rootParams : {};
  return params.jsParams && typeof params.jsParams === "object"
    ? { ...params.jsParams, ...params }
    : params;
}

function parseUnsignedTxValue(unsignedTx, expected) {
  const expectedChainId = Number(expected.chainId ?? expected.storyChainId);
  if (!Number.isInteger(expectedChainId) || expectedChainId <= 0) {
    fail("expected_chain_id_invalid");
  }

  const txTo = requireAddress(String(unsignedTx.to || ""), "unsignedTx.to");
  if (txTo !== expected.contractAddress.toLowerCase()) {
    fail("tx_to_mismatch", { txTo, expected: expected.contractAddress });
  }

  const txValue = BigInt(requireUintString(unsignedTx.value ?? "0", "unsignedTx.value"));
  if (txValue !== 0n) {
    fail("tx_value_not_zero", { txValue: txValue.toString() });
  }

  const txChainId = Number(unsignedTx.chainId);
  if (!Number.isInteger(txChainId) || txChainId !== expectedChainId) {
    fail("tx_chain_id_mismatch", { txChainId, expected: expectedChainId });
  }

  const txType = Number(unsignedTx.type ?? 2);
  if (!Number.isInteger(txType) || txType !== 2) {
    fail("tx_type_mismatch", { txType, expected: 2 });
  }

  return {
    type: txType,
    chainId: txChainId,
    nonce: Number(unsignedTx.nonce ?? 0),
    to: txTo,
    value: txValue,
    data: requireHex(String(unsignedTx.data || ""), "unsignedTx.data"),
    gasLimit: BigInt(requireUintString(unsignedTx.gasLimit ?? "0", "unsignedTx.gasLimit")),
    maxFeePerGas: BigInt(requireUintString(unsignedTx.maxFeePerGas ?? "0", "unsignedTx.maxFeePerGas")),
    maxPriorityFeePerGas: BigInt(
      requireUintString(unsignedTx.maxPriorityFeePerGas ?? "0", "unsignedTx.maxPriorityFeePerGas")
    )
  };
}

function parseUnsignedTx(params, expected) {
  return parseUnsignedTxValue(params.unsignedTx || {}, expected);
}

function validateTxEnvelope(unsignedTx) {
  if (unsignedTx.maxFeePerGas <= 0n || unsignedTx.maxPriorityFeePerGas <= 0n) {
    fail("tx_fee_not_positive");
  }
  if (unsignedTx.maxPriorityFeePerGas > unsignedTx.maxFeePerGas) {
    fail("tx_fee_priority_exceeds_max");
  }
}

async function resolveExpectedPrivateKey(expected) {
  const getPrivateKey = resolveGetPrivateKey();
  const attempts = [
    { label: "pkpId", payload: { pkpId: expected.pkpAddress } },
    { label: "pkpAddress", payload: { pkpAddress: expected.pkpAddress } },
    { label: "pkpPublicKey", payload: { pkpPublicKey: expected.pkpPublicKey } },
    { label: "publicKey", payload: { publicKey: expected.pkpPublicKey } }
  ];

  const failures = [];
  for (const attempt of attempts) {
    try {
      const privateKey = normalizePrivateKey(await getPrivateKey(attempt.payload));
      const signerAddress = requireAddress(new Wallet(privateKey).address, "pkpAddress");
      if (signerAddress === expected.pkpAddress.toLowerCase()) {
        return privateKey;
      }
      failures.push({
        label: attempt.label,
        signerAddress
      });
    } catch (error) {
      failures.push({
        label: attempt.label,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  fail("pkp_private_key_resolution_failed", {
    expected: expected.pkpAddress,
    attempts: failures
  });
}

async function signConstrainedTx(firstArg, expected, abi, functionName, validateArgs) {
  const params = resolveJsParams(firstArg);
  const unsignedTx = parseUnsignedTx(params, expected);
  validateTxEnvelope(unsignedTx);

  const selector = unsignedTx.data.slice(0, 10).toLowerCase();
  if (selector !== expected.functionSelector.toLowerCase()) {
    fail("selector_mismatch", { selector, expected: expected.functionSelector });
  }

  const iface = new Interface(abi);
  let decoded;
  try {
    decoded = iface.decodeFunctionData(functionName, unsignedTx.data);
  } catch {
    fail("calldata_decode_failed");
  }

  validateArgs(decoded);

  const privateKey = await resolveExpectedPrivateKey(expected);
  const signerAddress = requireAddress(new Wallet(privateKey).address, "pkpAddress");
  if (signerAddress !== expected.pkpAddress.toLowerCase()) {
    fail("pkp_address_mismatch", { signerAddress, expected: expected.pkpAddress });
  }

  const derivedPublicKey = new Wallet(privateKey).signingKey.publicKey;
  if (requireHex(derivedPublicKey, "derivedPublicKey") !== expected.pkpPublicKey.toLowerCase()) {
    fail("pkp_public_key_mismatch", { derivedPublicKey, expected: expected.pkpPublicKey });
  }

  const computedAddress = requireAddress(computeAddress(expected.pkpPublicKey), "EXPECTED.pkpPublicKey");
  if (computedAddress !== expected.pkpAddress.toLowerCase()) {
    fail("expected_public_key_address_mismatch", { computedAddress, expected: expected.pkpAddress });
  }

  const signedTx = await new Wallet(privateKey).signTransaction(unsignedTx);
  return {
    ok: true,
    action: expected.actionName,
    signerAddress,
    publicKey: expected.pkpPublicKey,
    serializedTx: signedTx
  };
}

export {
  fail,
  requireAddress,
  requireBytes32,
  requireHex,
  requireUintString,
  resolveJsParams,
  signConstrainedTx
};
