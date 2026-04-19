# Market Context Benchmark

This benchmark is the audit harness for prediction-market matching quality.

It is intentionally split into three stages:

- extraction
- retrieval
- attachment

That separation matters because the current system is often acceptable at extraction while still failing at retrieval or final attachment.

## Files

- [market-context-benchmark.json](./fixtures/market-context-benchmark.json)

The benchmark corpus still lives in `scripts/`, but the runner and harness are not present in this repo snapshot. Treat this document as the contract for that benchmark shape, not as a guarantee that the local runner exists here today.

## Case Schema

Each benchmark case carries:

- `case_id`
- `url`
- `title`
- `last_verified_at`
- `claim_type_expected`
- `expected_outcome`
- `expected_claim_keywords`
- `acceptable_market_patterns`
- `forbidden_market_patterns`
- `notes`

`expected_outcome` is one of:

- `attach`
- `abstain`
- `related_context`

`attach` means v1 should be able to show a close market match.

`related_context` means an exact market may not exist, but a clearly aligned related market could still be useful if Pirate chooses a fallback framing later.

`abstain` means the system should not show market context.

## Failure Buckets

- `F0_out_of_scope_by_policy`
- `F1_extraction_abstained_wrongly`
- `F2_extraction_misframed_claim`
- `F3_provider_recall_missing`
- `F4_local_filter_overblocked`
- `F5_recall_rank_missed`
- `F6_rerank_overconservative`
- `F7_scorer_threshold_too_high`
- `F8_no_acceptable_market_exists`
- `F9_stale_or_resolved_market_problem`
- `F10_wrong_product_shape`
- `F11_provider_corpus_truncation`
- `FA_false_attach`

`F0_out_of_scope_by_policy` means the raw extraction found a plausible claim, but the current runtime policy intentionally filtered that claim type out before provider retrieval. This is not a retrieval-quality failure; it is a launch-scope decision.

`F11_provider_corpus_truncation` exists specifically for cases like Kalshi, where the current client-side search strategy may be bounded by a shallow provider slice rather than the provider's full market corpus.

## Commands

Historical runner shape for the full seed suite:

```bash
rtk infisical run --env=dev --path=/services/api -- bun scripts/market-context-benchmark.ts
```

Historical runner shape for one case:

```bash
rtk infisical run --env=dev --path=/services/api -- bun scripts/market-context-benchmark.ts --case fed_axios_hold_2026_03_18
```

Historical runner shape for a small prefix of the suite:

```bash
rtk infisical run --env=dev --path=/services/api -- bun scripts/market-context-benchmark.ts --limit 3
```

## Audit Reading

The benchmark output reports:

- expected outcomes
- result statuses
- extraction / retrieval / strict-attachment / permissive-attachment pass counts
- failure-bucket distribution
- per-claim-type retrieval and attachment counts
- per-case evidence summaries

Per-case evidence summaries now distinguish:

- `raw_claim_candidates`
- `claim_candidates`
- `allowed_claim_types`
- `scope_filtered`

This makes it possible to tell whether a `no_match` came from poor retrieval or from an intentional policy scope gate.

The main retrieval gate to watch is not just overall hit rate. It should be read per claim type. A strong sports/election score can hide weak macro or geopolitics performance if only overall averages are used.

`attachment_pass_strict` means the system actually attached a market that meets the case's acceptance criteria.

`attachment_pass_permissive` means the system either attached such a market or surfaced enough aligned retrieval context that a fallback "related markets" framing might still be viable.

The current seed suite is still intentionally small, but it now includes both:

- legacy hard cases like macro / geopolitics / analysis
- current default-scope cases like election / sports / asset_price / company_milestone

Its outputs are still directional rather than statistically stable.

## Iteration Flags

Historical runner shape to write a report to disk:

```bash
rtk infisical run --env=dev --path=/services/api -- bun scripts/market-context-benchmark.ts --output /tmp/market-context-benchmark.json
```

Historical runner shape to rerun only previously failed cases:

```bash
rtk infisical run --env=dev --path=/services/api -- bun scripts/market-context-benchmark.ts --previous /tmp/market-context-benchmark.json --only-failed
```
