#!/usr/bin/env bun

import { runOnePlatformJob } from "../references/templates/api-worker-auth-first-slice/src/lib/platform-job-runner";
import { nowIso } from "../references/templates/api-worker-auth-first-slice/src/lib/time";
import { createRuntimeStore } from "../references/templates/api-worker-auth-first-slice/src/runtime";
import type { Env } from "../references/templates/api-worker-auth-first-slice/src/types/env";

type JobType = "reddit_snapshot_import" | "reddit_feature_derivation";

function usage(): never {
  console.error(`Usage:
  bun scripts/run-platform-jobs.ts --job-type reddit_snapshot_import|reddit_feature_derivation [--once|--watch]
`);
  process.exit(1);
}

let jobType: JobType | null = null;
let mode: "once" | "watch" = "once";
let resetStuckOlderThanSeconds: number | null = null;

for (let index = 2; index < process.argv.length; ) {
  const arg = process.argv[index];
  const value = process.argv[index + 1];

  if (arg === "--job-type") {
    if (value !== "reddit_snapshot_import" && value !== "reddit_feature_derivation") {
      usage();
    }
    jobType = value as JobType;
    index += 2;
    continue;
  }

  if (arg === "--watch") {
    mode = "watch";
    index += 1;
    continue;
  }

  if (arg === "--once") {
    mode = "once";
    index += 1;
    continue;
  }

  if (arg === "--reset-stuck-older-than-seconds") {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      usage();
    }
    resetStuckOlderThanSeconds = parsed;
    index += 2;
    continue;
  }

  usage();
}

if (!jobType) {
  usage();
}

const env = process.env as unknown as Env;
const store = createRuntimeStore(env);
const pollIntervalMs = Number(env.COMMUNITY_JOB_RUNNER_POLL_INTERVAL_MS || 2000);
let stopRequested = false;

process.on("SIGINT", () => {
  stopRequested = true;
});

process.on("SIGTERM", () => {
  stopRequested = true;
});

if (resetStuckOlderThanSeconds != null) {
  const resetAtIso = nowIso();
  const cutoffIso = new Date(Date.now() - resetStuckOlderThanSeconds * 1000).toISOString();
  const count = await store.resetRunningJobs(jobType, cutoffIso, resetAtIso);
  console.log(`reset_stuck_jobs=${count}`);
}

async function tick(): Promise<void> {
  await runOnePlatformJob({
    env,
    store,
    jobType,
  });
}

if (mode === "once") {
  await tick();
  process.exit(0);
}

let errorBackoffMs = pollIntervalMs;
while (!stopRequested) {
  try {
    await tick();
    errorBackoffMs = pollIntervalMs;
    if (!stopRequested) {
      await Bun.sleep(pollIntervalMs);
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    if (!stopRequested) {
      await Bun.sleep(errorBackoffMs);
      errorBackoffMs = Math.min(errorBackoffMs * 2, 30000);
    }
  }
}
