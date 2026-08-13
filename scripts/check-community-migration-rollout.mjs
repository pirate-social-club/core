import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(__filename), "..");

export const COMMUNITY_MIGRATION_ROOT = "db/community-template/migrations";
export const COMMUNITY_ROLLOUT_ROOT = "db/community-template/rollouts";

const migrationNamePattern = /^(\d{4})_[A-Za-z0-9][A-Za-z0-9_-]*\.sql$/u;
const workflowPathPattern = /^[^/\s]+\/[^/\s]+\/\.github\/workflows\/[^/\s]+\.ya?ml$/u;
const requiredTargets = ["production", "staging"];

function git(args, options = {}) {
  return execFileSync("git", args, {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", options.allowFailure ? "pipe" : "inherit"],
  }).trim();
}

function gitMaybe(args) {
  try {
    return git(args, { allowFailure: true });
  } catch {
    return null;
  }
}

function resolveBaseRef() {
  const explicitBase = process.env.MIGRATION_ROLLOUT_BASE?.trim();
  if (explicitBase && gitMaybe(["rev-parse", "--verify", `${explicitBase}^{commit}`])) {
    return explicitBase;
  }

  const githubBaseRef = process.env.GITHUB_BASE_REF?.trim();
  if (githubBaseRef) {
    const remoteBase = `origin/${githubBaseRef}`;
    if (gitMaybe(["rev-parse", "--verify", `${remoteBase}^{commit}`])) {
      return remoteBase;
    }
  }

  for (const candidate of ["origin/main", "main", "HEAD~1"]) {
    if (gitMaybe(["rev-parse", "--verify", `${candidate}^{commit}`])) {
      return candidate;
    }
  }

  return null;
}

function changedFilesSince(baseRef) {
  if (!baseRef) return [];
  const mergeBase = gitMaybe(["merge-base", baseRef, "HEAD"]) ?? baseRef;
  const output = gitMaybe([
    "diff",
    "--name-status",
    "--find-renames",
    `${mergeBase}...HEAD`,
    "--",
    COMMUNITY_MIGRATION_ROOT,
    COMMUNITY_ROLLOUT_ROOT,
  ]);
  if (!output) return [];

  return output
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function changedWorkingTreeFiles() {
  const output = gitMaybe([
    "status",
    "--porcelain=v1",
    "--",
    COMMUNITY_MIGRATION_ROOT,
    COMMUNITY_ROLLOUT_ROOT,
  ]);
  if (!output) return [];

  return output
    .split("\n")
    .map((line) => {
      const status = line.slice(0, 2);
      const filePath = line[1] === " " && line[2] !== " " ? line.slice(2) : line.slice(3);
      return { status, filePath };
    })
    .filter(({ filePath }) => filePath);
}

function parseChangedPaths(baseRef) {
  const entries = [];
  for (const line of changedFilesSince(baseRef)) {
    const [status, firstPath, secondPath] = line.split(/\s+/u);
    if (!status || !firstPath) continue;
    entries.push({ status: status[0], firstPath, secondPath });
  }

  for (const entry of changedWorkingTreeFiles()) {
    entries.push({ status: entry.status.includes("A") || entry.status === "??" ? "A" : entry.status[0], firstPath: entry.filePath });
  }
  return entries;
}

function isCommunityMigration(filePath) {
  return filePath.startsWith(`${COMMUNITY_MIGRATION_ROOT}/`)
    && path.basename(filePath).endsWith(".sql");
}

function isRolloutContract(filePath) {
  return filePath.startsWith(`${COMMUNITY_ROLLOUT_ROOT}/`)
    && path.basename(filePath).endsWith(".json");
}

export function rolloutContractPath(migrationPath) {
  return `${COMMUNITY_ROLLOUT_ROOT}/${path.basename(migrationPath)}.json`;
}

function expectedProductionConfirmation(migrationName) {
  const prefix = migrationName.match(migrationNamePattern)?.[1];
  return prefix ? `APPLY ${Number(prefix)} TO PRODUCTION` : null;
}

function validateContract({ migrationPath, contractPath, contract }) {
  const failures = [];
  const migrationName = path.basename(migrationPath);
  const expectedPath = rolloutContractPath(migrationPath);

  if (contractPath !== expectedPath) {
    failures.push(`${contractPath}: rollout contract must be stored at ${expectedPath}`);
  }

  const match = migrationName.match(migrationNamePattern);
  if (!match) {
    failures.push(`${migrationPath}: community migration filename must match NNNN_name.sql`);
  }

  if (contract === null || typeof contract !== "object" || Array.isArray(contract)) {
    failures.push(`${contractPath}: rollout contract must be a JSON object`);
    return failures;
  }

  if (contract.migration !== migrationName) {
    failures.push(`${contractPath}: migration must be ${JSON.stringify(migrationName)}`);
  }

  if (typeof contract.rollout_workflow !== "string" || !workflowPathPattern.test(contract.rollout_workflow)) {
    failures.push(`${contractPath}: rollout_workflow must be owner/repository/.github/workflows/name.yml`);
  }

  if (typeof contract.operator_spec !== "string"
    || !contract.operator_spec.startsWith("scripts/community/")
    || !contract.operator_spec.endsWith(".ts")
    || !fs.existsSync(path.join(repoRoot, contract.operator_spec))) {
    failures.push(`${contractPath}: operator_spec must name an existing scripts/community/*.ts runner`);
  }

  if (!Array.isArray(contract.targets)
    || contract.targets.length !== requiredTargets.length
    || new Set(contract.targets).size !== requiredTargets.length
    || !requiredTargets.every((target) => contract.targets.includes(target))) {
    failures.push(`${contractPath}: targets must contain staging and production exactly once`);
  }

  if (contract.audit_before_apply !== true) {
    failures.push(`${contractPath}: audit_before_apply must be true`);
  }

  const expectedConfirmation = expectedProductionConfirmation(migrationName);
  if (contract.production_confirmation !== expectedConfirmation) {
    failures.push(`${contractPath}: production_confirmation must be ${JSON.stringify(expectedConfirmation)}`);
  }

  return failures;
}

export function checkCommunityMigrationRollouts({
  addedMigrationPaths,
  changedPaths,
  contracts,
}) {
  const failures = [];
  const changedPathSet = new Set(changedPaths);
  const validatedContractPaths = new Set();

  for (const migrationPath of addedMigrationPaths.filter(isCommunityMigration).sort()) {
    const contractPath = rolloutContractPath(migrationPath);
    if (!changedPathSet.has(contractPath)) {
      failures.push(`${migrationPath}: add ${contractPath} in the same change with its rollout contract`);
      continue;
    }

    const contract = contracts.get(contractPath);
    if (contract === undefined) {
      failures.push(`${contractPath}: rollout contract could not be read`);
      continue;
    }
    failures.push(...validateContract({ migrationPath, contractPath, contract }));
    validatedContractPaths.add(contractPath);
  }

  for (const contractPath of changedPaths.filter(isRolloutContract).sort()) {
    if (validatedContractPaths.has(contractPath)) continue;
    const contract = contracts.get(contractPath);
    if (contract === undefined) {
      failures.push(`${contractPath}: rollout contract could not be read`);
      continue;
    }
    const migrationPath = `${COMMUNITY_MIGRATION_ROOT}/${path.basename(contractPath, ".json")}`;
    const migrationName = path.basename(migrationPath);
    if (!fs.existsSync(path.join(repoRoot, migrationPath))) {
      failures.push(`${contractPath}: migration ${JSON.stringify(migrationName)} does not exist`);
      continue;
    }
    failures.push(...validateContract({ migrationPath, contractPath, contract }));
  }

  return failures;
}

function readChangedContracts(changedPaths) {
  const contracts = new Map();
  for (const filePath of changedPaths.filter(isRolloutContract)) {
    const absolutePath = path.join(repoRoot, filePath);
    if (!fs.existsSync(absolutePath)) continue;
    try {
      contracts.set(filePath, JSON.parse(fs.readFileSync(absolutePath, "utf8")));
    } catch (error) {
      contracts.set(filePath, null);
      console.error(`${filePath}: invalid JSON (${error.message})`);
    }
  }
  return contracts;
}

export function runCommunityMigrationRolloutCheck(baseRef = resolveBaseRef()) {
  if (!baseRef) {
    return { failures: [], skipped: true };
  }

  const entries = parseChangedPaths(baseRef);
  const changedPaths = entries.flatMap(({ firstPath, secondPath, status }) =>
    status === "R" && secondPath ? [firstPath, secondPath] : [firstPath]);
  const addedMigrationPaths = entries.flatMap(({ firstPath, secondPath, status }) => {
    if (status === "A") return [firstPath];
    if (status === "R" && secondPath) return [secondPath];
    return [];
  });

  return {
    failures: checkCommunityMigrationRollouts({
      addedMigrationPaths,
      changedPaths,
      contracts: readChangedContracts(changedPaths),
    }),
    skipped: false,
  };
}

async function main() {
  const result = runCommunityMigrationRolloutCheck();
  if (result.skipped) {
    console.warn("warning: could not resolve a base ref; skipped community migration rollout contracts");
    return;
  }
  if (result.failures.length > 0) {
    console.error("community migration rollout contract check failed");
    for (const failure of result.failures) console.error(`- ${failure}`);
    process.exitCode = 1;
    return;
  }
  console.log("community migration rollout contract check passed");
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  await main();
}
