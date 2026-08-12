export type ActivatedDnsObservation = {
  apexA: string[];
  apexTlsa: string[];
  appA: string[];
  appTlsa: string[];
  communityId: string;
  resolverEndpoint: string;
};

export type ActivatedDnsAudit = ActivatedDnsObservation & {
  issues: string[];
  status: "ok" | "drift";
};

function normalized(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort();
}

function sameRecords(left: string[], right: string[]): boolean {
  const normalizedLeft = normalized(left);
  const normalizedRight = normalized(right);
  return normalizedLeft.length === normalizedRight.length
    && normalizedLeft.every((record, index) => record === normalizedRight[index]);
}

export function auditActivatedDnsObservation(
  observation: ActivatedDnsObservation,
  expectedGatewayIpv4: string[],
): ActivatedDnsAudit {
  const issues: string[] = [];
  if (!sameRecords(observation.apexA, expectedGatewayIpv4)) issues.push("apex_a_inventory_mismatch");
  if (!sameRecords(observation.appA, expectedGatewayIpv4)) issues.push("app_a_inventory_mismatch");
  if (observation.apexTlsa.length === 0) issues.push("missing_apex_tlsa");
  if (observation.appTlsa.length === 0) issues.push("missing_app_tlsa");
  if (
    observation.apexTlsa.length > 0
    && observation.appTlsa.length > 0
    && !sameRecords(observation.apexTlsa, observation.appTlsa)
  ) {
    issues.push("app_tlsa_mismatch");
  }
  return {
    ...observation,
    apexA: normalized(observation.apexA),
    apexTlsa: normalized(observation.apexTlsa),
    appA: normalized(observation.appA),
    appTlsa: normalized(observation.appTlsa),
    issues,
    status: issues.length === 0 ? "ok" : "drift",
  };
}
