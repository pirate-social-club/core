import { describe, expect, test } from "bun:test";
import { ChainHealthMonitor } from "./chain-health";

describe("ChainHealthMonitor", () => {
  test("reports independent tip and anchor lag", async () => {
    const monitor = new ChainHealthMonitor(6, 108);
    await monitor.check(async () => ({
      indexedHeight: 1_000,
      externalTipHeight: 1_003,
      newestAnchorHeight: 972,
    }), new Date("2026-08-06T10:00:00Z"));

    expect(monitor.snapshot()).toMatchObject({
      ready: true,
      indexed_height: 1_000,
      external_tip_height: 1_003,
      newest_anchor_height: 972,
      tip_lag_blocks: 3,
      anchor_lag_blocks: 31,
      last_index_progress_at: "2026-08-06T10:00:00.000Z",
    });
  });

  test("fails health independently for index and anchor lag", async () => {
    const indexMonitor = new ChainHealthMonitor(6, 108);
    await indexMonitor.check(async () => ({
      indexedHeight: 900,
      externalTipHeight: 1_000,
      newestAnchorHeight: 972,
    }));
    expect(indexMonitor.snapshot()).toMatchObject({ ready: false, tip_lag_blocks: 100 });

    const anchorMonitor = new ChainHealthMonitor(6, 108);
    await anchorMonitor.check(async () => ({
      indexedHeight: 1_000,
      externalTipHeight: 1_000,
      newestAnchorHeight: 850,
    }));
    expect(anchorMonitor.snapshot()).toMatchObject({ ready: false, anchor_lag_blocks: 150 });
  });

  test("tracks the last observed index advance", async () => {
    const monitor = new ChainHealthMonitor(6, 108);
    await monitor.check(
      async () => ({ indexedHeight: 1_000, externalTipHeight: 1_000, newestAnchorHeight: 972 }),
      new Date("2026-08-06T10:00:00Z"),
    );
    await monitor.check(
      async () => ({ indexedHeight: 1_000, externalTipHeight: 1_001, newestAnchorHeight: 972 }),
      new Date("2026-08-06T10:05:00Z"),
    );
    expect(monitor.snapshot().last_index_progress_at).toBe("2026-08-06T10:00:00.000Z");

    await monitor.check(
      async () => ({ indexedHeight: 1_001, externalTipHeight: 1_001, newestAnchorHeight: 972 }),
      new Date("2026-08-06T10:06:00Z"),
    );
    expect(monitor.snapshot().last_index_progress_at).toBe("2026-08-06T10:06:00.000Z");
  });

  test("fails closed when the independent probe errors or anchors are absent", async () => {
    const monitor = new ChainHealthMonitor(6, 108);
    await monitor.check(async () => {
      throw new Error("independent tip unavailable");
    });
    expect(monitor.snapshot()).toMatchObject({ ready: false, error: "independent tip unavailable" });

    await monitor.check(async () => ({
      indexedHeight: 1_000,
      externalTipHeight: 1_000,
      newestAnchorHeight: null,
    }));
    expect(monitor.snapshot()).toMatchObject({ ready: false, anchor_lag_blocks: null, error: null });
  });
});
