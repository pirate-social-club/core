import fs from "node:fs/promises";
import path from "node:path";
import {
  assertAddress,
  getFamily,
  loadLitFamilies,
  loadStoryDelivery,
  repoRoot,
  resolveFamilyAddress,
  resolveFamilyPublicKey,
  resolveStoryDeliveryContract,
  resolveStoryDeployRpc
} from "./_lib/config.mjs";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const DEFAULT_TEMPLATE_DIR = "lit-actions/story-operator";
const DEFAULT_OUT_DIR = "lit-actions/story-operator/stamped";

const ACTIONS = [
  {
    key: "publish-asset-version",
    templateName: "publish-asset-version.js",
    outName: "publish-asset-version.stamped.js",
    contractField: "assetPublishCoordinatorV1"
  }
];

function parseArgs(argv) {
  const args = {};
  const flags = new Set();
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      continue;
    }
    const key = token.slice(2).trim();
    const value = (argv[index + 1] || "").trim();
    if (!key) {
      continue;
    }
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

async function stampAction(params) {
  const templatePath = path.join(params.templatesDir, params.action.templateName);
  const outPath = path.join(params.outDir, params.action.outName);

  let source = await fs.readFile(templatePath, "utf8");
  source = rewriteStampedImportPaths(source);
  source = replaceExpectedField(source, "contractAddress", params.contractAddress);
  source = replaceExpectedField(source, "pkpAddress", params.pkpAddress);
  source = replaceExpectedField(source, "pkpPublicKey", params.pkpPublicKey);
  source = replaceExpectedField(source, "rpcUrl", params.rpcUrl);

  if (!params.dryRun) {
    await fs.mkdir(path.dirname(outPath), { recursive: true });
    await fs.writeFile(outPath, source, "utf8");
  }

  return {
    action: params.action.key,
    templatePath,
    outPath,
    contractAddress: params.contractAddress,
    pkpAddress: params.pkpAddress,
    rpcUrl: params.rpcUrl
  };
}

async function main() {
  const { args, flags } = parseArgs(process.argv.slice(2));
  const dryRun = flags.has("dry-run");

  const templatesDir = path.resolve(repoRoot, maybe(args["templates-dir"]) || DEFAULT_TEMPLATE_DIR);
  const outDir = path.resolve(repoRoot, maybe(args["out-dir"]) || DEFAULT_OUT_DIR);
  const actionFilter = maybe(args.action);

  const litFamilies = loadLitFamilies();
  const storyDelivery = loadStoryDelivery();
  const family = getFamily(litFamilies, "story-operator", "dev");

  const pkpAddress = resolveFamilyAddress(family, "story-operator");
  const pkpPublicKey = resolveFamilyPublicKey(
    family,
    "story-operator",
    maybe(args["pkp-public-key"]) || maybe(process.env.STORY_OPERATOR_PKP_PUBLIC_KEY)
  );
  const rpcUrl = maybe(args["story-rpc-url"]) || maybe(process.env.STORY_RPC_URL) || resolveStoryDeployRpc(storyDelivery);

  const selectedActions = actionFilter
    ? ACTIONS.filter((action) => action.key === actionFilter)
    : ACTIONS;

  if (selectedActions.length === 0) {
    throw new Error(`unknown action: ${actionFilter}`);
  }

  const results = [];
  for (const action of selectedActions) {
    const contractAddress =
      maybe(args["contract-address"]) && selectedActions.length === 1
        ? assertAddress(maybe(args["contract-address"]), "contract-address")
        : resolveStoryDeliveryContract(storyDelivery, action.contractField);

    if (contractAddress === ZERO_ADDRESS) {
      throw new Error(`contract address resolved to zero for ${action.key}`);
    }

    results.push(
      await stampAction({
        action,
        templatesDir,
        outDir,
        contractAddress,
        pkpAddress,
        pkpPublicKey,
        rpcUrl,
        dryRun
      })
    );
  }

  console.log(
    JSON.stringify(
      {
        dryRun,
        templatesDir,
        outDir,
        pkpAddress,
        rpcUrl,
        actions: results
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[story-operator-stamp] ${message}`);
  process.exit(1);
});
