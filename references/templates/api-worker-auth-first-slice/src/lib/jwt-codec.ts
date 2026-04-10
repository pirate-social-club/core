import { sign as nodeSign, verify as nodeVerify } from "node:crypto";
import { authError } from "./errors";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

type JwtHeader = {
  alg: string;
  typ?: string;
};

type JwtPayload = Record<string, unknown> & {
  iss?: string;
  sub?: string;
  aud?: string | string[];
  exp?: number;
  iat?: number;
  nbf?: number;
};

function base64UrlToBase64(input: string): string {
  const normalized = input.replace(/-/g, "+").replace(/_/g, "/");
  const paddingLength = (4 - (normalized.length % 4)) % 4;
  return `${normalized}${"=".repeat(paddingLength)}`;
}

function base64ToBase64Url(input: string): string {
  return input.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function decodeBase64(input: string): Uint8Array {
  const raw = atob(base64UrlToBase64(input));
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) {
    bytes[i] = raw.charCodeAt(i);
  }
  return bytes;
}

function encodeBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return base64ToBase64Url(btoa(binary));
}

function parseJsonSegment<T>(segment: string): T {
  try {
    return JSON.parse(decoder.decode(decodeBase64(segment))) as T;
  } catch {
    throw authError();
  }
}

export function splitJwt(token: string): {
  signingInput: string;
  headerSegment: string;
  payloadSegment: string;
  signatureSegment: string;
} {
  const parts = token.split(".");
  if (parts.length !== 3 || parts.some((part) => part.length === 0)) {
    throw authError();
  }

  return {
    signingInput: `${parts[0]}.${parts[1]}`,
    headerSegment: parts[0],
    payloadSegment: parts[1],
    signatureSegment: parts[2],
  };
}

export function decodeJwt(token: string): {
  signingInput: string;
  header: JwtHeader;
  payload: JwtPayload;
  signature: Uint8Array;
} {
  const split = splitJwt(token);
  return {
    signingInput: split.signingInput,
    header: parseJsonSegment<JwtHeader>(split.headerSegment),
    payload: parseJsonSegment<JwtPayload>(split.payloadSegment),
    signature: decodeBase64(split.signatureSegment),
  };
}

export function encodeJwt(input: {
  header: JwtHeader;
  payload: JwtPayload;
  signature: Uint8Array;
}): string {
  const headerSegment = encodeBase64(encoder.encode(JSON.stringify(input.header)));
  const payloadSegment = encodeBase64(encoder.encode(JSON.stringify(input.payload)));
  const signatureSegment = encodeBase64(input.signature);
  return `${headerSegment}.${payloadSegment}.${signatureSegment}`;
}

export function assertStandardClaims(input: {
  payload: JwtPayload;
  issuer: string;
  audience: string;
  nowSeconds: number;
}) {
  if (input.payload.iss !== input.issuer) {
    throw authError();
  }

  const audience = input.payload.aud;
  if (typeof audience === "string") {
    if (audience !== input.audience) {
      throw authError();
    }
  } else if (Array.isArray(audience)) {
    if (!audience.includes(input.audience)) {
      throw authError();
    }
  } else {
    throw authError();
  }

  if (typeof input.payload.sub !== "string" || input.payload.sub.length === 0) {
    throw authError();
  }

  if (typeof input.payload.exp !== "number" || input.payload.exp <= input.nowSeconds) {
    throw authError();
  }

  if (input.payload.nbf != null && (typeof input.payload.nbf !== "number" || input.payload.nbf > input.nowSeconds)) {
    throw authError();
  }

  if (input.payload.iat != null && typeof input.payload.iat !== "number") {
    throw authError();
  }
}

export async function importHmacKey(secret: string, usages: KeyUsage[]): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    {
      name: "HMAC",
      hash: "SHA-256",
    },
    false,
    usages
  );
}

export async function importPkcs8PrivateKey(pem: string, usages: KeyUsage[]): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "pkcs8",
    decodePem(pem),
    {
      name: "RSASSA-PKCS1-v1_5",
      hash: "SHA-256",
    },
    false,
    usages
  );
}

export async function importSpkiPublicKey(pem: string, usages: KeyUsage[]): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "spki",
    decodePem(pem),
    {
      name: "RSASSA-PKCS1-v1_5",
      hash: "SHA-256",
    },
    false,
    usages
  );
}

export async function signHmacSha256(input: {
  signingInput: string;
  secret: string;
}): Promise<Uint8Array> {
  const key = await importHmacKey(input.secret, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(input.signingInput));
  return new Uint8Array(signature);
}

export async function verifyHmacSha256(input: {
  signingInput: string;
  secret: string;
  signature: Uint8Array;
}): Promise<boolean> {
  const key = await importHmacKey(input.secret, ["verify"]);
  return crypto.subtle.verify("HMAC", key, toArrayBuffer(input.signature), encoder.encode(input.signingInput));
}

export async function signRs256(input: {
  signingInput: string;
  privateKeyPem: string;
}): Promise<Uint8Array> {
  const key = await importPkcs8PrivateKey(input.privateKeyPem, ["sign"]);
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, encoder.encode(input.signingInput));
  return new Uint8Array(signature);
}

export async function verifyRs256(input: {
  signingInput: string;
  publicKeyPem: string;
  signature: Uint8Array;
}): Promise<boolean> {
  const key = await importSpkiPublicKey(input.publicKeyPem, ["verify"]);
  return crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    key,
    toArrayBuffer(input.signature),
    encoder.encode(input.signingInput),
  );
}

export async function signEs256(input: {
  signingInput: string;
  privateKeyPem: string;
}): Promise<Uint8Array> {
  const signature = nodeSign("sha256", Buffer.from(input.signingInput), {
    key: input.privateKeyPem,
    dsaEncoding: "ieee-p1363",
  });
  return new Uint8Array(signature);
}

export async function verifyEs256(input: {
  signingInput: string;
  publicKeyPem: string;
  signature: Uint8Array;
}): Promise<boolean> {
  return nodeVerify(
    "sha256",
    Buffer.from(input.signingInput),
    {
      key: input.publicKeyPem,
      dsaEncoding: "ieee-p1363",
    },
    Buffer.from(input.signature),
  );
}

function decodePem(pem: string): ArrayBuffer {
  const normalized = pem
    .replace(/-----BEGIN [^-]+-----/g, "")
    .replace(/-----END [^-]+-----/g, "")
    .replace(/\s+/g, "");

  const raw = atob(normalized);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) {
    bytes[i] = raw.charCodeAt(i);
  }
  return bytes.buffer;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const { buffer, byteOffset, byteLength } = bytes;
  if (buffer instanceof ArrayBuffer && byteOffset === 0 && byteLength === buffer.byteLength) {
    return buffer;
  }

  return buffer.slice(byteOffset, byteOffset + byteLength) as ArrayBuffer;
}
