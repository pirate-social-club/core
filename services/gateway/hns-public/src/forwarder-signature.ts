export const FORWARDER_SIGNATURE_HEADER = "x-pirate-hns-forwarder-signature";
export const FORWARDER_TIMESTAMP_HEADER = "x-pirate-hns-forwarder-timestamp";
export const FORWARDER_PATH_HEADER = "x-pirate-hns-forwarder-path";
export const FORWARDER_SIGNATURE_VERSION = "v1";
export const MIN_FORWARDER_HMAC_KEY_BYTES = 32;

const encoder = new TextEncoder();

export type HnsForwarderContext = {
  communityId?: string | null;
  communityRoute?: string | null;
  host: string;
  method: string;
  pathAndQuery: string;
  root?: string | null;
  subdomain?: string | null;
  timestamp: string;
};

export function isValidForwarderHmacKey(value: string): boolean {
  return encoder.encode(value).byteLength >= MIN_FORWARDER_HMAC_KEY_BYTES;
}

export function canonicalizeForwarderContext(context: HnsForwarderContext): string {
  return JSON.stringify([
    "pirate-hns-forwarder-v1",
    context.timestamp,
    context.method.toUpperCase(),
    context.host.trim().toLowerCase().replace(/\.+$/u, ""),
    context.pathAndQuery,
    context.root?.trim() ?? "",
    context.communityId?.trim() ?? "",
    context.communityRoute?.trim() ?? "",
    context.subdomain?.trim() ?? "",
  ]);
}

function bytesToHex(value: ArrayBuffer): string {
  return [...new Uint8Array(value)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function signForwarderContext(
  context: HnsForwarderContext,
  secret: string,
): Promise<string> {
  if (!isValidForwarderHmacKey(secret)) {
    throw new Error(`HNS forwarder HMAC key must be at least ${MIN_FORWARDER_HMAC_KEY_BYTES} bytes`);
  }

  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(canonicalizeForwarderContext(context)),
  );
  return `${FORWARDER_SIGNATURE_VERSION}=${bytesToHex(signature)}`;
}
