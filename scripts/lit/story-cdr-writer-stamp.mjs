import fs from "node:fs/promises";
import path from "node:path";
import {
  assertAddress,
  getFamily,
  loadLitFamilies,
  repoRoot,
  resolveFamilyAddress,
  resolveFamilyPublicKey,
} from "./_lib/config.mjs";

const CDR_TESTNET_ADDRESS = "0xcccccc0000000000000000000000000000000005";
const DEFAULT_TEMPLATE_DIR = "lit-actions/story-cdr-writer";
const DEFAULT_OUT_DIR = "lit-actions/story-cdr-writer/stamped";

const ACTION = {
  key: "allocate-write",
  templateName: "allocate-write.js",
  outName: "allocate-write.stamped.js",
};

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

function maybe(value) {
  const normalized = String(value || "").trim();
  return normalized || undefined;
}

function replaceExpectedField(source, field, quotedValue) {
  const pattern = new RegExp(`(\\n\\s*${field}:\\s*)\"[^\"]*\"(,?)`);
  if (!pattern.test(source)) {
    throw new Error(`failed to find EXPECTED.${field} in template`);
  }
  return source.replace(pattern, `$1"${quotedValue}"$2`);
}

function rewriteStampedImportPaths(source) {
  return source.replace(/from "\.\/_shared\.js";/g, 'from "../_shared.js";');
}

async function main() {
  const { args, flags } = parseArgs(process.argv.slice(2));
  const dryRun = flags.has("dry-run");
  const templatesDir = path.resolve(repoRoot, maybe(args["templates-dir"]) || DEFAULT_TEMPLATE_DIR);
  const outDir = path.resolve(repoRoot, maybe(args["out-dir"]) || DEFAULT_OUT_DIR);

  const litFamilies = loadLitFamilies();
  const family = getFamily(litFamilies, "story-cdr-writer", "dev");
  const pkpAddress = resolveFamilyAddress(family, "story-cdr-writer");
  const pkpPublicKey = resolveFamilyPublicKey(
    family,
    "story-cdr-writer",
    maybe(args["pkp-public-key"]) || maybe(process.env.STORY_CDR_WRITER_PKP_PUBLIC_KEY),
  );
  const contractAddress = assertAddress(
    maybe(args["contract-address"]) || CDR_TESTNET_ADDRESS,
    "contract-address",
  );
  const rpcUrl = maybe(args["story-rpc-url"]) || maybe(process.env.STORY_RPC_URL) || "https://aeneid.storyrpc.io";

  const templatePath = path.join(templatesDir, ACTION.templateName);
  const outPath = path.join(outDir, ACTION.outName);
  let source = await fs.readFile(templatePath, "utf8");
  source = rewriteStampedImportPaths(source);
  source = replaceExpectedField(source, "contractAddress", contractAddress);
  source = replaceExpectedField(source, "pkpAddress", pkpAddress);
  source = replaceExpectedField(source, "pkpPublicKey", pkpPublicKey);
  source = replaceExpectedField(source, "rpcUrl", rpcUrl);

  if (!dryRun) {
    await fs.mkdir(path.dirname(outPath), { recursive: true });
    await fs.writeFile(outPath, source, "utf8");
  }

  console.log(
    JSON.stringify(
      {
        dryRun,
        templatesDir,
        outDir,
        action: ACTION.key,
        contractAddress,
        pkpAddress,
        rpcUrl,
        outPath,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[story-cdr-writer-stamp] ${message}`);
  process.exit(1);
});
