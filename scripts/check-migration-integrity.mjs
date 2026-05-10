import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(__filename), "..");
const communityDriftPolicyPath = "db/known-community-migration-drifts.json";
const localControlPlaneDriftPolicyPath = "db/local-control-plane-migration-drifts.json";
const allowedDuplicateMigrationPrefixes = new Map([
  [
    "control-plane:0080",
    new Set([
      "db/control-plane/migrations/0080_control_plane_link_enrichment_source_language.sql",
      "db/control-plane/migrations/0080_control_plane_song_artifact_bundle_title.sql",
    ]),
  ],
]);

const migrationRoots = [
  {
    path: "db/control-plane/migrations",
    label: "control-plane",
    minPrefix: 0,
    maxPrefix: 999,
  },
  {
    path: "db/community-template/migrations",
    label: "community-template",
    minPrefix: 1000,
    maxPrefix: 1999,
  },
];

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
  const explicitBase = process.env.MIGRATION_INTEGRITY_BASE?.trim();
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

function listMigrationFilesAtHead(root) {
  const absoluteRoot = path.join(repoRoot, root.path);
  if (!fs.existsSync(absoluteRoot)) return [];

  return fs.readdirSync(absoluteRoot, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".sql"))
    .map((entry) => `${root.path}/${entry.name}`)
    .sort();
}

function listMigrationFilesAtRef(ref, root) {
  if (!ref) return [];
  const output = gitMaybe(["ls-tree", "-r", "--name-only", ref, root.path]);
  if (!output) return [];

  return output
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.endsWith(".sql"))
    .sort();
}

function filenamePrefix(filePath) {
  const name = path.basename(filePath);
  const match = name.match(/^(\d{4})_/u);
  return match?.[1] ?? null;
}

function collectPrefixGroups(files) {
  const groups = new Map();
  for (const file of files) {
    const prefix = filenamePrefix(file);
    if (!prefix) continue;
    const entries = groups.get(prefix) ?? [];
    entries.push(file);
    groups.set(prefix, entries);
  }
  return groups;
}

function sameSet(left, right) {
  if (left.length !== right.length) return false;
  const rightSet = new Set(right);
  return left.every((value) => rightSet.has(value));
}

function checkFilenamePrefixes(root, files) {
  const failures = [];
  for (const file of files) {
    const name = path.basename(file);
    const prefix = filenamePrefix(file);
    if (!prefix) {
      failures.push(`${file}: filename must start with a four-digit numeric prefix followed by "_"`);
      continue;
    }

    const numericPrefix = Number(prefix);
    if (numericPrefix < root.minPrefix || numericPrefix > root.maxPrefix) {
      failures.push(
        `${file}: ${root.label} migration prefix ${prefix} must be in ${String(root.minPrefix).padStart(4, "0")}..${String(root.maxPrefix).padStart(4, "0")}`,
      );
    }

    if (name !== name.trim() || name.includes(" ")) {
      failures.push(`${file}: migration filenames must not contain whitespace`);
    }
  }
  return failures;
}

function checkDuplicatePrefixes(root, headFiles, baseFiles) {
  const failures = [];
  const warnings = [];
  const headGroups = collectPrefixGroups(headFiles);
  const baseGroups = collectPrefixGroups(baseFiles);

  for (const [prefix, headGroup] of headGroups) {
    if (headGroup.length <= 1) continue;

    const baseGroup = baseGroups.get(prefix) ?? [];
    if (baseGroup.length > 1 && sameSet(headGroup, baseGroup)) {
      warnings.push(`${root.label}: existing duplicate prefix ${prefix} is grandfathered: ${headGroup.join(", ")}`);
      continue;
    }

    const allowedGroup = allowedDuplicateMigrationPrefixes.get(`${root.label}:${prefix}`);
    if (allowedGroup && sameSet(headGroup, Array.from(allowedGroup))) {
      warnings.push(`${root.label}: known duplicate prefix ${prefix} is grandfathered: ${headGroup.join(", ")}`);
      continue;
    }

    failures.push(`${root.label}: duplicate migration prefix ${prefix}: ${headGroup.join(", ")}`);
  }

  return { failures, warnings };
}

function changedMigrationFilesSince(baseRef) {
  if (!baseRef) return [];
  const mergeBase = gitMaybe(["merge-base", baseRef, "HEAD"]) ?? baseRef;
  const output = gitMaybe([
    "diff",
    "--name-status",
    "--find-renames",
    `${mergeBase}...HEAD`,
    "--",
    ...migrationRoots.map((root) => root.path),
  ]);
  if (!output) return [];

  return output
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function checkImmutableAppliedMigrations(baseRef) {
  const failures = [];
  for (const line of changedMigrationFilesSince(baseRef)) {
    const [status, firstPath, secondPath] = line.split(/\s+/u);
    if (!status || !firstPath) continue;

    const statusCode = status[0];
    if (statusCode === "A") continue;

    if (statusCode === "M" || statusCode === "D") {
      failures.push(`${firstPath}: existing migration files are immutable; add a new migration instead of ${statusCode === "M" ? "editing" : "deleting"} this one`);
      continue;
    }

    if (statusCode === "R") {
      failures.push(`${firstPath} -> ${secondPath ?? ""}: existing migration files must not be renamed`);
      continue;
    }
  }
  return failures;
}

function checkImmutableWorkingTreeMigrations() {
  const failures = [];
  const output = gitMaybe([
    "status",
    "--porcelain=v1",
    "--",
    ...migrationRoots.map((root) => root.path),
  ]);
  if (!output) return failures;

  for (const line of output.split("\n").map((entry) => entry.trimEnd()).filter(Boolean)) {
    const status = line.slice(0, 2);
    const filePath = line.slice(3);
    if (!status || !filePath || status === "??" || status.includes("A")) {
      continue;
    }

    if (filePath.includes(" -> ")) {
      failures.push(`${filePath}: existing migration files must not be renamed`);
      continue;
    }

    if (status.includes("M") || status.includes("D")) {
      failures.push(`${filePath}: existing migration files are immutable; add a new migration instead`);
    }
  }

  return failures;
}

async function checkCommunityDriftPolicy() {
  const failures = [];
  const policyPath = path.join(repoRoot, communityDriftPolicyPath);
  if (!fs.existsSync(policyPath)) return failures;

  const { createHash } = await import("node:crypto");
  let policy;
  try {
    policy = JSON.parse(fs.readFileSync(policyPath, "utf8"));
  } catch (error) {
    failures.push(`${communityDriftPolicyPath}: ${error.message}`);
    return failures;
  }

  const checksumRepairs = policy?.communityTemplate?.checksumRepairs;
  const unexpectedMigrationsToRemove = policy?.communityTemplate?.unexpectedMigrationsToRemove;
  if (!Array.isArray(checksumRepairs)) {
    failures.push(`${communityDriftPolicyPath}: communityTemplate.checksumRepairs must be an array`);
    return failures;
  }
  if (!Array.isArray(unexpectedMigrationsToRemove)) {
    failures.push(`${communityDriftPolicyPath}: communityTemplate.unexpectedMigrationsToRemove must be an array`);
    return failures;
  }

  const communityFiles = new Map(
    listMigrationFilesAtHead(migrationRoots[1]).map((file) => [path.basename(file), file]),
  );

  for (const repair of checksumRepairs) {
    const migrationName = String(repair?.migrationName ?? "");
    const oldChecksum = String(repair?.oldChecksum ?? "");
    const newChecksum = String(repair?.newChecksum ?? "");
    const reason = String(repair?.reason ?? "");
    if (!migrationName || !oldChecksum || !newChecksum || !reason) {
      failures.push(`${communityDriftPolicyPath}: checksum repair entries require migrationName, oldChecksum, newChecksum, and reason`);
      continue;
    }
    const filePath = communityFiles.get(migrationName);
    if (!filePath) {
      failures.push(`${communityDriftPolicyPath}: checksum repair references unknown community migration ${migrationName}`);
      continue;
    }
    const sql = fs.readFileSync(path.join(repoRoot, filePath), "utf8");
    const currentChecksum = createHash("sha256").update(sql).digest("hex");
    if (newChecksum !== currentChecksum) {
      failures.push(`${communityDriftPolicyPath}: ${migrationName} newChecksum must match current migration checksum ${currentChecksum}`);
    }
    if (oldChecksum === newChecksum) {
      failures.push(`${communityDriftPolicyPath}: ${migrationName} oldChecksum must differ from newChecksum`);
    }
  }

  for (const migrationName of unexpectedMigrationsToRemove) {
    if (typeof migrationName !== "string" || migrationName.length === 0) {
      failures.push(`${communityDriftPolicyPath}: unexpectedMigrationsToRemove entries must be migration names`);
      continue;
    }
    if (communityFiles.has(migrationName)) {
      failures.push(`${communityDriftPolicyPath}: cannot allow removal of expected migration ${migrationName}`);
    }
  }

  return failures;
}

async function checkLocalControlPlaneDriftPolicy() {
  const failures = [];
  const policyPath = path.join(repoRoot, localControlPlaneDriftPolicyPath);
  if (!fs.existsSync(policyPath)) return failures;

  let policy;
  try {
    policy = JSON.parse(fs.readFileSync(policyPath, "utf8"));
  } catch (error) {
    failures.push(`${localControlPlaneDriftPolicyPath}: ${error.message}`);
    return failures;
  }

  const drifts = policy?.controlPlane?.compatibleChecksumDrifts;
  if (!Array.isArray(drifts)) {
    failures.push(`${localControlPlaneDriftPolicyPath}: controlPlane.compatibleChecksumDrifts must be an array`);
    return failures;
  }

  const { createHash } = await import("node:crypto");
  const controlPlaneFiles = new Map(
    listMigrationFilesAtHead(migrationRoots[0]).map((file) => [path.basename(file), file]),
  );

  for (const drift of drifts) {
    const migrationName = String(drift?.migrationName ?? "");
    const oldChecksum = String(drift?.oldChecksum ?? "");
    const reason = String(drift?.reason ?? "");
    if (!migrationName || !oldChecksum || !reason) {
      failures.push(`${localControlPlaneDriftPolicyPath}: drift entries require migrationName, oldChecksum, and reason`);
      continue;
    }

    const filePath = controlPlaneFiles.get(migrationName);
    if (!filePath) {
      failures.push(`${localControlPlaneDriftPolicyPath}: drift entry references unknown control-plane migration ${migrationName}`);
      continue;
    }

    const sql = fs.readFileSync(path.join(repoRoot, filePath), "utf8");
    const currentChecksum = createHash("sha256").update(sql).digest("hex");
    if (oldChecksum === currentChecksum) {
      failures.push(`${localControlPlaneDriftPolicyPath}: ${migrationName} oldChecksum must differ from current migration checksum`);
    }
  }

  return failures;
}

const baseRef = resolveBaseRef();
const failures = [];
const warnings = [];

if (!baseRef) {
  warnings.push("could not resolve a base ref; skipped immutability and grandfathered-duplicate comparisons");
}

for (const root of migrationRoots) {
  const headFiles = listMigrationFilesAtHead(root);
  const baseFiles = listMigrationFilesAtRef(baseRef, root);

  failures.push(...checkFilenamePrefixes(root, headFiles));

  const duplicateCheck = checkDuplicatePrefixes(root, headFiles, baseFiles);
  failures.push(...duplicateCheck.failures);
  warnings.push(...duplicateCheck.warnings);
}

failures.push(...checkImmutableAppliedMigrations(baseRef));
failures.push(...checkImmutableWorkingTreeMigrations());
failures.push(...await checkCommunityDriftPolicy());
failures.push(...await checkLocalControlPlaneDriftPolicy());

for (const warning of warnings) {
  console.warn(`warning: ${warning}`);
}

if (failures.length > 0) {
  console.error("migration integrity check failed");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log("migration integrity check passed");
for (const root of migrationRoots) {
  console.log(`- ${root.label}`);
}
