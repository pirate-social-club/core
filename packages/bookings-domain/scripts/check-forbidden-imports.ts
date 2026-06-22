#!/usr/bin/env bun
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const packageRoot = import.meta.dir.replace(/\/scripts$/, "");
const srcDir = join(packageRoot, "src");

const FORBIDDEN: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /from\s+["']react["']/, reason: "react import not allowed in domain package" },
  { pattern: /from\s+["']react-dom["']/, reason: "react-dom import not allowed in domain package" },
  { pattern: /from\s+["']@pirate\/bookings-domain\/test["']/, reason: "test subpath import not allowed in production sources" },
  { pattern: /from\s+["']\.\/test["']/, reason: "test module must not be imported by production sources" },
  { pattern: /import\.meta\.env/, reason: "Vite env access not allowed in domain package" },
  { pattern: /Date\.now\s*\(/, reason: "Date.now is non-deterministic; domain must be pure (pass nowUtc in)" },
  { pattern: /new Date\s*\(\s*\)/, reason: "argless new Date() is non-deterministic; pass nowUtc in. new Date(isoString) is allowed for tz math" },
  { pattern: /crypto\.randomUUID\s*\(/, reason: "crypto.randomUUID is non-deterministic; domain must be pure" },
  { pattern: /Math\.random\s*\(/, reason: "Math.random is non-deterministic; domain must be pure" },
  { pattern: /from\s+["']node:fs["']/, reason: "filesystem I/O not allowed in domain package" },
  { pattern: /from\s+["']node:net["']/, reason: "network I/O not allowed in domain package" },
  { pattern: /from\s+["']node:http["']/, reason: "network I/O not allowed in domain package" },
  { pattern: /from\s+["']node:stream["']/, reason: "stream I/O not allowed in domain package" },
  { pattern: /\bAbortController\b/, reason: "Web API global not allowed in domain package" },
  { pattern: /from\s+["']@libsql/, reason: "DB driver not allowed in domain package" },
  { pattern: /from\s+["']wrangler["']/, reason: "platform runtime not allowed in domain package" },
];

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      yield* walk(fullPath);
      continue;
    }
    if (entry.endsWith(".ts") && !entry.endsWith(".d.ts")) {
      yield fullPath;
    }
  }
}

let bad = 0;
const errors: string[] = [];

for (const file of walk(srcDir)) {
  const text = readFileSync(file, "utf8");
  for (const { pattern, reason } of FORBIDDEN) {
    if (pattern.test(text)) {
      errors.push(`${relative(packageRoot, file)}: ${reason}`);
      bad += 1;
    }
  }
}

if (bad > 0) {
  console.error("Forbidden imports detected in domain sources:");
  for (const err of errors) {
    console.error(`  ${err}`);
  }
  process.exit(1);
}

console.log("Domain sources are free of forbidden imports.");
