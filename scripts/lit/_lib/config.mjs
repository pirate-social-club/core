import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..", "..", "..");

function fail(message) {
  throw new Error(message);
}

function readJson(relativePath) {
  const filePath = path.join(repoRoot, relativePath);
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function isAddress(value) {
  return /^0x[a-fA-F0-9]{40}$/.test(value);
}

function isPublicKey(value) {
  return /^0x[a-fA-F0-9]{130}$/.test(value);
}

function assertAddress(value, label) {
  if (!isAddress(value)) {
    fail(`invalid ${label}: ${value}`);
  }
  return value;
}

function assertPublicKey(value, label) {
  if (!isPublicKey(value)) {
    fail(`invalid ${label}`);
  }
  return value;
}

function loadLitFamilies() {
  return readJson("config/lit-families.json");
}

function loadStoryDelivery() {
  return readJson("config/story-aeneid-delivery.json");
}

function getFamily(litFamilies, familyName, envName = "dev") {
  const env = litFamilies?.environments?.[envName];
  if (!env || !Array.isArray(env.families)) {
    fail(`missing ${envName} environment in config/lit-families.json`);
  }
  const family = env.families.find((entry) => entry.family === familyName);
  if (!family) {
    fail(`missing ${familyName} family in config/lit-families.json`);
  }
  return family;
}

function resolveFamilyAddress(family, label) {
  if (!family || family.pkpAddress === "TBD") {
    fail(`missing ${label} pkpAddress in config/lit-families.json`);
  }
  return assertAddress(family.pkpAddress, `${label} pkpAddress`);
}

function resolveFamilyPublicKey(family, label, overrideValue = "") {
  const override = String(overrideValue || "").trim();
  if (override) {
    return assertPublicKey(override, `${label} pkpPublicKey override`);
  }
  if (!family || family.pkpPublicKey === "TBD") {
    fail(
      `missing ${label} pkpPublicKey in config/lit-families.json; pass --pkp-public-key until inventory is populated`
    );
  }
  return assertPublicKey(family.pkpPublicKey, `${label} pkpPublicKey`);
}

function resolveStoryDeliveryContract(storyDelivery, key) {
  const value = storyDelivery?.contracts?.[key];
  if (!value) {
    fail(`missing contracts.${key} in config/story-aeneid-delivery.json`);
  }
  return assertAddress(value, `contracts.${key}`);
}

function resolveStoryDeployRpc(storyDelivery) {
  const value = storyDelivery?.network?.deployRpcUrl;
  if (typeof value !== "string" || !/^https?:\/\//.test(value)) {
    fail("missing network.deployRpcUrl in config/story-aeneid-delivery.json");
  }
  return value;
}

export {
  assertAddress,
  assertPublicKey,
  getFamily,
  loadLitFamilies,
  loadStoryDelivery,
  repoRoot,
  resolveFamilyAddress,
  resolveFamilyPublicKey,
  resolveStoryDeliveryContract,
  resolveStoryDeployRpc
};
