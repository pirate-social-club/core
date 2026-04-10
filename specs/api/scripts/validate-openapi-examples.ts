import { readFile } from "node:fs/promises";
import { parse } from "yaml";

type NodeObject = Record<string, unknown>;

function isPlainObject(value: unknown): value is NodeObject {
  return !!value && typeof value === "object" && !Array.isArray(value) && !(value instanceof Date);
}

function getObject(parent: NodeObject, key: string, label: string): NodeObject {
  const value = parent[key];
  if (!isPlainObject(value)) {
    throw new Error(`Expected object at ${label}.${key}`);
  }
  return value;
}

function resolvePointer(root: NodeObject, ref: string): NodeObject {
  if (!ref.startsWith("#/")) {
    throw new Error(`External refs are not supported in example validation: ${ref}`);
  }

  let current: unknown = root;
  for (const segment of ref.slice(2).split("/")) {
    const key = segment.replace(/~1/g, "/").replace(/~0/g, "~");
    if (!isPlainObject(current) || !(key in current)) {
      throw new Error(`Unable to resolve ref ${ref}`);
    }
    current = current[key];
  }

  if (!isPlainObject(current)) {
    throw new Error(`Resolved ref is not an object schema: ${ref}`);
  }
  return current;
}

function describe(value: unknown): string {
  if (value === null) {
    return "null";
  }
  if (value instanceof Date) {
    return "date";
  }
  if (Array.isArray(value)) {
    return "array";
  }
  return typeof value;
}

function validateSchema(root: NodeObject, schema: NodeObject, value: unknown, path: string): string[] {
  const errors: string[] = [];

  if ("$ref" in schema && typeof schema.$ref === "string") {
    errors.push(...validateSchema(root, resolvePointer(root, schema.$ref), value, path));
  }

  if (schema.allOf && Array.isArray(schema.allOf)) {
    for (const [index, item] of schema.allOf.entries()) {
      if (!isPlainObject(item)) {
        errors.push(`${path}: allOf[${index}] is not an object schema`);
        continue;
      }
      errors.push(...validateSchema(root, item, value, path));
    }
  }

  if (value === null) {
    if (schema.nullable === true) {
      return errors;
    }
    if (!("$ref" in schema) && !schema.allOf) {
      errors.push(`${path}: expected non-null value`);
    }
    return errors;
  }

  if (schema.enum && Array.isArray(schema.enum) && !schema.enum.includes(value as never)) {
    errors.push(`${path}: value ${JSON.stringify(value)} is not in enum`);
  }

  switch (schema.type) {
    case "object": {
      if (!isPlainObject(value)) {
        errors.push(`${path}: expected object, got ${describe(value)}`);
        return errors;
      }

      const properties = isPlainObject(schema.properties) ? schema.properties : {};
      const required = Array.isArray(schema.required) ? schema.required : [];
      for (const key of required) {
        if (typeof key === "string" && !(key in value)) {
          errors.push(`${path}: missing required property ${key}`);
        }
      }

      for (const [key, childSchema] of Object.entries(properties)) {
        if (!(key in value)) {
          continue;
        }
        if (!isPlainObject(childSchema)) {
          errors.push(`${path}.${key}: property schema is not an object`);
          continue;
        }
        errors.push(...validateSchema(root, childSchema, value[key], `${path}.${key}`));
      }
      return errors;
    }
    case "array": {
      if (!Array.isArray(value)) {
        errors.push(`${path}: expected array, got ${describe(value)}`);
        return errors;
      }
      if (isPlainObject(schema.items)) {
        for (const [index, item] of value.entries()) {
          errors.push(...validateSchema(root, schema.items, item, `${path}[${index}]`));
        }
      }
      return errors;
    }
    case "string": {
      if (typeof value !== "string" && !(value instanceof Date)) {
        errors.push(`${path}: expected string, got ${describe(value)}`);
      }
      return errors;
    }
    case "integer": {
      if (typeof value !== "number" || !Number.isInteger(value)) {
        errors.push(`${path}: expected integer, got ${describe(value)}`);
      }
      return errors;
    }
    case "number": {
      if (typeof value !== "number") {
        errors.push(`${path}: expected number, got ${describe(value)}`);
      }
      return errors;
    }
    case "boolean": {
      if (typeof value !== "boolean") {
        errors.push(`${path}: expected boolean, got ${describe(value)}`);
      }
      return errors;
    }
    case undefined:
      return errors;
    default:
      errors.push(`${path}: unsupported schema type ${String(schema.type)}`);
      return errors;
  }
}

async function main() {
  const spec = parse(await readFile("specs/api/openapi.yaml", "utf8")) as NodeObject;
  const paths = getObject(spec, "paths", "root");
  const validatedExamples: string[] = [];

  for (const [pathname, pathItem] of Object.entries(paths)) {
    if (!isPlainObject(pathItem)) {
      continue;
    }
    for (const [method, operation] of Object.entries(pathItem)) {
      if (!isPlainObject(operation)) {
        continue;
      }
      const responses = operation.responses;
      if (!isPlainObject(responses)) {
        continue;
      }
      for (const [statusCode, response] of Object.entries(responses)) {
        if (!isPlainObject(response)) {
          continue;
        }
        const content = response.content;
        if (!isPlainObject(content)) {
          continue;
        }
        for (const [mediaTypeName, mediaType] of Object.entries(content)) {
          if (!isPlainObject(mediaType) || !isPlainObject(mediaType.schema)) {
            continue;
          }
          const schema = mediaType.schema;
          const baseLabel = `${method.toUpperCase()} ${pathname} ${statusCode} ${mediaTypeName}`;

          if ("example" in mediaType) {
            const errors = validateSchema(spec, schema, mediaType.example, `${baseLabel} example`);
            if (errors.length > 0) {
              throw new Error(errors.join("\n"));
            }
            validatedExamples.push(`${baseLabel} example`);
          }

          if (isPlainObject(mediaType.examples)) {
            for (const [exampleName, example] of Object.entries(mediaType.examples)) {
              if (!isPlainObject(example) || !("value" in example)) {
                continue;
              }
              const errors = validateSchema(
                spec,
                schema,
                example.value,
                `${baseLabel} examples.${exampleName}`,
              );
              if (errors.length > 0) {
                throw new Error(errors.join("\n"));
              }
              validatedExamples.push(`${baseLabel} examples.${exampleName}`);
            }
          }
        }
      }
    }
  }

  console.log(
    JSON.stringify(
      {
        validated_examples: validatedExamples,
        count: validatedExamples.length,
      },
      null,
      2,
    ),
  );
}

await main();
