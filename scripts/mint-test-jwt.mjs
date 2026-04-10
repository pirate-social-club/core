#!/usr/bin/env bun

import { createHmac } from "node:crypto";

function usage() {
  console.error(`Usage:
  bun scripts/mint-test-jwt.mjs --issuer ISS --audience AUD --subject SUB --secret SECRET [options]

Options:
  --expires-in SECONDS   Token lifetime in seconds. Default: 3600
  --not-before SECONDS   Optional nbf offset from now. Default: 0
  --json                 Print header and payload JSON alongside the token
`);
}

function parseArgs(argv) {
  const result = {
    expiresIn: 3600,
    notBefore: 0,
    json: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--json") {
      result.json = true;
      continue;
    }

    const value = argv[i + 1];
    if (value == null) {
      throw new Error(`missing value for ${arg}`);
    }

    switch (arg) {
      case "--issuer":
        result.issuer = value;
        i += 1;
        break;
      case "--audience":
        result.audience = value;
        i += 1;
        break;
      case "--subject":
        result.subject = value;
        i += 1;
        break;
      case "--secret":
        result.secret = value;
        i += 1;
        break;
      case "--expires-in":
        result.expiresIn = Number.parseInt(value, 10);
        i += 1;
        break;
      case "--not-before":
        result.notBefore = Number.parseInt(value, 10);
        i += 1;
        break;
      default:
        throw new Error(`unknown argument: ${arg}`);
    }
  }

  if (!result.issuer || !result.audience || !result.subject || !result.secret) {
    throw new Error("issuer, audience, subject, and secret are required");
  }

  if (!Number.isFinite(result.expiresIn) || result.expiresIn <= 0) {
    throw new Error("--expires-in must be a positive integer");
  }

  if (!Number.isFinite(result.notBefore) || result.notBefore < 0) {
    throw new Error("--not-before must be a non-negative integer");
  }

  return result;
}

function base64url(input) {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

try {
  const args = parseArgs(process.argv.slice(2));
  const now = Math.floor(Date.now() / 1000);
  const header = {
    alg: "HS256",
    typ: "JWT",
  };
  const payload = {
    iss: args.issuer,
    aud: args.audience,
    sub: args.subject,
    iat: now,
    nbf: now + args.notBefore,
    exp: now + args.expiresIn,
  };

  const signingInput = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(payload))}`;
  const signature = createHmac("sha256", args.secret)
    .update(signingInput)
    .digest("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
  const token = `${signingInput}.${signature}`;

  if (args.json) {
    console.log(JSON.stringify({ header, payload, token }, null, 2));
  } else {
    console.log(token);
  }
} catch (error) {
  usage();
  console.error(`error: ${error.message}`);
  process.exit(1);
}
