import { afterEach, beforeAll, describe, expect, test } from "bun:test";
import { createHmac, generateKeyPairSync } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { applyPostgresMigrations } from "../../../../scripts/lib/postgres-migrations";
import { seedControlPlaneFixtures } from "../../../../scripts/lib/control-plane-fixtures";
import { runRedditOnboardingSmoke } from "../../../../scripts/reddit-onboarding-smoke";
import { runOnePlatformJob } from "./lib/platform-job-runner";
import { createFetchHandler, createRuntimeStore } from "./runtime";
import type { Env } from "./types/env";

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(TEST_DIR, "../../../../");
const MIGRATIONS_DIR = resolve(REPO_ROOT, "db/control-plane/migrations");
const ORIGINAL_FETCH = globalThis.fetch;
const ORIGINAL_FETCH_CALL = globalThis.fetch.bind(globalThis);

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`missing env var for test: ${name}`);
  }

  return value;
}

function base64url(input: string): string {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function buildEnv(): Env {
  const keyPair =
    process.env.PIRATE_APP_JWT_PRIVATE_KEY && process.env.PIRATE_APP_JWT_PUBLIC_KEY
      ? null
      : generateKeyPairSync("rsa", {
          modulusLength: 2048,
          privateKeyEncoding: {
            type: "pkcs8",
            format: "pem",
          },
          publicKeyEncoding: {
            type: "spki",
            format: "pem",
          },
        });

  return {
    CONTROL_PLANE_DATABASE_URL: requiredEnv("CONTROL_PLANE_DATABASE_URL"),
    AUTH_UPSTREAM_JWT_ISSUER: process.env.AUTH_UPSTREAM_JWT_ISSUER ?? "pirate-dev-upstream",
    AUTH_UPSTREAM_JWT_AUDIENCE: process.env.AUTH_UPSTREAM_JWT_AUDIENCE ?? "pirate-api",
    AUTH_UPSTREAM_JWT_SHARED_SECRET: process.env.AUTH_UPSTREAM_JWT_SHARED_SECRET ?? "dev-upstream-secret",
    PIRATE_APP_JWT_ISSUER: process.env.PIRATE_APP_JWT_ISSUER ?? "pirate-dev-local",
    PIRATE_APP_JWT_AUDIENCE: process.env.PIRATE_APP_JWT_AUDIENCE ?? "pirate-app",
    PIRATE_APP_JWT_PUBLIC_KEY: process.env.PIRATE_APP_JWT_PUBLIC_KEY ?? keyPair?.publicKey ?? "",
    PIRATE_APP_JWT_PRIVATE_KEY: process.env.PIRATE_APP_JWT_PRIVATE_KEY ?? keyPair?.privateKey ?? "",
  };
}

function mintUpstreamJwt(env: Env, subject: string): string {
  const now = Math.floor(Date.now() / 1000);
  const header = {
    alg: "HS256",
    typ: "JWT",
  };
  const payload = {
    iss: env.AUTH_UPSTREAM_JWT_ISSUER,
    aud: env.AUTH_UPSTREAM_JWT_AUDIENCE,
    sub: subject,
    iat: now,
    nbf: now,
    exp: now + 3600,
  };

  const signingInput = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(payload))}`;
  const signature = createHmac("sha256", env.AUTH_UPSTREAM_JWT_SHARED_SECRET)
    .update(signingInput)
    .digest("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");

  return `${signingInput}.${signature}`;
}

async function exchangeAccessToken(handler: ReturnType<typeof createFetchHandler>, env: Env, subject: string): Promise<string> {
  const response = await handler(
    new Request("http://127.0.0.1:8787/auth/session/exchange", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        proof: {
          type: "jwt_based_auth",
          jwt: mintUpstreamJwt(env, subject),
        },
      }),
    }),
  );
  const body = (await response.json()) as { access_token: string };
  return body.access_token;
}

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
});

beforeAll(async () => {
  if (process.env.CONTROL_PLANE_MIGRATOR_DATABASE_URL) {
    await applyPostgresMigrations({
      databaseUrl: process.env.CONTROL_PLANE_MIGRATOR_DATABASE_URL,
      migrationsDir: MIGRATIONS_DIR,
      label: "control-plane",
    });
  }

  await seedControlPlaneFixtures({
    databaseUrl: requiredEnv("CONTROL_PLANE_DATABASE_URL"),
    userId: "usr_demo_01",
    issuer: "pirate-dev-upstream",
    subject: "demo-subject-01",
    handle: "demo",
    namespaceLabel: "demo",
  });
}, 30000);

describe("Reddit onboarding", () => {
  test("happy path round-trips through the reference fetch handler", async () => {
    const result = await runRedditOnboardingSmoke();

    expect(result.ok).toBe(true);
    expect(result.subject).toBe("demo-subject-01");
    expect(result.reddit_username).toBe("technohippie");
    expect(result.global_karma).toBe(44200);
    expect(result.top_subreddit).toBe("electronicmusic");
    expect(result.suggested_community_ids).toEqual(["cmt_music_01", "cmt_design_01"]);
  }, 30000);

  test("verification polling checks Reddit HTML and import builds a PullPush-backed snapshot", async () => {
    const env = buildEnv();
    const store = createRuntimeStore(env);
    const handler = createFetchHandler({
      env,
      store,
    });
    const accessToken = await exchangeAccessToken(handler, env, "demo-subject-01");
    const redditUsername = `test-reddit-user-${Date.now()}`;

    const firstVerificationResponse = await handler(
      new Request("http://127.0.0.1:8787/onboarding/reddit-verification", {
        method: "POST",
        headers: {
          authorization: `Bearer ${accessToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          reddit_username: redditUsername,
        }),
      }),
    );
    const firstVerificationBody = (await firstVerificationResponse.json()) as {
      status: string;
      verification_hint: string | null;
    };

    expect(firstVerificationResponse.status).toBe(200);
    expect(firstVerificationBody.status).toBe("pending");

    const verificationRow = await store.getLatestRedditVerificationSessionForUserAndUsername("usr_demo_01", redditUsername);
    expect(verificationRow).not.toBeNull();
    const verificationCode = verificationRow?.verification_code ?? "";
    expect(verificationCode.startsWith("pirate-")).toBe(true);

    const mockedFetch = Object.assign(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;

        if (url === `https://old.reddit.com/user/${redditUsername}/`) {
          return new Response(`<html><body>${verificationCode}</body></html>`, {
            status: 200,
            headers: {
              "content-type": "text/html; charset=utf-8",
            },
          });
        }

        if (url === `https://www.reddit.com/user/${redditUsername}/`) {
          return new Response("<html><title>Reddit - Please wait for verification</title><input name=\"solution\" /></html>", {
            status: 200,
            headers: {
              "content-type": "text/html; charset=utf-8",
            },
          });
        }

        if (url.startsWith("https://api.pullpush.io/reddit/search/submission/")) {
          return Response.json({
            data: [
              {
                id: "abc123",
                subreddit: "electronicmusic",
                title: "Warehouse set notes",
                selftext: "Detailed breakdown",
                score: 120,
                created_utc: 1_700_000_000,
                url: "https://reddit.com/r/electronicmusic/comments/abc123",
              },
              {
                id: "def456",
                subreddit: "design",
                title: "Poster process",
                selftext: "Color and type experiments",
                score: 40,
                created_utc: 1_699_000_000,
                url: "https://reddit.com/r/design/comments/def456",
              },
            ],
          });
        }

        if (url.startsWith("https://api.pullpush.io/reddit/search/comment/")) {
          return Response.json({
            data: [
              {
                id: "ghi789",
                subreddit: "electronicmusic",
                body: "Loved the set architecture",
                score: 55,
                created_utc: 1_700_100_000,
                parent_id: "t1_parent",
                link_id: "t3_abc123",
              },
              {
                id: "jkl012",
                subreddit: "ableton",
                body: "Routing template is clean",
                score: 35,
                created_utc: 1_700_050_000,
                parent_id: "t1_parent_2",
                link_id: "t3_other",
              },
            ],
          });
        }

        return ORIGINAL_FETCH_CALL(input, init);
      },
      {
        preconnect: ORIGINAL_FETCH.preconnect?.bind(ORIGINAL_FETCH),
      },
    );
    globalThis.fetch = mockedFetch as typeof globalThis.fetch;

    const secondVerificationResponse = await handler(
      new Request("http://127.0.0.1:8787/onboarding/reddit-verification", {
        method: "POST",
        headers: {
          authorization: `Bearer ${accessToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          reddit_username: redditUsername,
        }),
      }),
    );
    const secondVerificationBody = (await secondVerificationResponse.json()) as {
      status: string;
      failure_code: string | null;
    };

    expect(secondVerificationResponse.status).toBe(200);
    expect(secondVerificationBody.status).toBe("verified");
    expect(secondVerificationBody.failure_code).toBeNull();

    const importResponse = await handler(
      new Request("http://127.0.0.1:8787/onboarding/reddit-imports", {
        method: "POST",
        headers: {
          authorization: `Bearer ${accessToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          reddit_username: redditUsername,
        }),
      }),
    );
    const importBody = (await importResponse.json()) as {
      job: {
        status: string;
      };
    };

    expect(importResponse.status).toBe(202);
    expect(importBody.job.status).toBe("queued");

    const ranJob = await runOnePlatformJob({
      env,
      store,
      jobType: "reddit_snapshot_import",
    });
    expect(ranJob).toBe(true);

    const ranDerivationJob = await runOnePlatformJob({
      env,
      store,
      jobType: "reddit_feature_derivation",
    });
    expect(ranDerivationJob).toBe(true);

    const snapshot = await store.getLatestExternalReputationSnapshotForUserAndHandle("usr_demo_01", redditUsername);
    expect(snapshot).not.toBeNull();

    const subredditAffinities = await store.listUserRedditSubredditAffinitiesForSnapshot(
      snapshot?.external_reputation_snapshot_id ?? "",
    );
    const interestTags = await store.listUserInterestTagsForSnapshot(snapshot?.external_reputation_snapshot_id ?? "");
    const audienceSegments = await store.listUserAudienceSegmentsForSnapshot(
      snapshot?.external_reputation_snapshot_id ?? "",
    );

    expect(subredditAffinities[0]?.subreddit).toBe("electronicmusic");
    expect(subredditAffinities[0]?.total_score).toBe(175);
    expect(subredditAffinities.map((entry) => entry.subreddit)).toContain("ableton");
    expect(interestTags.map((entry) => entry.tag)).toContain("electronic music");
    expect(interestTags.map((entry) => entry.tag)).toContain("design");
    expect(audienceSegments.map((entry) => entry.segment_key)).toContain("aud_music_production");
    expect(audienceSegments.map((entry) => entry.segment_key)).toContain("aud_creator_operator");

    const latestResponse = await handler(
      new Request("http://127.0.0.1:8787/onboarding/reddit-imports/latest", {
        headers: {
          authorization: `Bearer ${accessToken}`,
        },
      }),
    );
    const latestBody = (await latestResponse.json()) as {
      reddit_username: string;
      global_karma: number | null;
      top_subreddits: Array<{ subreddit: string }>;
      inferred_interests: string[];
      suggested_communities: Array<{ community_id: string }>;
      coverage_note: string | null;
    };

    expect(latestResponse.status).toBe(200);
    expect(latestBody.reddit_username).toBe(redditUsername);
    expect(latestBody.global_karma).toBe(250);
    expect(latestBody.top_subreddits[0]?.subreddit).toBe("electronicmusic");
    expect(latestBody.inferred_interests).toContain("electronic music");
    expect(latestBody.suggested_communities.map((entry) => entry.community_id)).toContain("cmt_music_01");
    expect(latestBody.coverage_note).toContain("PullPush archival snapshot");
  }, 30000);
});
