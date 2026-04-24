import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(__filename), "..");

const jsonFiles = [
  "package.json",
  "package-lock.json",
  "lit-actions/package.json",
  "config/lit-families.schema.json",
];

const scannedExtensions = new Set([".json", ".md", ".ts", ".tsx", ".yml", ".yaml"]);
const ignoredDirs = new Set([".git", "node_modules"]);
const staleMarkers = [
  "pirate-v2",
  "/home/t42/Documents/pirate-v2",
  "pirate-api/services",
  "pirate-web/",
  "pirate-contracts/",
  "docs/ci",
  "docs/plans",
  "LEGACY-DO-NOT-USE",
  "Status: draft",
  "to be written",
  "hns-public-profile-routing",
  "coming soon",
  "terminal client",
];
const staleRegexMarkers = [
  { label: "TUI", pattern: /\bTUI\b/u },
  { label: "tui", pattern: /\btui\b/u },
];

function relative(filePath) {
  return path.relative(repoRoot, filePath);
}

function walk(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!ignoredDirs.has(entry.name)) files.push(...walk(fullPath));
      continue;
    }
    if (scannedExtensions.has(path.extname(entry.name))) files.push(fullPath);
  }
  return files;
}

function checkJsonFiles() {
  const failures = [];
  for (const file of jsonFiles) {
    const fullPath = path.join(repoRoot, file);
    try {
      JSON.parse(fs.readFileSync(fullPath, "utf8"));
    } catch (error) {
      failures.push(`${file}: ${error.message}`);
    }
  }
  return { label: "json/parse", failures };
}

function checkStaleMarkers() {
  const failures = [];
  const self = path.normalize(__filename);
  for (const file of walk(repoRoot)) {
    if (path.normalize(file) === self) continue;
    const lines = fs.readFileSync(file, "utf8").split("\n");
    lines.forEach((line, index) => {
      for (const marker of staleMarkers) {
        if (line.includes(marker)) failures.push(`${relative(file)}:${index + 1}: ${marker}`);
      }
      for (const marker of staleRegexMarkers) {
        if (marker.pattern.test(line)) failures.push(`${relative(file)}:${index + 1}: ${marker.label}`);
      }
    });
  }
  return { label: "stale-markers", failures };
}

const checks = [checkJsonFiles(), checkStaleMarkers()];
const failures = checks.filter((check) => check.failures.length > 0);

if (failures.length === 0) {
  console.log("repo hygiene passed");
  for (const check of checks) console.log(`- ${check.label}`);
  process.exit(0);
}

console.error("repo hygiene failed");
for (const check of failures) {
  console.error(`- ${check.label}`);
  for (const failure of check.failures) console.error(`  ${failure}`);
}
process.exit(1);
