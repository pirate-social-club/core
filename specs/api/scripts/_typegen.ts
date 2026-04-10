import path from "node:path";
import { readdir } from "node:fs/promises";
import { parse } from "yaml";

export type NodeObject = Record<string, unknown>;

export type SchemaObject = NodeObject & {
  $ref?: string;
  allOf?: unknown[];
  anyOf?: unknown[];
  oneOf?: unknown[];
  type?: string;
  enum?: unknown[];
  properties?: Record<string, unknown>;
  required?: unknown[];
  items?: unknown;
  nullable?: boolean;
  additionalProperties?: unknown;
};

export type BundleSpec = NodeObject & {
  components?: {
    schemas?: Record<string, unknown>;
  };
};

export type ExportedSchema = {
  name: string;
  ref: string;
};

export function isNodeObject(value: unknown): value is NodeObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function asSchema(value: unknown, label: string): SchemaObject {
  if (!isNodeObject(value)) {
    throw new Error(`Expected schema object for ${label}`);
  }

  return value as SchemaObject;
}

function quotePropertyKey(key: string): string {
  return /^[$A-Z_][0-9A-Z_$]*$/i.test(key) ? key : JSON.stringify(key);
}

function indent(text: string, prefix = "  "): string {
  return text
    .split("\n")
    .map((line) => (line ? `${prefix}${line}` : line))
    .join("\n");
}

function literal(value: unknown): string {
  return JSON.stringify(value);
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values));
}

function decodeJsonPointerSegment(segment: string): string {
  return segment.replace(/~1/g, "/").replace(/~0/g, "~");
}

function resolveJsonPointer(root: unknown, pointer: string): unknown {
  const segments = pointer
    .split("/")
    .filter(Boolean)
    .map(decodeJsonPointerSegment);

  let current: unknown = root;
  for (const segment of segments) {
    if (Array.isArray(current)) {
      const index = Number(segment);
      if (!Number.isInteger(index) || index < 0 || index >= current.length) {
        return undefined;
      }
      current = current[index];
      continue;
    }

    if (!isNodeObject(current) || !(segment in current)) {
      return undefined;
    }

    current = current[segment];
  }

  return current;
}

export class TypeGenerator {
  private readonly bundle: BundleSpec;
  private readonly sourceSchemas: Record<string, unknown>;
  private readonly refToAlias = new Map<string, string>();
  private readonly aliasDefinitions = new Map<string, string>();
  private readonly exportNames: Set<string>;

  constructor(bundle: BundleSpec, sourceSchemas: Record<string, unknown>, exports: readonly ExportedSchema[]) {
    this.bundle = bundle;
    this.sourceSchemas = sourceSchemas;
    this.exportNames = new Set(exports.map((entry) => entry.name));

    for (const entry of exports) {
      this.refToAlias.set(entry.ref, entry.name);
    }
  }

  generate(exports: readonly ExportedSchema[]): string {
    for (const entry of exports) {
      this.ensureRefDefined(entry.ref);
    }

    const exportedDefinitions = exports
      .map((entry) => this.aliasDefinitions.get(entry.name))
      .filter((value): value is string => Boolean(value));
    const internalDefinitions = Array.from(this.aliasDefinitions.entries())
      .filter(([name]) => !this.exportNames.has(name))
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([, definition]) => definition);

    return `${exportedDefinitions.join("\n\n")}\n\n${internalDefinitions.join("\n\n")}\n`;
  }

  private ensureRefDefined(ref: string): string {
    const alias = this.aliasForRef(ref);
    if (this.aliasDefinitions.has(alias)) {
      return alias;
    }

    const schema = this.resolveRef(ref);
    const exported = this.exportNames.has(alias);
    const declaration = `${exported ? "export " : ""}type ${alias} = ${this.renderSchema(schema)};`;
    this.aliasDefinitions.set(alias, declaration);
    return alias;
  }

  private aliasForRef(ref: string): string {
    const existing = this.refToAlias.get(ref);
    if (existing) {
      return existing;
    }

    const parts = ref.split("/");
    const alias = parts[parts.length - 1];
    if (!alias) {
      throw new Error(`Unable to derive alias name from ref ${ref}`);
    }

    this.refToAlias.set(ref, alias);
    return alias;
  }

  private resolveRef(ref: string): SchemaObject {
    if (ref.startsWith("#/")) {
      const resolved = resolveJsonPointer(this.bundle, ref.slice(2));
      if (resolved !== undefined) {
        return asSchema(resolved, ref);
      }

      const rootName = ref.slice(2);
      if (rootName.startsWith("components/schemas/")) {
        const schemaName = rootName.slice("components/schemas/".length);
        const componentFallback = this.sourceSchemas[schemaName];
        if (componentFallback !== undefined) {
          return asSchema(componentFallback, ref);
        }
      }

      const sourceSchema = this.sourceSchemas[rootName];
      if (sourceSchema !== undefined) {
        return asSchema(sourceSchema, ref);
      }

      throw new Error(`Missing local ref ${ref}`);
    }

    const fragmentIndex = ref.indexOf("#/");
    if (fragmentIndex >= 0) {
      const pointer = ref.slice(fragmentIndex + 2);
      const sourceSchema = this.sourceSchemas[pointer];
      if (sourceSchema !== undefined) {
        return asSchema(sourceSchema, ref);
      }
    }

    throw new Error(`Unsupported ref ${ref}`);
  }

  private renderSchema(schemaInput: unknown): string {
    const schema = asSchema(schemaInput, "inline schema");
    const rendered = this.renderNonNullableSchema(schema);
    return schema.nullable ? `${this.wrap(rendered)} | null` : rendered;
  }

  private renderNonNullableSchema(schema: SchemaObject): string {
    const parts: string[] = [];

    if (schema.oneOf) {
      parts.push(this.renderUnion(schema.oneOf, " | "));
    } else if (schema.anyOf) {
      parts.push(this.renderUnion(schema.anyOf, " | "));
    }

    if (typeof schema.$ref === "string") {
      parts.push(this.ensureRefDefined(schema.$ref));
    }

    if (Array.isArray(schema.allOf)) {
      for (const item of schema.allOf) {
        parts.push(this.renderSchema(item));
      }
    }

    const objectType = this.renderObjectIfPresent(schema);
    if (objectType) {
      parts.push(objectType);
    } else if (parts.length === 0 && schema.type === "array") {
      parts.push(this.renderArray(schema));
    } else if (parts.length === 0 && Array.isArray(schema.enum)) {
      parts.push(schema.enum.map(literal).join(" | "));
    } else if (parts.length === 0 && typeof schema.type === "string") {
      parts.push(this.renderPrimitive(schema.type));
    }

    if (parts.length === 0) {
      return "unknown";
    }

    const uniqueParts = unique(parts);
    if (uniqueParts.length === 1) {
      return uniqueParts[0];
    }

    return `(${uniqueParts.join(" & ")})`;
  }

  private renderUnion(entries: unknown[], separator: string): string {
    const parts = unique(entries.map((entry) => this.renderSchema(entry)));
    return parts.length === 1 ? parts[0] : `(${parts.join(separator)})`;
  }

  private renderObjectIfPresent(schema: SchemaObject): string | null {
    const hasObjectKeywords =
      schema.type === "object" ||
      isNodeObject(schema.properties) ||
      schema.additionalProperties !== undefined;

    if (!hasObjectKeywords) {
      return null;
    }

    if (schema.additionalProperties === true && !isNodeObject(schema.properties)) {
      return "Record<string, unknown>";
    }

    if (isNodeObject(schema.additionalProperties) && !isNodeObject(schema.properties)) {
      return `Record<string, ${this.renderSchema(schema.additionalProperties)}>`;
    }

    const properties = schema.properties ?? {};
    const required = new Set(
      Array.isArray(schema.required) ? schema.required.filter((value): value is string => typeof value === "string") : [],
    );

    const lines = Object.entries(properties).map(([name, propertySchema]) => {
      const suffix = required.has(name) ? "" : "?";
      return `${quotePropertyKey(name)}${suffix}: ${this.renderSchema(propertySchema)};`;
    });

    if (lines.length === 0) {
      return "Record<string, never>";
    }

    return `{\n${indent(lines.join("\n"))}\n}`;
  }

  private renderArray(schema: SchemaObject): string {
    if (!schema.items) {
      return "unknown[]";
    }

    return `Array<${this.renderSchema(schema.items)}>`;
  }

  private renderPrimitive(type: string): string {
    switch (type) {
      case "string":
        return "string";
      case "integer":
      case "number":
        return "number";
      case "boolean":
        return "boolean";
      case "array":
        return "unknown[]";
      case "object":
        return "Record<string, unknown>";
      default:
        return "unknown";
    }
  }

  private wrap(rendered: string): string {
    return rendered.startsWith("{") || rendered.startsWith("Record<") ? `(${rendered})` : rendered;
  }
}

export async function loadSourceSchemas(sourceSchemaDir: string): Promise<Record<string, unknown>> {
  const entries = await readdir(sourceSchemaDir, { withFileTypes: true });
  const schemas: Record<string, unknown> = {};

  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isFile() || !entry.name.endsWith(".yaml")) {
      continue;
    }

    const filePath = path.posix.join(sourceSchemaDir, entry.name);
    const parsed = parse(await Bun.file(filePath).text());
    if (!isNodeObject(parsed)) {
      continue;
    }

    Object.assign(schemas, parsed);
  }

  return schemas;
}
