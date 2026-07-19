import { describe, expect, test } from "bun:test";
import { ResolveCache, WorkLimiter, WorkQueueFullError } from "./resolve-control";

describe("ResolveCache", () => {
  test("coalesces concurrent reads and expires them after the configured TTL", async () => {
    let now = 1_000;
    let loads = 0;
    const cache = new ResolveCache<string>(30_000, 10, () => now);
    const load = async () => {
      loads += 1;
      return `value-${loads}`;
    };

    const [first, concurrent] = await Promise.all([
      cache.getOrCreate("@pirate", load),
      cache.getOrCreate("@pirate", load),
    ]);
    expect(first).toBe("value-1");
    expect(concurrent).toBe("value-1");
    expect(loads).toBe(1);

    now += 30_001;
    expect(await cache.getOrCreate("@pirate", load)).toBe("value-2");
    expect(cache.snapshot()).toMatchObject({ hits: 1, misses: 2, entries: 1 });
  });

  test("does not retain failed reads", async () => {
    const cache = new ResolveCache<string>(30_000, 10);
    await expect(cache.getOrCreate("@pirate", async () => {
      throw new Error("relay unavailable");
    })).rejects.toThrow("relay unavailable");

    expect(await cache.getOrCreate("@pirate", async () => "recovered")).toBe("recovered");
  });

  test("bounds entries and evicts the oldest key", async () => {
    const cache = new ResolveCache<string>(30_000, 2);
    await cache.getOrCreate("@one", async () => "one");
    await cache.getOrCreate("@two", async () => "two");
    await cache.getOrCreate("@three", async () => "three");

    expect(cache.snapshot().entries).toBe(2);
    expect(await cache.getOrCreate("@one", async () => "one-again")).toBe("one-again");
  });

  test("lets a higher-sequence observation supersede a cached stale result", async () => {
    type Versioned = { sequence: number; value: string };
    const cache = new ResolveCache<Versioned>(30_000, 10);
    await cache.getOrCreate("@pirate", async () => ({ sequence: 4, value: "stale" }));

    expect(await cache.observeIfNewer(
      "@pirate",
      { sequence: 9, value: "fresh" },
      (candidate) => candidate.sequence,
    )).toBe(true);
    expect(await cache.getOrCreate("@pirate", async () => ({ sequence: 1, value: "unused" })))
      .toEqual({ sequence: 9, value: "fresh" });

    expect(await cache.observeIfNewer(
      "@pirate",
      { sequence: 3, value: "older" },
      (candidate) => candidate.sequence,
    )).toBe(false);
  });
});

describe("WorkLimiter", () => {
  test("caps active work and queues within the configured bound", async () => {
    const limiter = new WorkLimiter(1, 1);
    let releaseFirst: (() => void) | undefined;
    const first = limiter.run(() => new Promise<string>((resolve) => {
      releaseFirst = () => resolve("first");
    }));
    await Promise.resolve();
    const second = limiter.run(async () => "second");
    await Promise.resolve();

    expect(limiter.snapshot()).toMatchObject({ active: 1, queued: 1 });
    await expect(limiter.run(async () => "third")).rejects.toBeInstanceOf(WorkQueueFullError);

    releaseFirst?.();
    expect(await first).toBe("first");
    expect(await second).toBe("second");
    expect(limiter.snapshot()).toMatchObject({ active: 0, queued: 0 });
  });
});
