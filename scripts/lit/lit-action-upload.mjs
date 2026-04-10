#!/usr/bin/env bun

import fs from "node:fs/promises";
import path from "node:path";
import {
  assertNoModuleLinkage,
  bundleLitActionSource,
  findCriticalExpectedPlaceholders,
  parseOptionalPositiveInt,
  sourceByteLength
} from "./_lib/action-source.mjs";
import { DEFAULT_BASE_URL, asNonEmpty, getLitActionCid, hashActionCid, maybe, toCanonicalIpfsUri } from "./_lib/lit-api.mjs";

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

async function main() {
  const { args, flags } = parseArgs(process.argv.slice(2));
  const filePath = path.resolve(asNonEmpty(args.file, "file"));
  const outFile = maybe(args["out-file"]) ? path.resolve(args["out-file"]) : null;
  const baseUrl = (maybe(args["base-url"]) || maybe(process.env.LIT_CHIPOTLE_API_BASE_URL) || DEFAULT_BASE_URL).replace(/\/+$/, "");
  const shouldBundle = !flags.has("no-bundle");
  const allowPlaceholders = flags.has("allow-placeholders");
  const maxBytes = parseOptionalPositiveInt(args["max-bytes"], "max-bytes");

  const rawSource = (await fs.readFile(filePath, "utf8")).replace(/\r\n/g, "\n");
  if (!rawSource.trim()) {
    throw new Error("Lit Action source file is empty");
  }

  const placeholderFields = findCriticalExpectedPlaceholders(rawSource);
  if (!allowPlaceholders && placeholderFields.length > 0) {
    throw new Error(
      `Lit Action source still has placeholder EXPECTED values (${placeholderFields.join(", ")}); stamp it with real constants first`
    );
  }

  let sourceCode = rawSource;
  let sourceBytes = sourceByteLength(rawSource);
  if (shouldBundle) {
    const bundled = await bundleLitActionSource(filePath, maxBytes);
    sourceCode = bundled.sourceCode;
    sourceBytes = bundled.sourceBytes;
  } else {
    assertNoModuleLinkage(sourceCode, "raw (--no-bundle)");
    if (maxBytes != null && sourceBytes > maxBytes) {
      throw new Error(`raw Lit Action exceeds max-bytes (${sourceBytes} > ${maxBytes})`);
    }
  }

  if (outFile) {
    await fs.mkdir(path.dirname(outFile), { recursive: true });
    await fs.writeFile(outFile, sourceCode, "utf8");
  }

  const cid = await getLitActionCid(baseUrl, sourceCode);
  const result = {
    filePath,
    bundled: shouldBundle,
    sourceBytes,
    cid,
    ref: toCanonicalIpfsUri(cid),
    cidHash: hashActionCid(cid),
    outFile
  };

  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[lit-action-upload] ${message}`);
  process.exit(1);
});
