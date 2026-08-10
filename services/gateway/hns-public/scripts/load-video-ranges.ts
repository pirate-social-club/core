#!/usr/bin/env bun

type Options = {
  concurrency: number;
  disconnectEvery: number;
  host: string | null;
  objectBytes: number;
  rangeBytes: number;
  readDelayMs: number;
  requests: number;
  timeoutMs: number;
  url: string;
};

function option(name: string): string | null {
  const index = Bun.argv.indexOf(name);
  return index >= 0 ? Bun.argv[index + 1]?.trim() || null : null;
}

function positiveInteger(name: string, fallback: number): number {
  const value = option(name);
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error(`${name} must be a positive integer`);
  return parsed;
}

function nonNegativeInteger(name: string, fallback: number): number {
  const value = option(name);
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error(`${name} must be a non-negative integer`);
  return parsed;
}

function parseOptions(): Options {
  const url = option("--url");
  if (!url) {
    throw new Error("usage: load-video-ranges.ts --url <content-url> [--host api.pirate] [--requests 250] [--concurrency 20]");
  }
  const rangeBytes = positiveInteger("--range-bytes", 1_048_576);
  return {
    concurrency: positiveInteger("--concurrency", 20),
    disconnectEvery: nonNegativeInteger("--disconnect-every", 10),
    host: option("--host"),
    objectBytes: positiveInteger("--object-bytes", rangeBytes),
    rangeBytes,
    readDelayMs: nonNegativeInteger("--read-delay-ms", 0),
    requests: positiveInteger("--requests", 250),
    timeoutMs: positiveInteger("--timeout-ms", 30_000),
    url,
  };
}

function percentile(sorted: number[], fraction: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))] ?? 0;
}

async function pause(milliseconds: number): Promise<void> {
  if (milliseconds > 0) await Bun.sleep(milliseconds);
}

async function main(): Promise<void> {
  const config = parseOptions();
  const latencies: number[] = [];
  const failures: Array<{ index: number; message: string }> = [];
  let completed = 0;
  let disconnected = 0;
  let transferredBytes = 0;
  let nextIndex = 0;
  const startedAt = performance.now();

  const runOne = async (index: number) => {
    const rangeStart = (index * config.rangeBytes) % config.objectBytes;
    const rangeEnd = Math.min(config.objectBytes - 1, rangeStart + config.rangeBytes - 1);
    const intentionalDisconnect = config.disconnectEvery > 0 && (index + 1) % config.disconnectEvery === 0;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(new Error("request timeout")), config.timeoutMs);
    const requestStartedAt = performance.now();
    try {
      const response = await fetch(config.url, {
        headers: {
          ...(config.host ? { host: config.host } : {}),
          range: `bytes=${rangeStart}-${rangeEnd}`,
        },
        signal: controller.signal,
      });
      if (response.status !== 206 || !response.headers.get("content-range")) {
        throw new Error(`expected 206 with Content-Range, received ${response.status}`);
      }
      if (!response.body) throw new Error("response body is missing");
      const reader = response.body.getReader();
      if (intentionalDisconnect) {
        const first = await reader.read();
        transferredBytes += first.value?.byteLength ?? 0;
        await reader.cancel("intentional capacity-test disconnect");
        disconnected += 1;
      } else {
        let requestBytes = 0;
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) break;
          requestBytes += chunk.value.byteLength;
          await pause(config.readDelayMs);
        }
        if (requestBytes === 0) throw new Error("range response was empty");
        transferredBytes += requestBytes;
        completed += 1;
      }
      latencies.push(performance.now() - requestStartedAt);
    } catch (error) {
      failures.push({ index, message: error instanceof Error ? error.message : String(error) });
    } finally {
      clearTimeout(timeout);
    }
  };

  await Promise.all(Array.from({ length: Math.min(config.concurrency, config.requests) }, async () => {
    while (nextIndex < config.requests) {
      const index = nextIndex;
      nextIndex += 1;
      await runOne(index);
    }
  }));

  const durationMs = performance.now() - startedAt;
  const sortedLatencies = latencies.toSorted((left, right) => left - right);
  const result = {
    completed_requests: completed,
    concurrency: config.concurrency,
    disconnected_requests: disconnected,
    duration_ms: Math.round(durationMs),
    failed_requests: failures.length,
    failures: failures.slice(0, 20),
    latency_ms: {
      p50: Math.round(percentile(sortedLatencies, 0.5)),
      p95: Math.round(percentile(sortedLatencies, 0.95)),
      p99: Math.round(percentile(sortedLatencies, 0.99)),
    },
    requested_requests: config.requests,
    transferred_bytes: transferredBytes,
    transferred_mib_per_second: Number((transferredBytes / 1_048_576 / (durationMs / 1_000)).toFixed(2)),
  };
  console.log(JSON.stringify(result, null, 2));
  if (failures.length > 0 || completed + disconnected !== config.requests) process.exitCode = 1;
}

await main();
