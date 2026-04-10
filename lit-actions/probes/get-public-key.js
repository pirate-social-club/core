import { Wallet } from "ethers";

function fail(message, details = {}) {
  throw new Error(`${message}${Object.keys(details).length ? ` ${JSON.stringify(details)}` : ""}`);
}

function normalizePrivateKey(value) {
  if (typeof value === "string") {
    const trimmed = value.trim();
    const withPrefix = trimmed.startsWith("0x") ? trimmed : `0x${trimmed}`;
    if (!/^0x[0-9a-fA-F]{64}$/.test(withPrefix)) {
      fail("invalid_private_key_string");
    }
    return withPrefix.toLowerCase();
  }
  if (value instanceof Uint8Array) {
    if (value.length !== 32) {
      fail("invalid_private_key_bytes");
    }
    return `0x${Array.from(value).map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
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
  return params.jsParams && typeof params.jsParams === "object"
    ? { ...params.jsParams, ...params }
    : params;
}

export async function main(firstArg) {
  const params = resolveJsParams(firstArg);
  const pkpId = String(params.pkpId || "").trim();
  if (!/^0x[0-9a-fA-F]{40}$/.test(pkpId)) {
    fail("invalid_pkp_id");
  }

  const getPrivateKey = resolveGetPrivateKey();
  const privateKey = normalizePrivateKey(await getPrivateKey({ pkpId }));
  const wallet = new Wallet(privateKey);

  return JSON.stringify({
    ok: true,
    requestedPkpId: pkpId,
    address: wallet.address,
    publicKey: wallet.signingKey.publicKey
  });
}
