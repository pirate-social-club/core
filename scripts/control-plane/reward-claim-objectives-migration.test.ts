import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const migration = readFileSync(
  "db/control-plane/migrations/0229_control_plane_reward_claim_objectives.sql",
  "utf8",
);

describe("reward claim objectives control-plane migration", () => {
  test("adds an audited objective boundary without changing the reservation identity", () => {
    expect(migration).toContain("objective TEXT NOT NULL CHECK (objective IN ('study', 'karaoke', 'either'))");
    expect(migration).toContain("UNIQUE (community_id, post_id, reward_identity_id, reward_period_key, reward_kind, objective)");
    expect(migration).toContain("JOIN reward_campaigns AS campaign");
  });

  test("retains legacy Either claims as globally exclusive claims", () => {
    expect(migration).toContain("campaign.eligible_activity");
    expect(migration).toContain("ALTER TABLE reward_song_period_claims RENAME TO reward_song_period_claims_legacy");
  });
});
