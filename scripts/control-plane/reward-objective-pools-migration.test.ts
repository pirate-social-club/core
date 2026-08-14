import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const migration = readFileSync(
  "db/control-plane/migrations/0228_control_plane_reward_objective_pools.sql",
  "utf8",
);

describe("reward objective pools control-plane migration", () => {
  test("uses objective-scoped identity and preserves terminal release semantics", () => {
    expect(migration).toContain("PRIMARY KEY (community_id, post_id, objective)");
    expect(migration).toContain("UNIQUE (reward_campaign_id, objective)");
    expect(migration).toContain("CHECK (objective IN ('study', 'karaoke'))");
    expect(migration).toContain("DROP TABLE reward_song_pools_legacy");
  });

  test("duplicates historical Either campaigns into both objective slots", () => {
    expect(migration).toContain("campaign.eligible_activity = 'either'");
    expect(migration).toContain("SELECT 'study' AS objective");
    expect(migration).toContain("SELECT 'karaoke' AS objective");
  });
});
