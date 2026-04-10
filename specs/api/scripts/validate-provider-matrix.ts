import { parse } from "yaml";
import { PROVIDER_MATRIX } from "./provider-matrix";

type NodeObject = Record<string, unknown>;

function getObject(parent: NodeObject, key: string): NodeObject {
  const value = parent[key];
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Expected object at ${key}`);
  }
  return value as NodeObject;
}

function getStringEnum(parent: NodeObject, key: string): string[] {
  const value = getObject(parent, key).enum;
  if (!Array.isArray(value)) {
    throw new Error(`Expected enum array at ${key}.enum`);
  }
  return value.map((item) => {
    if (typeof item !== "string") {
      throw new Error(`Expected string enum value at ${key}.enum`);
    }
    return item;
  });
}

function assertEqualSet(actual: string[], expected: readonly string[], label: string) {
  const actualSorted = [...actual].sort();
  const expectedSorted = [...expected].sort();
  if (JSON.stringify(actualSorted) !== JSON.stringify(expectedSorted)) {
    throw new Error(
      `${label} mismatch. expected=${expectedSorted.join(",")} actual=${actualSorted.join(",")}`,
    );
  }
}

function getStringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value)) {
    throw new Error(`Expected array at ${label}`);
  }
  return value.map((item) => {
    if (typeof item !== "string") {
      throw new Error(`Expected string array value at ${label}`);
    }
    return item;
  });
}

async function main() {
  const spec = parse(await Bun.file("specs/api/openapi.yaml").text()) as NodeObject;
  const schemas = getObject(getObject(spec, "components"), "schemas");

  const proofRequirement = getObject(schemas, "ProofRequirement");
  const verificationCapabilityState = getObject(schemas, "VerificationCapabilityState");
  const verifiedCapabilityState = getObject(schemas, "VerifiedCapabilityState");
  const sanctionsClearCapabilityState = getObject(schemas, "SanctionsClearCapabilityState");
  const walletScoreCapabilityState = getObject(schemas, "WalletScoreCapabilityState");

  const proofTypes = getStringEnum(getObject(proofRequirement, "properties"), "proof_type");
  for (const proofType of Object.keys(PROVIDER_MATRIX)) {
    if (!proofTypes.includes(proofType)) {
      throw new Error(`ProofRequirement.proof_type is missing ${proofType}`);
    }
  }
  const unvalidatedProofTypes = getStringArray(
    proofRequirement["x-unvalidated-proof-types"],
    "ProofRequirement.x-unvalidated-proof-types",
  );
  assertEqualSet(
    proofTypes,
    [...Object.keys(PROVIDER_MATRIX), ...unvalidatedProofTypes],
    "ProofRequirement.proof_type coverage",
  );
  assertEqualSet(
    getStringEnum(getObject(getObject(proofRequirement, "properties"), "accepted_providers"), "items"),
    [...new Set(Object.values(PROVIDER_MATRIX).flat())],
    "ProofRequirement.accepted_providers.items.enum",
  );

  const proofRequirementMatrix = getObject(proofRequirement, "x-valid-providers-by-proof-type");
  assertEqualSet(
    Object.keys(proofRequirementMatrix),
    Object.keys(PROVIDER_MATRIX),
    "ProofRequirement.x-valid-providers-by-proof-type keys",
  );
  for (const [proofType, providers] of Object.entries(PROVIDER_MATRIX)) {
    assertEqualSet(
      getStringArray(proofRequirementMatrix[proofType], `x-valid-providers-by-proof-type.${proofType}`),
      providers,
      `ProofRequirement.x-valid-providers-by-proof-type.${proofType}`,
    );
  }

  assertEqualSet(
    getStringEnum(getObject(verificationCapabilityState, "properties"), "provider"),
    PROVIDER_MATRIX.unique_human,
    "VerificationCapabilityState.provider",
  );
  assertEqualSet(
    getStringEnum(getObject(verifiedCapabilityState, "properties"), "provider"),
    ["self"],
    "VerifiedCapabilityState.provider",
  );
  assertEqualSet(
    getStringEnum(getObject(sanctionsClearCapabilityState, "properties"), "provider"),
    PROVIDER_MATRIX.sanctions_clear,
    "SanctionsClearCapabilityState.provider",
  );
  assertEqualSet(
    getStringEnum(getObject(walletScoreCapabilityState, "properties"), "provider"),
    PROVIDER_MATRIX.wallet_score,
    "WalletScoreCapabilityState.provider",
  );

  console.log(
    JSON.stringify(
      {
        validated_proof_types: Object.keys(PROVIDER_MATRIX),
        unvalidated_proof_types: unvalidatedProofTypes,
        provider_matrix: PROVIDER_MATRIX,
      },
      null,
      2,
    ),
  );
}

await main();
