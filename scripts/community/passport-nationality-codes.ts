export type PassportNationalityGateAssessment =
  | { status: "supported" }
  | { status: "unsupported"; reason: string }
  | { status: "needs_evidence"; reason: string }

const ASSESSMENTS = new Map<string, PassportNationalityGateAssessment>([
  ["ATA", {
    status: "unsupported",
    reason: "Antarctica is an ISO territory code, but no state issues Antarctic nationality documents",
  }],
  ...[
    "ABW",
    "CCK",
    "CYM",
    "FLK",
    "GIB",
    "GRL",
    "MAC",
    "SXM",
    "VGB",
  ].map((code) => [code, {
    status: "unsupported" as const,
    reason: "the territory does not issue a nationality document using this local ISO territory code",
  }] as const),
  ...[
    "MAF",
    "MTQ",
    "PYF",
  ].map((code) => [code, {
    status: "needs_evidence" as const,
    reason: "territory code has not been verified as a passport nationality disclosure value",
  }] as const),
])

export function canonicalPassportNationalityAlias(value: string): string | null {
  switch (value.trim().toUpperCase()) {
    case "KS":
    case "RKS":
    case "XKX":
    case "XKK":
      return "XKK"
    default:
      return null
  }
}

export function assessPassportNationalityGate(code: string): PassportNationalityGateAssessment {
  return ASSESSMENTS.get(code.trim().toUpperCase()) ?? { status: "supported" }
}

export function assertPassportNationalityGateSupported(code: string): void {
  const normalized = code.trim().toUpperCase()
  const assessment = assessPassportNationalityGate(normalized)
  if (assessment.status === "supported") return

  throw new Error(
    `country code ${normalized} cannot be used for a nationality gate: ${assessment.reason}`,
  )
}
