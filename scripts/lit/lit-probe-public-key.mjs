#!/usr/bin/env bun

import path from "node:path";
import { bundleLitActionSource } from "./_lib/action-source.mjs";
import { DEFAULT_BASE_URL, asNonEmpty, litApiRequest, maybe } from "./_lib/lit-api.mjs";

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2).trim();
    const value = (argv[index + 1] || "").trim();
    if (!key || !value || value.startsWith("--")) continue;
    args[key] = value;
    index += 1;
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const baseUrl = (maybe(args["base-url"]) || maybe(process.env.LIT_CHIPOTLE_API_BASE_URL) || DEFAULT_BASE_URL).replace(/\/+$/, "");
  const usageApiKey = maybe(args["usage-key"]) || maybe(process.env.LIT_CHIPOTLE_OPERATOR_API_KEY);
  if (!usageApiKey) {
    throw new Error("Missing usage key: set --usage-key or LIT_CHIPOTLE_OPERATOR_API_KEY");
  }

  const filePath = path.resolve(asNonEmpty(args.file, "file"));
  const pkpId = asNonEmpty(args["pkp-id"], "pkp-id");
  const { sourceCode } = await bundleLitActionSource(filePath, undefined);

  const execution = await litApiRequest({
    baseUrl,
    path: "/core/v1/lit_action",
    method: "POST",
    apiKey: usageApiKey,
    body: {
      code: sourceCode,
      js_params: { pkpId }
    }
  });

  const parsed = typeof execution.response === "string" ? JSON.parse(execution.response) : execution.response;
  if (!parsed || parsed.ok !== true) {
    throw new Error(`lit_probe_invalid_response:${JSON.stringify(execution).slice(0, 1000)}`);
  }

  console.log(JSON.stringify(parsed, null, 2));
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[lit-probe-public-key] ${message}`);
  process.exit(1);
});
