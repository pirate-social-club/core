import { execSync } from "node:child_process";
import { parse } from "yaml";

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

function sortJson(value: unknown): Json {
  if (value === null) {
    return null;
  }

  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map(sortJson);
  }

  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
      a.localeCompare(b),
    );
    return Object.fromEntries(entries.map(([key, child]) => [key, sortJson(child)]));
  }

  throw new Error(`Unsupported value type: ${typeof value}`);
}

function keys(value: unknown): string[] {
  return Object.keys((value as Record<string, unknown>) ?? {}).sort();
}

function countExternalRefs(node: unknown): number {
  if (Array.isArray(node)) {
    return node.reduce((total, item) => total + countExternalRefs(item), 0);
  }

  if (node && typeof node === "object") {
    let total = 0;
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      if (key === "$ref" && typeof value === "string" && !value.startsWith("#/")) {
        total += 1;
      } else {
        total += countExternalRefs(value);
      }
    }
    return total;
  }

  return 0;
}

async function main() {
  const currentText = await Bun.file("specs/api/openapi.yaml").text();
  const current = parse(currentText);

  execSync("bun specs/api/scripts/bundle-openapi.ts >/dev/null", {
    cwd: process.cwd(),
    stdio: "inherit",
    shell: "/bin/zsh",
  });

  const rebuilt = parse(await Bun.file("specs/api/openapi.yaml").text());

  const summary = {
    counts: {
      paths: keys(current.paths).length,
      parameters: keys(current.components?.parameters).length,
      responses: keys(current.components?.responses).length,
      schemas: keys(current.components?.schemas).length,
    },
    samePathKeys: JSON.stringify(keys(current.paths)) === JSON.stringify(keys(rebuilt.paths)),
    sameParameterKeys:
      JSON.stringify(keys(current.components?.parameters)) ===
      JSON.stringify(keys(rebuilt.components?.parameters)),
    sameResponseKeys:
      JSON.stringify(keys(current.components?.responses)) ===
      JSON.stringify(keys(rebuilt.components?.responses)),
    sameSchemaKeys:
      JSON.stringify(keys(current.components?.schemas)) ===
      JSON.stringify(keys(rebuilt.components?.schemas)),
    stableRoundTrip: JSON.stringify(sortJson(current)) === JSON.stringify(sortJson(rebuilt)),
    bundledExternalRefs: countExternalRefs(rebuilt),
  };

  console.log(JSON.stringify(summary, null, 2));

  if (
    !summary.samePathKeys ||
    !summary.sameParameterKeys ||
    !summary.sameResponseKeys ||
    !summary.sameSchemaKeys ||
    !summary.stableRoundTrip ||
    summary.bundledExternalRefs !== 0
  ) {
    process.exit(1);
  }
}

await main();
