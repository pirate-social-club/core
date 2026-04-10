import type { MarketContextJobResult } from "../references/templates/api-worker-auth-first-slice/src/lib/market-context/types";
import {
  hasFlag,
  readArg,
  runMarketContextHarness,
  type HarnessRunOutput,
  type ParsedMatchingEvidence,
} from "./market-context-harness";

type ExpectedOutcome = "attach" | "abstain" | "related_context";

type BenchmarkCase = {
  case_id: string;
  url: string;
  title: string;
  last_verified_at?: string;
  claim_type_expected?: string;
  expected_outcome: ExpectedOutcome;
  expected_claim_keywords: string[];
  acceptable_market_patterns: string[];
  forbidden_market_patterns: string[];
  notes?: string;
};

type BenchmarkSuite = {
  version: number;
  suite_name: string;
  notes?: string;
  cases: BenchmarkCase[];
};

type FailureBucket =
  | "F0_out_of_scope_by_policy"
  | "pass"
  | "F1_extraction_abstained_wrongly"
  | "F2_extraction_misframed_claim"
  | "F3_provider_recall_missing"
  | "F4_local_filter_overblocked"
  | "F5_recall_rank_missed"
  | "F6_rerank_overconservative"
  | "F7_scorer_threshold_too_high"
  | "F8_no_acceptable_market_exists"
  | "F9_stale_or_resolved_market_problem"
  | "F10_wrong_product_shape"
  | "F11_provider_corpus_truncation"
  | "FA_false_attach";

type CaseAudit = {
  case_id: string;
  expected_outcome: ExpectedOutcome;
  result_status: MarketContextJobResult["status"];
  extraction_pass: boolean;
  retrieval_pass: boolean;
  attachment_pass_strict: boolean;
  attachment_pass_permissive: boolean;
  failure_bucket: FailureBucket;
  top_candidate_question: string | null;
  top_candidate_score: number | null;
  attached_questions: string[];
  evidence_summary: HarnessRunOutput["evidence_summary"];
};

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

function containsAllKeywords(value: string, keywords: string[]): boolean {
  if (keywords.length === 0) {
    return true;
  }

  const normalizedValue = normalize(value);
  return keywords.every((keyword) => normalizedValue.includes(normalize(keyword)));
}

function matchesAnyPattern(value: string, patterns: string[]): boolean {
  if (patterns.length === 0) {
    return false;
  }

  const normalizedValue = normalize(value);
  return patterns.some((pattern) => normalizedValue.includes(normalize(pattern)));
}

function getCandidateTexts(output: HarnessRunOutput): string[] {
  const scored =
    output.evidence?.scoredCandidates?.flatMap((candidate) =>
      candidate.market_candidate?.question ? [candidate.market_candidate.question] : [],
    ) ?? [];
  const attached = output.markets.map((market) => market.question);
  return Array.from(new Set([...attached, ...scored]));
}

function extractionPass(testCase: BenchmarkCase, output: HarnessRunOutput): boolean {
  const claims = output.evidence_summary?.raw_claim_candidates ?? [];
  const combinedClaimText = claims
    .flatMap((candidate) => [candidate.claim_text ?? "", candidate.normalized_claim_text ?? ""])
    .join(" ");

  if (testCase.expected_outcome === "abstain") {
    return output.evidence_summary?.extraction_should_attach !== true;
  }

  return (
    output.evidence_summary?.extraction_should_attach === true &&
    claims.length > 0 &&
    containsAllKeywords(combinedClaimText, testCase.expected_claim_keywords)
  );
}

function retrievalPass(testCase: BenchmarkCase, output: HarnessRunOutput): boolean {
  if (testCase.expected_outcome === "abstain") {
    return output.result.status === "no_match";
  }

  const candidateTexts = getCandidateTexts(output);
  if (testCase.acceptable_market_patterns.length === 0) {
    return candidateTexts.length > 0;
  }

  return candidateTexts.some((text) => matchesAnyPattern(text, testCase.acceptable_market_patterns));
}

function attachmentPass(testCase: BenchmarkCase, output: HarnessRunOutput): boolean {
  const attachedQuestions = output.markets.map((market) => market.question);

  if (testCase.expected_outcome === "abstain") {
    return output.result.status === "no_match";
  }

  if (testCase.expected_outcome === "related_context") {
    return (
      attachedQuestions.some((question) =>
        matchesAnyPattern(question, testCase.acceptable_market_patterns),
      ) || retrievalPass(testCase, output)
    );
  }

  if (output.result.status !== "attached") {
    return false;
  }

  if (
    attachedQuestions.some((question) =>
      matchesAnyPattern(question, testCase.forbidden_market_patterns),
    )
  ) {
    return false;
  }

  return attachedQuestions.some((question) =>
    matchesAnyPattern(question, testCase.acceptable_market_patterns),
  );
}

function attachmentPassStrict(testCase: BenchmarkCase, output: HarnessRunOutput): boolean {
  const attachedQuestions = output.markets.map((market) => market.question);

  if (testCase.expected_outcome === "abstain") {
    return output.result.status === "no_match";
  }

  if (testCase.expected_outcome === "related_context") {
    if (output.result.status !== "attached") {
      return false;
    }

    return attachedQuestions.some((question) =>
      matchesAnyPattern(question, testCase.acceptable_market_patterns),
    );
  }

  return attachmentPass(testCase, output);
}

function hasKalshiTruncationSignal(output: HarnessRunOutput): boolean {
  const diagnostics = output.evidence_summary?.retrieval_diagnostics ?? [];
  return diagnostics.some((claimDiagnostic) =>
    claimDiagnostic.provider_diagnostics.some((providerDiagnostic) => {
      if (providerDiagnostic.provider_key !== "kalshi") {
        return false;
      }

      const successfulQueries = providerDiagnostic.raw_result_count_by_query.filter(
        (entry) => !entry.failed,
      );
      const queryResultLimit = providerDiagnostic.query_result_limit;

      if (!queryResultLimit || successfulQueries.length === 0) {
        return false;
      }

      const saturatedQueries = successfulQueries.filter(
        (entry) => entry.count >= queryResultLimit,
      ).length;

      return (
        saturatedQueries >= Math.max(1, successfulQueries.length - 1) &&
        providerDiagnostic.deduped_count >= Math.floor(queryResultLimit / 2) &&
        providerDiagnostic.returned_count === 0
      );
    }),
  );
}

function isOutOfScopeByPolicy(testCase: BenchmarkCase, output: HarnessRunOutput): boolean {
  const summary = output.evidence_summary;
  if (!summary) {
    return false;
  }

  if (testCase.expected_outcome === "abstain") {
    return false;
  }

  const expectedClaimType = testCase.claim_type_expected?.trim();
  if (!expectedClaimType) {
    return false;
  }

  const rawHasExpectedType = summary.raw_claim_candidates.some(
    (candidate) => candidate.claim_type === expectedClaimType,
  );
  const scopedHasExpectedType = summary.claim_candidates.some(
    (candidate) => candidate.claim_type === expectedClaimType,
  );

  return (
    rawHasExpectedType &&
    !scopedHasExpectedType &&
    summary.allowed_claim_types.length > 0 &&
    !summary.allowed_claim_types.includes(expectedClaimType)
  );
}

function classifyFailure(testCase: BenchmarkCase, output: HarnessRunOutput): FailureBucket {
  const extractionOk = extractionPass(testCase, output);
  const retrievalOk = retrievalPass(testCase, output);
  const attachmentOk = attachmentPassStrict(testCase, output);

  if (testCase.expected_outcome === "abstain" && output.result.status === "attached") {
    return "FA_false_attach";
  }

  if (attachmentOk) {
    return "pass";
  }

  if (isOutOfScopeByPolicy(testCase, output)) {
    return "F0_out_of_scope_by_policy";
  }

  if (!extractionOk) {
    if (output.evidence_summary?.extraction_should_attach !== true) {
      return "F1_extraction_abstained_wrongly";
    }

    return "F2_extraction_misframed_claim";
  }

  if (hasKalshiTruncationSignal(output)) {
    return "F11_provider_corpus_truncation";
  }

  const diagnostics = output.evidence_summary?.retrieval_diagnostics ?? [];
  const hadRawResults = diagnostics.some((claimDiagnostic) =>
    claimDiagnostic.provider_diagnostics.some((providerDiagnostic) => providerDiagnostic.raw_result_count > 0),
  );
  const hadFilterDropoff = diagnostics.some((claimDiagnostic) =>
    claimDiagnostic.provider_diagnostics.some(
      (providerDiagnostic) =>
        providerDiagnostic.raw_result_count > 0 &&
        providerDiagnostic.returned_count === 0 &&
        (providerDiagnostic.post_claim_filter_count === 0 ||
          providerDiagnostic.post_relevance_filter_count === 0),
    ),
  );
  const hadRecallHits = diagnostics.some((claimDiagnostic) => claimDiagnostic.recall_hit_count > 0);
  const rerankBlocked = diagnostics.some(
    (claimDiagnostic) =>
      claimDiagnostic.gathered_candidate_count > 0 &&
      (claimDiagnostic.rerank_status === "abstained" || claimDiagnostic.rerank_status === "failed"),
  );

  if (!hadRawResults) {
    return "F3_provider_recall_missing";
  }

  if (hadFilterDropoff && !retrievalOk) {
    return "F4_local_filter_overblocked";
  }

  if (!retrievalOk && hadRecallHits) {
    return "F5_recall_rank_missed";
  }

  if (rerankBlocked && !retrievalOk) {
    return "F6_rerank_overconservative";
  }

  if (retrievalOk && !attachmentOk) {
    const topAttached = output.markets.some((market) =>
      matchesAnyPattern(market.question, testCase.acceptable_market_patterns),
    );
    if (!topAttached) {
      return "F7_scorer_threshold_too_high";
    }
  }

  if (testCase.expected_outcome === "related_context") {
    return "F8_no_acceptable_market_exists";
  }

  if (testCase.expected_outcome === "abstain") {
    return "F10_wrong_product_shape";
  }

  return "F8_no_acceptable_market_exists";
}

function summarizeCase(testCase: BenchmarkCase, output: HarnessRunOutput): CaseAudit {
  const topCandidate = output.evidence?.scoredCandidates?.[0];

  return {
    case_id: testCase.case_id,
    expected_outcome: testCase.expected_outcome,
    result_status: output.result.status,
    extraction_pass: extractionPass(testCase, output),
    retrieval_pass: retrievalPass(testCase, output),
    attachment_pass_strict: attachmentPassStrict(testCase, output),
    attachment_pass_permissive: attachmentPass(testCase, output),
    failure_bucket: classifyFailure(testCase, output),
    top_candidate_question: topCandidate?.market_candidate?.question ?? null,
    top_candidate_score: topCandidate?.final_score ?? null,
    attached_questions: output.markets.map((market) => market.question),
    evidence_summary: output.evidence_summary,
  };
}

function countBy<T extends string>(values: T[]): Record<T, number> {
  return values.reduce<Record<T, number>>((acc, value) => {
    acc[value] = (acc[value] ?? 0) + 1;
    return acc;
  }, {} as Record<T, number>);
}

async function loadSuite(path: string): Promise<BenchmarkSuite> {
  return (await Bun.file(path).json()) as BenchmarkSuite;
}

type PreviousBenchmarkSummary = {
  cases?: Array<{
    case_id?: string;
    failure_bucket?: FailureBucket;
  }>;
};

async function loadPreviousFailedCaseIds(path: string): Promise<Set<string>> {
  const payload = (await Bun.file(path).json()) as PreviousBenchmarkSummary;
  const failedCaseIds =
    payload.cases
      ?.filter((candidate) => candidate.case_id && candidate.failure_bucket && candidate.failure_bucket !== "pass")
      .map((candidate) => candidate.case_id as string) ?? [];

  return new Set(failedCaseIds);
}

async function main() {
  if (hasFlag("--help")) {
    console.log(
      "Usage: bun scripts/market-context-benchmark.ts [--suite <path>] [--case <case_id>] [--limit <n>] [--verbose]",
    );
    return;
  }

  const suitePath = readArg("--suite") ?? "scripts/market-context-benchmark.json";
  const caseId = readArg("--case");
  const limitRaw = readArg("--limit");
  const previousPath = readArg("--previous");
  const outputPath = readArg("--output");
  const onlyFailed = hasFlag("--only-failed");
  const limit = limitRaw ? Number(limitRaw) : null;
  const verbose = hasFlag("--verbose");

  const suite = await loadSuite(suitePath);
  const previousFailedCaseIds =
    onlyFailed && previousPath ? await loadPreviousFailedCaseIds(previousPath) : null;
  const selectedCases = suite.cases
    .filter((testCase) => (caseId ? testCase.case_id === caseId : true))
    .filter((testCase) =>
      onlyFailed && previousFailedCaseIds ? previousFailedCaseIds.has(testCase.case_id) : true,
    )
    .slice(0, limit != null && Number.isFinite(limit) ? limit : suite.cases.length);

  const caseAudits: CaseAudit[] = [];

  for (const testCase of selectedCases) {
    const output = await runMarketContextHarness({
      url: testCase.url,
      title: testCase.title,
      verbose,
    });
    caseAudits.push(summarizeCase(testCase, output));
  }

  const summary = {
    suite_name: suite.suite_name,
    suite_path: suitePath,
    total_cases: caseAudits.length,
    expected_outcomes: countBy(caseAudits.map((audit) => audit.expected_outcome)),
    result_statuses: countBy(caseAudits.map((audit) => audit.result_status)),
    extraction_pass_count: caseAudits.filter((audit) => audit.extraction_pass).length,
    retrieval_pass_count: caseAudits.filter((audit) => audit.retrieval_pass).length,
    attachment_pass_strict_count: caseAudits.filter((audit) => audit.attachment_pass_strict).length,
    attachment_pass_permissive_count: caseAudits.filter((audit) => audit.attachment_pass_permissive).length,
    failure_buckets: countBy(caseAudits.map((audit) => audit.failure_bucket)),
    by_claim_type: suite.cases.reduce<Record<string, {
      total: number;
      retrieval_pass_count: number;
      attachment_pass_strict_count: number;
      attachment_pass_permissive_count: number;
    }>>((acc, testCase) => {
      const key = testCase.claim_type_expected ?? "unknown";
      const audit = caseAudits.find((candidate) => candidate.case_id === testCase.case_id);
      if (!audit) {
        return acc;
      }

      if (!acc[key]) {
        acc[key] = {
          total: 0,
          retrieval_pass_count: 0,
          attachment_pass_strict_count: 0,
          attachment_pass_permissive_count: 0,
        };
      }

      acc[key].total += 1;
      acc[key].retrieval_pass_count += audit.retrieval_pass ? 1 : 0;
      acc[key].attachment_pass_strict_count += audit.attachment_pass_strict ? 1 : 0;
      acc[key].attachment_pass_permissive_count += audit.attachment_pass_permissive ? 1 : 0;
      return acc;
    }, {}),
    cases: caseAudits,
  };

  const serialized = JSON.stringify(summary, null, 2);
  if (outputPath) {
    await Bun.write(outputPath, `${serialized}\n`);
  }

  console.log(serialized);
}

void main();
