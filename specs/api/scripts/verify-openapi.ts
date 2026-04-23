import { execSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { parse } from "yaml";
import { BUNDLE_FILE, IMPLEMENTED_BUNDLE_FILE } from "./_shared";

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

const HAS_RTK = Bun.which("rtk") !== null;
const BUN_COMMAND = HAS_RTK ? "rtk bun" : "bun";

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

function runStep(command: string, label: string, cwd = process.cwd()) {
  try {
    execSync(command, {
      cwd,
      stdio: "inherit",
      shell: "/bin/zsh",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${label} failed: ${message}`);
  }
}

function runJsonStep<T>(command: string, label: string, cwd = process.cwd()): T {
  try {
    const stdout = execSync(command, {
      cwd,
      stdio: ["ignore", "pipe", "inherit"],
      shell: "/bin/zsh",
      encoding: "utf8",
    });
    return JSON.parse(stdout) as T;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${label} failed: ${message}`);
  }
}

async function main() {
  const currentText = await readFile(BUNDLE_FILE, "utf8");
  const current = parse(currentText);
  const currentImplementedText = await readFile(IMPLEMENTED_BUNDLE_FILE, "utf8").catch(() => "");
  const currentImplemented = currentImplementedText ? parse(currentImplementedText) : null;

  runStep(`${BUN_COMMAND} specs/api/scripts/bundle-openapi.ts >/dev/null`, "OpenAPI bundle generation");
  runStep(
    `${BUN_COMMAND} specs/api/scripts/bundle-openapi-implemented.ts >/dev/null`,
    "Implemented OpenAPI bundle generation",
  );
  const referenceTemplateTypesSummary = runJsonStep<{
    output: string;
    exported_types: string[];
    exported_count: number;
  }>(
    `${BUN_COMMAND} specs/api/scripts/generate-reference-template-types.ts`,
    "Reference compatibility type generation",
  );
  const apiContractsSummary = runJsonStep<{
    output: string;
    exported_types: string[];
    exported_type_count: number;
    exported_routes: string[];
    exported_route_count: number;
  }>(
    `${BUN_COMMAND} specs/api/scripts/generate-api-contracts.ts`,
    "API contracts generation",
  );
  runStep(
    `${BUN_COMMAND} specs/api/scripts/typecheck-api-contracts.ts`,
    "API contracts typecheck",
  );
  const providerMatrixSummary = runJsonStep<{
    validated_proof_types: string[];
    unvalidated_proof_types?: string[];
    provider_matrix: Record<string, string[]>;
  }>(
    `${BUN_COMMAND} specs/api/scripts/validate-provider-matrix.ts`,
    "Provider matrix validation",
  );
  const exampleSummary = runJsonStep<{
    validated_examples: string[];
    count: number;
  }>(
    `${BUN_COMMAND} specs/api/scripts/validate-openapi-examples.ts`,
    "OpenAPI example validation",
  );

  const rebuilt = parse(await readFile(BUNDLE_FILE, "utf8"));
  const rebuiltImplemented = parse(await readFile(IMPLEMENTED_BUNDLE_FILE, "utf8"));

  const summary = {
    counts: {
      paths: keys(current.paths).length,
      parameters: keys(current.components?.parameters).length,
      responses: keys(current.components?.responses).length,
      schemas: keys(current.components?.schemas).length,
      implementedPaths: keys(rebuiltImplemented.paths).length,
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
    implementedRoundTrip:
      JSON.stringify(sortJson(currentImplemented)) === JSON.stringify(sortJson(rebuiltImplemented)),
    bundledExternalRefs: countExternalRefs(rebuilt),
    implementedBundledExternalRefs: countExternalRefs(rebuiltImplemented),
    referenceCompatibilityTypesGenerated: true,
    generatedReferenceCompatibilityTypeCount: referenceTemplateTypesSummary.exported_count,
    generatedReferenceCompatibilityTypes: referenceTemplateTypesSummary.exported_types,
    apiContractsGenerated: true,
    apiContractsTypecheckPassed: true,
    generatedApiContractTypeCount: apiContractsSummary.exported_type_count,
    generatedApiContractTypes: apiContractsSummary.exported_types,
    generatedApiContractRouteCount: apiContractsSummary.exported_route_count,
    generatedApiContractRoutes: apiContractsSummary.exported_routes,
    providerMatrixValidated: true,
    examplesValidated: true,
    validatedProofTypes: providerMatrixSummary.validated_proof_types,
    unvalidatedProofTypes: providerMatrixSummary.unvalidated_proof_types ?? [],
    validatedExampleCount: exampleSummary.count,
    validatedExamples: exampleSummary.validated_examples,
  };

  console.log(JSON.stringify(summary, null, 2));

  if (
    !summary.samePathKeys ||
    !summary.sameParameterKeys ||
    !summary.sameResponseKeys ||
    !summary.sameSchemaKeys ||
    !summary.stableRoundTrip ||
    !summary.implementedRoundTrip ||
    summary.bundledExternalRefs !== 0 ||
    summary.implementedBundledExternalRefs !== 0
  ) {
    process.exit(1);
  }
}

await main();
