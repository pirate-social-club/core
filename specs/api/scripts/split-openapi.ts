import { mkdir, readdir, unlink } from "node:fs/promises";
import path from "node:path";
import {
  API_DIR,
  BUNDLE_FILE,
  PATH_GROUP_ORDER,
  SCHEMA_GROUP_ORDER,
  SOURCE_DIR,
  classifyPath,
  classifySchema,
  pathAnchor,
  readYaml,
  sourceRefForBundleRef,
  writeYaml,
} from "./_shared";

function rewriteBundleRefs(node: unknown, currentFileRel: string): unknown {
  if (Array.isArray(node)) {
    return node.map((item) => rewriteBundleRefs(item, currentFileRel));
  }

  if (node && typeof node === "object") {
    const rewritten: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      if (key === "$ref" && typeof value === "string") {
        rewritten[key] = sourceRefForBundleRef(value, currentFileRel);
      } else {
        rewritten[key] = rewriteBundleRefs(value, currentFileRel);
      }
    }
    return rewritten;
  }

  return node;
}

async function main() {
  const spec = await readYaml(BUNDLE_FILE);
  const sourceRoot = SOURCE_DIR;
  const pathsDir = path.posix.join(sourceRoot, "paths");
  const schemasDir = path.posix.join(sourceRoot, "components", "schemas");

  await mkdir(pathsDir, { recursive: true });
  await mkdir(schemasDir, { recursive: true });
  for (const fileName of await readdir(pathsDir)) {
    if (fileName.endsWith(".yaml")) {
      await unlink(path.posix.join(pathsDir, fileName));
    }
  }
  for (const fileName of await readdir(schemasDir)) {
    if (fileName.endsWith(".yaml")) {
      await unlink(path.posix.join(schemasDir, fileName));
    }
  }

  const pathFiles: Record<string, Record<string, unknown>> = {};
  const rootPaths: Record<string, unknown> = {};

  for (const [pathname, pathItem] of Object.entries(spec.paths as Record<string, unknown>)) {
    const group = classifyPath(pathname);
    const anchor = pathAnchor(pathname);
    const fileRel = `paths/${group}.yaml`;

    pathFiles[group] ??= {};
    pathFiles[group][anchor] = rewriteBundleRefs(pathItem, fileRel);
    rootPaths[pathname] = { $ref: `./${fileRel}#/${anchor}` };
  }

  const parameterFileRel = "components/parameters.yaml";
  const parameterEntries: Record<string, unknown> = {};
  const rootParameters: Record<string, unknown> = {};
  for (const [name, entry] of Object.entries(spec.components.parameters as Record<string, unknown>)) {
    parameterEntries[name] = rewriteBundleRefs(entry, parameterFileRel);
    rootParameters[name] = { $ref: `./${parameterFileRel}#/${name}` };
  }

  const responseFileRel = "components/responses.yaml";
  const responseEntries: Record<string, unknown> = {};
  const rootResponses: Record<string, unknown> = {};
  for (const [name, entry] of Object.entries(spec.components.responses as Record<string, unknown>)) {
    responseEntries[name] = rewriteBundleRefs(entry, responseFileRel);
    rootResponses[name] = { $ref: `./${responseFileRel}#/${name}` };
  }

  const schemaFiles: Record<string, Record<string, unknown>> = {};
  const rootSchemas: Record<string, unknown> = {};
  for (const [name, entry] of Object.entries(spec.components.schemas as Record<string, unknown>)) {
    const group = classifySchema(name);
    const fileRel = `components/schemas/${group}.yaml`;

    schemaFiles[group] ??= {};
    schemaFiles[group][name] = rewriteBundleRefs(entry, fileRel);
    rootSchemas[name] = { $ref: `./${fileRel}#/${name}` };
  }

  const { paths: _paths, components, ...rest } = spec;
  const sourceSpec = {
    ...rest,
    paths: rootPaths,
    components: {
      securitySchemes: components.securitySchemes,
      parameters: rootParameters,
      responses: rootResponses,
      schemas: rootSchemas,
    },
  };

  await writeYaml(path.posix.join(sourceRoot, "openapi.yaml"), sourceSpec);

  for (const group of PATH_GROUP_ORDER) {
    if (pathFiles[group]) {
      await writeYaml(path.posix.join(sourceRoot, "paths", `${group}.yaml`), pathFiles[group]);
    }
  }

  await writeYaml(path.posix.join(sourceRoot, "components", "parameters.yaml"), parameterEntries);
  await writeYaml(path.posix.join(sourceRoot, "components", "responses.yaml"), responseEntries);

  for (const group of SCHEMA_GROUP_ORDER) {
    if (schemaFiles[group]) {
      await writeYaml(path.posix.join(sourceRoot, "components", "schemas", `${group}.yaml`), schemaFiles[group]);
    }
  }

  console.log(`Wrote modular OpenAPI source tree under ${path.posix.join(API_DIR, "src")}`);
}

await main();
