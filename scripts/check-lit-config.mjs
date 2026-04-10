import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const repoRoot = process.cwd();
const litConfigPath = path.join(repoRoot, "config", "lit-families.json");
const deliveryManifestPath = path.join(repoRoot, "config", "story-aeneid-delivery.json");
const signerFamiliesPath = path.join(repoRoot, "docs", "signer-families.md");
const fundsLedgerPath = path.join(repoRoot, "docs", "funds-ledger.md");

function fail(message) {
  throw new Error(message);
}

function assert(condition, message) {
  if (!condition) fail(message);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function readText(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isAddress(value) {
  return /^0x[a-fA-F0-9]{40}$/.test(value);
}

function isPublicKey(value) {
  return /^0x[a-fA-F0-9]{130}$/.test(value);
}

function isIpfsCid(value) {
  return /^ipfs:\/\/.+/.test(value);
}

function slugifyHeading(value) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-");
}

function extractAnchors(markdown, headingPrefix) {
  const anchors = new Set();
  const pattern = new RegExp(`^${headingPrefix}\\s+(.+)$`, "gm");
  let match;

  while ((match = pattern.exec(markdown)) !== null) {
    anchors.add(slugifyHeading(match[1]));
  }

  return anchors;
}

function extractCodeTokens(markdown) {
  const tokens = new Set();
  const pattern = /`([^`]+)`/g;
  let match;

  while ((match = pattern.exec(markdown)) !== null) {
    tokens.add(match[1]);
  }

  return tokens;
}

function validateAction(action, envName, familyName, seenActionNames) {
  assert(isObject(action), `${envName}/${familyName}: action must be an object`);
  for (const field of ["name", "cid", "contractMethod", "contract"]) {
    assert(typeof action[field] === "string", `${envName}/${familyName}: action.${field} must be a string`);
    assert(action[field].length > 0, `${envName}/${familyName}: action.${field} must not be empty`);
  }

  assert(/^[a-z0-9-]+$/.test(action.name), `${envName}/${familyName}: invalid action name ${action.name}`);
  assert(action.cid === "TBD" || isIpfsCid(action.cid), `${envName}/${familyName}: invalid CID ${action.cid}`);
  assert(!seenActionNames.has(action.name), `${envName}/${familyName}: duplicate action name ${action.name}`);
  seenActionNames.add(action.name);
}

function validateFamily(family, envName, signerAnchors, fundsPlaceholders, usageKeyNames, executeGroups) {
  assert(isObject(family), `${envName}: family entry must be an object`);

  const requiredFields = [
    "family",
    "chain",
    "chainId",
    "executeGroup",
    "pkpAddress",
    "pkpPublicKey",
    "usageKeyEnvVar",
    "signerFamilyRef",
    "fundsLedgerPlaceholder",
    "actions"
  ];

  for (const field of requiredFields) {
    assert(field in family, `${envName}: family missing ${field}`);
  }

  assert(/^[a-z0-9-]+$/.test(family.family), `${envName}: invalid family name ${family.family}`);
  assert(/^[a-z0-9-]+$/.test(family.chain), `${envName}/${family.family}: invalid chain ${family.chain}`);
  assert(Number.isInteger(family.chainId) && family.chainId > 0, `${envName}/${family.family}: invalid chainId`);
  assert(/^[a-z0-9-]+$/.test(family.executeGroup), `${envName}/${family.family}: invalid executeGroup`);
  assert(
    family.pkpAddress === "TBD" || isAddress(family.pkpAddress),
    `${envName}/${family.family}: invalid pkpAddress ${family.pkpAddress}`
  );
  assert(
    family.pkpPublicKey === "TBD" || isPublicKey(family.pkpPublicKey),
    `${envName}/${family.family}: invalid pkpPublicKey`
  );
  assert(
    /^[A-Z0-9_]+$/.test(family.usageKeyEnvVar),
    `${envName}/${family.family}: invalid usageKeyEnvVar ${family.usageKeyEnvVar}`
  );
  assert(
    /^docs\/signer-families\.md#[a-z0-9-]+$/.test(family.signerFamilyRef),
    `${envName}/${family.family}: invalid signerFamilyRef ${family.signerFamilyRef}`
  );
  assert(
    family.fundsLedgerPlaceholder === null ||
    /^[A-Z0-9_]+$/.test(family.fundsLedgerPlaceholder),
    `${envName}/${family.family}: invalid fundsLedgerPlaceholder ${family.fundsLedgerPlaceholder}`
  );
  assert(Array.isArray(family.actions) && family.actions.length > 0, `${envName}/${family.family}: actions required`);

  assert(!usageKeyNames.has(family.usageKeyEnvVar), `${envName}: duplicate usageKeyEnvVar ${family.usageKeyEnvVar}`);
  usageKeyNames.add(family.usageKeyEnvVar);

  assert(!executeGroups.has(family.executeGroup), `${envName}: duplicate executeGroup ${family.executeGroup}`);
  executeGroups.add(family.executeGroup);

  const signerAnchor = family.signerFamilyRef.split("#")[1];
  assert(
    signerAnchors.has(signerAnchor),
    `${envName}/${family.family}: signerFamilyRef anchor not found in docs/signer-families.md: ${signerAnchor}`
  );

  if (family.fundsLedgerPlaceholder !== null) {
    assert(
      fundsPlaceholders.has(family.fundsLedgerPlaceholder),
      `${envName}/${family.family}: expected funds-ledger placeholder missing: ${family.fundsLedgerPlaceholder}`
    );
  }

  const seenActionNames = new Set();
  for (const action of family.actions) {
    validateAction(action, envName, family.family, seenActionNames);
  }
}

function validateConfig(config, signerAnchors, fundsPlaceholders) {
  assert(isObject(config), "lit-families.json must be an object");
  assert(typeof config.$schema === "string" && config.$schema.length > 0, "$schema is required");
  assert(Number.isInteger(config.version) && config.version > 0, "version must be a positive integer");
  assert(typeof config.description === "string" && config.description.length > 0, "description is required");
  assert(isObject(config.environments), "environments must be an object");

  const familyKeysByEnv = new Map();

  for (const [envName, envConfig] of Object.entries(config.environments)) {
    assert(/^[a-z0-9-]+$/.test(envName), `invalid environment name ${envName}`);
    assert(isObject(envConfig), `${envName}: environment must be an object`);
    assert(typeof envConfig.litApiBaseUrl === "string" && envConfig.litApiBaseUrl.startsWith("http"), `${envName}: invalid litApiBaseUrl`);
    assert(Array.isArray(envConfig.families) && envConfig.families.length > 0, `${envName}: families must be a non-empty array`);

    const seenFamilies = new Set();
    const usageKeyNames = new Set();
    const executeGroups = new Set();

    for (const family of envConfig.families) {
      assert(!seenFamilies.has(family.family), `${envName}: duplicate family ${family.family}`);
      seenFamilies.add(family.family);
      validateFamily(family, envName, signerAnchors, fundsPlaceholders, usageKeyNames, executeGroups);
    }

    familyKeysByEnv.set(envName, seenFamilies);
  }

  return familyKeysByEnv;
}

function familyMapByName(envConfig) {
  const byName = new Map();
  for (const family of envConfig.families) {
    byName.set(family.family, family);
  }
  return byName;
}

function validateDeliveryManifest(manifest, litConfig) {
  assert(isObject(manifest), "story-aeneid-delivery.json must be an object");
  assert(typeof manifest.$schema === "string" && manifest.$schema.length > 0, "story-aeneid-delivery.json: $schema is required");

  assert(isObject(manifest.network), "story-aeneid-delivery.json: network must be an object");
  assert(manifest.network.name === "story-aeneid", "story-aeneid-delivery.json: network.name must be story-aeneid");
  assert(manifest.network.chainId === 1315, "story-aeneid-delivery.json: network.chainId must be 1315");
  assert(
    typeof manifest.network.deployRpcUrl === "string" && manifest.network.deployRpcUrl.startsWith("http"),
    "story-aeneid-delivery.json: network.deployRpcUrl must be an http(s) URL"
  );

  assert(isObject(manifest.deployment), "story-aeneid-delivery.json: deployment must be an object");
  assert(
    typeof manifest.deployment.tag === "string" && /^[a-z0-9-]+$/.test(manifest.deployment.tag),
    "story-aeneid-delivery.json: invalid deployment.tag"
  );
  assert(isAddress(manifest.deployment.deployerAddress), "story-aeneid-delivery.json: invalid deployment.deployerAddress");
  assert(isAddress(manifest.deployment.ownerAddress), "story-aeneid-delivery.json: invalid deployment.ownerAddress");
  assert(
    typeof manifest.deployment.completedAt === "string" && /^\d{4}-\d{2}-\d{2}$/.test(manifest.deployment.completedAt),
    "story-aeneid-delivery.json: invalid deployment.completedAt"
  );

  assert(isObject(manifest.contracts), "story-aeneid-delivery.json: contracts must be an object");
  const requiredContracts = [
    "purchaseEntitlementToken",
    "pirateSignerRegistry",
    "tokenGateCondition",
    "signedAccessConditionV1",
    "assetPublishCoordinatorV1",
    "marketplaceSettlementV1"
  ];

  const seenContractAddresses = new Set();
  for (const key of requiredContracts) {
    assert(isAddress(manifest.contracts[key]), `story-aeneid-delivery.json: invalid contracts.${key}`);
    assert(
      !seenContractAddresses.has(manifest.contracts[key].toLowerCase()),
      `story-aeneid-delivery.json: duplicate contract address ${manifest.contracts[key]}`
    );
    seenContractAddresses.add(manifest.contracts[key].toLowerCase());
  }

  assert(isObject(manifest.grants), "story-aeneid-delivery.json: grants must be an object");
  assert(isAddress(manifest.grants.publishOperator), "story-aeneid-delivery.json: invalid grants.publishOperator");
  assert(isAddress(manifest.grants.settlementOperator), "story-aeneid-delivery.json: invalid grants.settlementOperator");
  assert(isAddress(manifest.grants.accessProofSigner), "story-aeneid-delivery.json: invalid grants.accessProofSigner");

  const devEnv = litConfig.environments.dev;
  assert(isObject(devEnv), "lit-families.json: missing dev environment required for delivery manifest checks");
  const families = familyMapByName(devEnv);

  const expectedGrantFamilies = new Map([
    ["publishOperator", "story-operator"],
    ["settlementOperator", "story-settlement"],
    ["accessProofSigner", "story-access-controller"]
  ]);

  for (const [grantKey, familyName] of expectedGrantFamilies.entries()) {
    const family = families.get(familyName);
    assert(family, `lit-families.json: missing ${familyName} family required for delivery manifest checks`);
    assert(
      family.pkpAddress !== "TBD",
      `lit-families.json: ${familyName}.pkpAddress must be concrete before validating story-aeneid-delivery.json`
    );
    assert(
      manifest.grants[grantKey].toLowerCase() === family.pkpAddress.toLowerCase(),
      `story-aeneid-delivery.json: grants.${grantKey} does not match ${familyName}.pkpAddress`
    );
  }
}

function validateCoverage(familyKeysByEnv, signerAnchors) {
  const devFamilies = familyKeysByEnv.get("dev") ?? new Set();

  for (const familyName of devFamilies) {
    assert(signerAnchors.has(familyName), `docs/signer-families.md: missing family heading for ${familyName}`);
  }
}

function main() {
  const litConfig = readJson(litConfigPath);
  const deliveryManifest = readJson(deliveryManifestPath);
  const signerFamilies = readText(signerFamiliesPath);
  const fundsLedger = readText(fundsLedgerPath);

  const signerAnchors = extractAnchors(signerFamilies, "###");
  const fundsPlaceholders = extractCodeTokens(fundsLedger);

  const familyKeysByEnv = validateConfig(litConfig, signerAnchors, fundsPlaceholders);
  validateCoverage(familyKeysByEnv, signerAnchors);
  validateDeliveryManifest(deliveryManifest, litConfig);

  console.log("lit-families check passed");
  for (const [envName, families] of familyKeysByEnv.entries()) {
    console.log(`- ${envName}: ${families.size} families`);
  }
  console.log("story-aeneid-delivery check passed");
}

try {
  main();
} catch (error) {
  console.error(`lit-families check failed: ${error.message}`);
  process.exit(1);
}
