import { createHash } from "node:crypto";

const FLEETS = ["production", "staging"];

function instant(value, field, binding) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T/u.test(value)) {
    throw new Error(`quarantine ${binding}: ${field} must be an ISO-8601 timestamp`);
  }
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error(`quarantine ${binding}: ${field} is invalid`);
  return parsed;
}

export function quarantineReviews(registry, { now = Date.now(), leadHours = 48 } = {}) {
  if (registry?.version !== 1 || !FLEETS.every((fleet) => Array.isArray(registry[fleet]))) {
    throw new Error("expected quarantine registry version 1 with production and staging arrays");
  }
  if (!Number.isFinite(now) || !Number.isFinite(leadHours) || leadHours < 0) {
    throw new Error("now and leadHours must be finite, with leadHours non-negative");
  }
  const dueBefore = now + leadHours * 60 * 60 * 1000;
  const seen = new Set();
  const due = [];
  for (const fleet of FLEETS) {
    for (const entry of registry[fleet]) {
      const binding = entry?.binding;
      if (typeof binding !== "string" || !binding.startsWith("DB_CMTY")) {
        throw new Error(`${fleet}: every quarantine requires a DB_CMTY binding`);
      }
      const identity = `${fleet}:${binding}`;
      if (seen.has(identity)) throw new Error(`duplicate quarantine ${identity}`);
      seen.add(identity);
      if (typeof entry.reason_code !== "string" || !/^[a-z0-9_]{3,64}$/u.test(entry.reason_code)) {
        throw new Error(`quarantine ${binding}: reason_code must be a stable lowercase identifier`);
      }
      const approved = instant(entry.approved_at, "approved_at", binding);
      const review = instant(entry.review_after, "review_after", binding);
      const expires = instant(entry.expires_at, "expires_at", binding);
      if (!(approved <= review && review < expires)) {
        throw new Error(`quarantine ${binding}: require approved_at <= review_after < expires_at`);
      }
      if (review <= dueBefore) {
        due.push({
          fleet,
          binding,
          reason_code: entry.reason_code,
          review_after: entry.review_after,
          expires_at: entry.expires_at,
          status: expires <= now ? "expired" : review <= now ? "review_due" : "review_approaching",
        });
      }
    }
  }
  due.sort((a, b) => a.expires_at.localeCompare(b.expires_at) || a.binding.localeCompare(b.binding));
  const signature = createHash("sha256").update(JSON.stringify(due)).digest("hex");
  return { due, signature, checked_at: new Date(now).toISOString(), lead_hours: leadHours };
}

export function quarantineReviewIssueBody(report) {
  const rows = report.due.map((entry) =>
    `| ${entry.fleet} | \`${entry.binding}\` | \`${entry.reason_code}\` | ${entry.status} | ${entry.review_after} | ${entry.expires_at} |`,
  );
  return `Quarantine review dates are operational prompts; expiry is a hard release stop. Retest the shard, remediate and remove stale entries where possible, and renew only after an explicit review.

| Fleet | Binding | Reason | Status | Review after | Expires |
| --- | --- | --- | --- | --- | --- |
${rows.join("\n")}

Checked at ${report.checked_at} with ${report.lead_hours} hours of lead time.

Runbook: [community shard quarantine review](https://github.com/pirate-social-club/core/blob/main/docs/runbooks/community-shard-quarantine-review.md)

<!-- community-shard-quarantine-review:${report.signature} -->`;
}
