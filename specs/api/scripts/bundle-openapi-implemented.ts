import { parse, stringify } from "yaml";
import { BUNDLE_FILE, IMPLEMENTED_BUNDLE_FILE } from "./_shared";

const GENERATED_BUNDLE_BANNER =
  "# GENERATED FILE. Edit specs/api/src/** and run `rtk bun specs/api/scripts/bundle-openapi-implemented.ts`.\n";

const HTTP_METHODS = new Set(["get", "put", "post", "delete", "options", "head", "patch", "trace"]);

type NodeObject = Record<string, unknown>;

function isNodeObject(value: unknown): value is NodeObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isImplementedOperation(value: unknown): value is NodeObject {
  return isNodeObject(value) && value["x-implemented"] === true;
}

function stripImplementedMarker<T extends NodeObject>(value: T): T {
  const { ["x-implemented"]: _marker, ...rest } = value;
  return rest as T;
}

function filterPaths(paths: unknown): {
  filteredPaths: Record<string, unknown>;
  implementedOperationCount: number;
  usedTags: Set<string>;
} {
  if (!isNodeObject(paths)) {
    throw new Error("Expected OpenAPI paths object");
  }

  const filteredPaths: Record<string, unknown> = {};
  const usedTags = new Set<string>();
  let implementedOperationCount = 0;

  for (const [pathname, pathItem] of Object.entries(paths)) {
    if (!isNodeObject(pathItem)) {
      continue;
    }

    const filteredPathItem: Record<string, unknown> = {};
    let hasImplementedOperation = false;

    for (const [key, value] of Object.entries(pathItem)) {
      if (!HTTP_METHODS.has(key)) {
        filteredPathItem[key] = value;
        continue;
      }

      if (!isImplementedOperation(value)) {
        continue;
      }

      const operation = stripImplementedMarker(value);
      filteredPathItem[key] = operation;
      hasImplementedOperation = true;
      implementedOperationCount += 1;

      const tags = operation.tags;
      if (Array.isArray(tags)) {
        for (const tag of tags) {
          if (typeof tag === "string" && tag.trim()) {
            usedTags.add(tag);
          }
        }
      }
    }

    if (hasImplementedOperation) {
      filteredPaths[pathname] = filteredPathItem;
    }
  }

  return { filteredPaths, implementedOperationCount, usedTags };
}

function stripCommunityMoneyPolicyFromImplementedSchemas(schemas: unknown): Record<string, unknown> {
  if (!isNodeObject(schemas)) {
    throw new Error("Expected OpenAPI schemas object");
  }

  const nextSchemas: Record<string, unknown> = { ...schemas };

  const stripPropertyFromSchema = (schemaName: string, propertyName: string) => {
    const schema = nextSchemas[schemaName];
    if (!isNodeObject(schema)) {
      return;
    }

    const nextSchema: Record<string, unknown> = { ...schema };

    if (isNodeObject(schema.properties) && propertyName in schema.properties) {
      const nextProperties = { ...schema.properties };
      delete nextProperties[propertyName];
      nextSchema.properties = nextProperties;
    }

    if (Array.isArray(schema.required)) {
      nextSchema.required = schema.required.filter((entry) => entry !== propertyName);
    }

    nextSchemas[schemaName] = nextSchema;
  };

  // `money_policy` remains in the broader draft contract but is not part of the current
  // implementation-bound public-v0 create/read surface yet.
  stripPropertyFromSchema("CreateCommunityRequestBase", "money_policy");
  stripPropertyFromSchema("Community", "money_policy");

  return nextSchemas;
}

function narrowImplementedCreateAndPostSchemas(schemas: unknown): Record<string, unknown> {
  if (!isNodeObject(schemas)) {
    throw new Error("Expected OpenAPI schemas object");
  }

  const nextSchemas: Record<string, unknown> = { ...schemas };
  const existingCreateBase = isNodeObject(nextSchemas["CreateCommunityRequestBase"])
    ? nextSchemas["CreateCommunityRequestBase"]
    : {};
  const existingCreateBaseProperties = isNodeObject(existingCreateBase.properties)
    ? existingCreateBase.properties
    : {};

  nextSchemas["CreateCommunityRequestBase"] = {
    ...existingCreateBase,
    required: ["display_name", "handle_policy"],
    properties: {
      ...existingCreateBaseProperties,
      display_name: {
        type: "string",
      },
      database_region: {
        type: "string",
        nullable: true,
        enum: [
          "auto",
          "aws-us-east-1",
          "aws-us-east-2",
          "aws-us-west-2",
          "aws-eu-west-1",
          "aws-ap-south-1",
          "aws-ap-northeast-1",
        ],
        description:
          "Create-time primary Turso group location for the community database. Omit or set auto to use the server default.",
      },
      avatar_ref: {
        type: "string",
        nullable: true,
      },
      banner_ref: {
        type: "string",
        nullable: true,
      },
      namespace: {
        type: "object",
        nullable: true,
        required: ["namespace_verification_id"],
        properties: {
          namespace_verification_id: {
            type: "string",
            description:
              "Opaque server-issued identifier for the accepted namespace verification consumed at create time.",
          },
        },
      },
      handle_policy: {
        type: "object",
        required: ["policy_template"],
        properties: {
          policy_template: {
            type: "string",
            enum: ["standard"],
            default: "standard",
            description:
              "Public v0 implemented create currently supports only the standard handle-policy template.",
          },
        },
      },
    },
    description:
      "Implementation-bound public-v0 community create shape. Deferred policy objects and broader community-setting inputs remain draft-only until the runtime persists and returns them coherently.",
  };

  nextSchemas["CreateCommunityRequest"] = {
    oneOf: [{ $ref: "#/components/schemas/CreateCentralizedCommunityRequest" }],
    description:
      "Implementation-bound public-v0 create currently accepts only the centralized community-create variant.",
  };

  const createPostRequest = nextSchemas["CreatePostRequest"];
  if (isNodeObject(createPostRequest)) {
    const nextCreatePostRequest: Record<string, unknown> = { ...createPostRequest };

    if (isNodeObject(createPostRequest.properties) && "community_id" in createPostRequest.properties) {
      const nextProperties = { ...createPostRequest.properties };
      delete nextProperties["community_id"];
      nextCreatePostRequest.properties = nextProperties;
    }

    if (Array.isArray(createPostRequest.required)) {
      nextCreatePostRequest.required = createPostRequest.required.filter((entry) => entry !== "community_id");
    }

    nextSchemas["CreatePostRequest"] = nextCreatePostRequest;
  }

  return nextSchemas;
}

async function main() {
  const bundledText = await Bun.file(BUNDLE_FILE).text();
  const bundledSpec = parse(bundledText) as NodeObject;
  const { filteredPaths, implementedOperationCount, usedTags } = filterPaths(bundledSpec.paths);

  const filteredTags = Array.isArray(bundledSpec.tags)
    ? bundledSpec.tags.filter(
        (tag) => isNodeObject(tag) && typeof tag.name === "string" && usedTags.has(tag.name),
      )
    : [];

  const implementedSpec = {
    ...bundledSpec,
    tags: filteredTags,
    paths: filteredPaths,
    components: {
      ...(bundledSpec.components as NodeObject),
      schemas: narrowImplementedCreateAndPostSchemas(
        stripCommunityMoneyPolicyFromImplementedSchemas((bundledSpec.components as NodeObject).schemas),
      ),
    },
  };

  await Bun.write(
    IMPLEMENTED_BUNDLE_FILE,
    `${GENERATED_BUNDLE_BANNER}${stringify(implementedSpec, { lineWidth: 0 })}`,
  );
  console.log(
    JSON.stringify(
      {
        output: IMPLEMENTED_BUNDLE_FILE,
        implemented_path_count: Object.keys(filteredPaths).length,
        implemented_operation_count: implementedOperationCount,
      },
      null,
      2,
    ),
  );
}

await main();
