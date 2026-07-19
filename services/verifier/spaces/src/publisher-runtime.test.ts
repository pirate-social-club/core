import { describe, expect, test } from "bun:test";
import {
  FabricRecordReaderUnavailableError,
  PublisherHealthMonitor,
  probePublisher,
  resolvePublisherExecutionConfig,
  runPublisher,
} from "./publisher-runtime";

describe("Spaces publisher runtime", () => {
  test("uses an explicit binary when configured", () => {
    expect(resolvePublisherExecutionConfig({ publisherBin: "/srv/pirate-spaces/bin/spaces-publisher" })).toEqual({
      mode: "binary",
      command: ["/srv/pirate-spaces/bin/spaces-publisher"],
    });
  });

  test("keeps go run as an explicit development fallback", () => {
    expect(resolvePublisherExecutionConfig({ publisherBin: null })).toEqual({
      mode: "go_dev_fallback",
      command: ["go", "run", "."],
    });
  });

  test("classifies a missing executable as reader unavailability", async () => {
    await expect(runPublisher(
      { mode: "binary", command: ["/definitely/missing/spaces-publisher"] },
      ["resolve", "@pirate"],
      { cwd: import.meta.dir, timeoutMs: 100 },
    )).rejects.toBeInstanceOf(FabricRecordReaderUnavailableError);
  });

  test("reports a working executable as ready", async () => {
    const status = await probePublisher(
      { mode: "binary", command: [process.execPath, "-e", "process.exit(0)"] },
      { cwd: import.meta.dir, timeoutMs: 1_000 },
    );
    expect(status).toEqual({ ready: true, error: null });
  });

  test("uses the configured live probe arguments", async () => {
    const status = await probePublisher(
      {
        mode: "binary",
        command: [
          process.execPath,
          "-e",
          "process.exit(Bun.argv.at(-1) === '@pirate' ? 0 : 1)",
        ],
      },
      { cwd: import.meta.dir, timeoutMs: 1_000, args: ["resolve", "@pirate"] },
    );
    expect(status.ready).toBe(true);
  });

  test("health recovers after a failed keepalive", async () => {
    const monitor = new PublisherHealthMonitor();
    await monitor.check(async () => ({ ready: false, error: "relay unavailable" }));
    expect(monitor.snapshot()).toMatchObject({
      ready: false,
      checking: false,
      lastError: "relay unavailable",
      lastSuccessAt: null,
    });

    await monitor.check(async () => ({ ready: true, error: null }));
    expect(monitor.snapshot()).toMatchObject({
      ready: true,
      checking: false,
      lastError: null,
    });
    expect(monitor.snapshot().lastSuccessAt).not.toBeNull();
  });

  test("deduplicates overlapping keepalive checks", async () => {
    const monitor = new PublisherHealthMonitor();
    let calls = 0;
    let releaseProbe = () => {};
    const blockedProbe = async () => {
      calls += 1;
      await new Promise<void>((resolve) => {
        releaseProbe = resolve;
      });
      return { ready: true, error: null };
    };

    const first = monitor.check(blockedProbe);
    const second = monitor.check(blockedProbe);
    expect(calls).toBe(1);
    expect(monitor.snapshot().checking).toBe(true);
    releaseProbe();
    await Promise.all([first, second]);
    expect(calls).toBe(1);
    expect(monitor.snapshot().ready).toBe(true);
  });
});
