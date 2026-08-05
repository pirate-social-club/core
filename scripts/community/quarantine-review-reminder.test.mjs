import { describe, expect, test } from "bun:test";
import { quarantineReviewIssueBody, quarantineReviews } from "./quarantine-review-reminder.mjs";

const entry = (overrides = {}) => ({
  binding: "DB_CMTY_0001",
  reason_code: "provider_overload",
  approved_at: "2026-08-01T00:00:00Z",
  review_after: "2026-08-05T00:00:00Z",
  expires_at: "2026-08-10T00:00:00Z",
  ...overrides,
});

describe("quarantine review reminder", () => {
  test("reports approaching and due reviews", () => {
    const registry = {
      version: 1,
      production: [entry()],
      staging: [entry({ binding: "DB_CMTY_0002", review_after: "2026-08-06T12:00:00Z" })],
    };
    const report = quarantineReviews(registry, { now: Date.parse("2026-08-06T00:00:00Z"), leadHours: 24 });
    expect(report.due.map(({ binding, status }) => ({ binding, status }))).toEqual([
      { binding: "DB_CMTY_0001", status: "review_due" },
      { binding: "DB_CMTY_0002", status: "review_approaching" },
    ]);
    expect(quarantineReviewIssueBody(report)).toContain("DB_CMTY_0002");
  });

  test("returns an empty report before the lead window", () => {
    expect(quarantineReviews({ version: 1, production: [entry()], staging: [] }, {
      now: Date.parse("2026-08-01T00:00:00Z"), leadHours: 24,
    }).due).toEqual([]);
  });

  test("fails closed on malformed policy", () => {
    expect(() => quarantineReviews({ version: 1, production: [entry({ expires_at: "bad" })], staging: [] }))
      .toThrow("expires_at must be an ISO-8601 timestamp");
  });
});
