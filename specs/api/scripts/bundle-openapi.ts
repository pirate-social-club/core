import path from "node:path";
import { stringify } from "yaml";
import {
  BUNDLE_FILE,
  SOURCE_DIR,
  internalRefForSourceRef,
  parseRef,
  readYaml,
} from "./_shared";

const GENERATED_BUNDLE_BANNER =
  "# GENERATED FILE. Edit specs/api/src/** and run `rtk bun specs/api/scripts/bundle-openapi.ts`.\n";

function rewriteSourceRefs(node: unknown, currentFileRel: string): unknown {
  if (Array.isArray(node)) {
    return node.map((item) => rewriteSourceRefs(item, currentFileRel));
  }

  if (node && typeof node === "object") {
    const rewritten: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      if (key === "$ref" && typeof value === "string") {
        rewritten[key] = internalRefForSourceRef(value, currentFileRel) ?? value;
      } else {
        rewritten[key] = rewriteSourceRefs(value, currentFileRel);
      }
    }
    return rewritten;
  }

  return node;
}

async function resolveTopLevelRef(ref: string, currentFileRel: string): Promise<{ fileRel: string; value: unknown }> {
  const { filePath, pointer } = parseRef(ref);
  const targetRel = path.posix.normalize(path.posix.join(path.posix.dirname(currentFileRel), filePath));
  const targetDoc = await readYaml(path.posix.join(SOURCE_DIR, targetRel));

  if (!pointer || !(pointer in targetDoc)) {
    throw new Error(`Unable to resolve ${ref} from ${currentFileRel}`);
  }

  return { fileRel: targetRel, value: targetDoc[pointer] };
}

async function main() {
  const sourceSpec = await readYaml(path.posix.join(SOURCE_DIR, "openapi.yaml"));
  const bundledPaths: Record<string, unknown> = {};

  for (const [pathname, refObject] of Object.entries(sourceSpec.paths as Record<string, any>)) {
    const { fileRel, value } = await resolveTopLevelRef(refObject.$ref, "openapi.yaml");
    bundledPaths[pathname] = rewriteSourceRefs(value, fileRel);
  }

  const bundledParameters: Record<string, unknown> = {};
  for (const [name, refObject] of Object.entries(sourceSpec.components.parameters as Record<string, any>)) {
    const { fileRel, value } = await resolveTopLevelRef(refObject.$ref, "openapi.yaml");
    bundledParameters[name] = rewriteSourceRefs(value, fileRel);
  }

  const bundledResponses: Record<string, unknown> = {};
  for (const [name, refObject] of Object.entries(sourceSpec.components.responses as Record<string, any>)) {
    const { fileRel, value } = await resolveTopLevelRef(refObject.$ref, "openapi.yaml");
    bundledResponses[name] = rewriteSourceRefs(value, fileRel);
  }

  const bundledSchemas: Record<string, unknown> = {};
  for (const [name, refObject] of Object.entries(sourceSpec.components.schemas as Record<string, any>)) {
    const { fileRel, value } = await resolveTopLevelRef(refObject.$ref, "openapi.yaml");
    bundledSchemas[name] = rewriteSourceRefs(value, fileRel);
  }

  const { paths: _paths, components, ...rest } = sourceSpec;
  const bundledSpec = {
    ...rest,
    paths: bundledPaths,
    components: {
      securitySchemes: components.securitySchemes,
      parameters: bundledParameters,
      responses: bundledResponses,
      schemas: bundledSchemas,
    },
  };

  await Bun.write(BUNDLE_FILE, `${GENERATED_BUNDLE_BANNER}${stringify(bundledSpec, { lineWidth: 0 })}`);
  console.log(`Wrote bundled spec to ${BUNDLE_FILE}`);
}

await main();
