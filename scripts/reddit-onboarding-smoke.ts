#!/usr/bin/env bun

import { createHmac, generateKeyPairSync } from "node:crypto";
import { runOnePlatformJob } from "../references/templates/api-worker-auth-first-slice/src/lib/platform-job-runner";
import { createFetchHandler, createRuntimeStore } from "../references/templates/api-worker-auth-first-slice/src/runtime";
import type { Env } from "../references/templates/api-worker-auth-first-slice/src/types/env";

type Options = {
  subject: string;
  redditUsername: string;
  issuer?: string;
  audience?: string;
  secret?: string;
  apiBaseUrl: string;
};

export type RedditOnboardingSmokeResult = {
  ok: true;
  subject: string;
  reddit_username: string;
  global_karma: number | null;
  top_subreddit: string | null;
  suggested_community_ids: string[];
};

function usage(): never {
  console.error(`Usage:
  bun scripts/reddit-onboarding-smoke.ts [options]

Exercises the reference-worker Reddit onboarding happy path against the local control-plane DB.
It calls the in-process fetch handler directly, so no dev server is required.

Options:
  --subject SUB             Default: demo-subject-01
  --reddit-username NAME    Default: technohippie
  --issuer ISS              Optional override. Default: AUTH_UPSTREAM_JWT_ISSUER
  --audience AUD            Optional override. Default: AUTH_UPSTREAM_JWT_AUDIENCE
  --secret SECRET           Optional override. Default: AUTH_UPSTREAM_JWT_SHARED_SECRET
  --api-base-url URL        Default: http://127.0.0.1:8787
  -h, --help                Show this help text.
`);
  process.exit(1);
}

function parseArgs(argv: string[]): Options {
  const options: Options = {
    subject: "demo-subject-01",
    redditUsername: "technohippie",
    apiBaseUrl: "http://127.0.0.1:8787",
  };

  for (let index = 0; index < argv.length; ) {
    const arg = argv[index];
    const value = argv[index + 1];

    switch (arg) {
      case "--subject":
        options.subject = value ?? options.subject;
        index += 2;
        break;
      case "--reddit-username":
        options.redditUsername = value ?? options.redditUsername;
        index += 2;
        break;
      case "--issuer":
        options.issuer = value;
        index += 2;
        break;
      case "--audience":
        options.audience = value;
        index += 2;
        break;
      case "--secret":
        options.secret = value;
        index += 2;
        break;
      case "--api-base-url":
        options.apiBaseUrl = value ?? options.apiBaseUrl;
        index += 2;
        break;
      case "-h":
      case "--help":
        usage();
        break;
      default:
        console.error(`unknown argument: ${arg}`);
        usage();
    }
  }

  return options;
}

function requireEnv(name: keyof Env): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`missing env var: ${name}`);
  }

  return value;
}

function envOrDefault(name: keyof Env, fallback: string): string {
  return process.env[name] || fallback;
}

function loadEnv(options: Options): Env {
  const pirateIssuer = process.env.PIRATE_APP_JWT_ISSUER || "pirate-dev-local";
  const pirateAudience = process.env.PIRATE_APP_JWT_AUDIENCE || "pirate-app";
  const generatedKeyPair =
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
  const privateKey = process.env.PIRATE_APP_JWT_PRIVATE_KEY || generatedKeyPair?.privateKey;
  const publicKey = process.env.PIRATE_APP_JWT_PUBLIC_KEY || generatedKeyPair?.publicKey;

  if (!privateKey || !publicKey) {
    throw new Error("failed to construct Pirate app JWT key material");
  }

  return {
    CONTROL_PLANE_DATABASE_URL: requireEnv("CONTROL_PLANE_DATABASE_URL"),
    AUTH_UPSTREAM_JWT_ISSUER: options.issuer ?? envOrDefault("AUTH_UPSTREAM_JWT_ISSUER", "pirate-dev-upstream"),
    AUTH_UPSTREAM_JWT_AUDIENCE: options.audience ?? envOrDefault("AUTH_UPSTREAM_JWT_AUDIENCE", "pirate-api"),
    AUTH_UPSTREAM_JWT_SHARED_SECRET:
      options.secret ?? envOrDefault("AUTH_UPSTREAM_JWT_SHARED_SECRET", "dev-upstream-secret"),
    PIRATE_APP_JWT_ISSUER: pirateIssuer,
    PIRATE_APP_JWT_AUDIENCE: pirateAudience,
    PIRATE_APP_JWT_PUBLIC_KEY: publicKey,
    PIRATE_APP_JWT_PRIVATE_KEY: privateKey,
  };
}

function base64url(input: string): string {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function mintUpstreamJwt(input: {
  issuer: string;
  audience: string;
  subject: string;
  secret: string;
}): string {
  const now = Math.floor(Date.now() / 1000);
  const header = {
    alg: "HS256",
    typ: "JWT",
  };
  const payload = {
    iss: input.issuer,
    aud: input.audience,
    sub: input.subject,
    iat: now,
    nbf: now,
    exp: now + 3600,
  };

  const signingInput = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(payload))}`;
  const signature = createHmac("sha256", input.secret)
    .update(signingInput)
    .digest("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");

  return `${signingInput}.${signature}`;
}

async function expectJson<T>(response: Response, expectedStatus: number, label: string): Promise<T> {
  const body = await response.json();
  if (response.status !== expectedStatus) {
    throw new Error(`${label} failed: expected ${expectedStatus}, got ${response.status}: ${JSON.stringify(body)}`);
  }

  return body as T;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

export async function runRedditOnboardingSmoke(optionsInput: Partial<Options> = {}): Promise<RedditOnboardingSmokeResult> {
  const options: Options = {
    subject: optionsInput.subject ?? "demo-subject-01",
    redditUsername: optionsInput.redditUsername ?? "technohippie",
    issuer: optionsInput.issuer,
    audience: optionsInput.audience,
    secret: optionsInput.secret,
    apiBaseUrl: optionsInput.apiBaseUrl ?? "http://127.0.0.1:8787",
  };
  const env = loadEnv(options);
  const store = createRuntimeStore(env);
  const handler = createFetchHandler({
    env,
    store,
  });

  const upstreamJwt = mintUpstreamJwt({
    issuer: env.AUTH_UPSTREAM_JWT_ISSUER,
    audience: env.AUTH_UPSTREAM_JWT_AUDIENCE,
    subject: options.subject,
    secret: env.AUTH_UPSTREAM_JWT_SHARED_SECRET,
  });

  const exchangeBody = await expectJson<{
    access_token: string;
    onboarding: {
      reddit_verification_status: string;
      reddit_import_status: string;
    };
  }>(
    await handler(
      new Request(`${options.apiBaseUrl}/auth/session/exchange`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          proof: {
            type: "jwt_based_auth",
            jwt: upstreamJwt,
          },
        }),
      }),
    ),
    200,
    "session exchange",
  );

  const accessToken = exchangeBody.access_token;
  assert(accessToken.length > 0, "session exchange returned an empty access token");

  const onboardingStatus = await expectJson<{
    reddit_verification_status: string;
    reddit_import_status: string;
    suggested_community_ids?: string[];
  }>(
    await handler(
      new Request(`${options.apiBaseUrl}/onboarding/status`, {
        headers: {
          authorization: `Bearer ${accessToken}`,
        },
      }),
    ),
    200,
    "get onboarding status",
  );

  assert(
    onboardingStatus.reddit_verification_status === "verified",
    `expected reddit_verification_status=verified, got ${onboardingStatus.reddit_verification_status}`,
  );
  assert(
    onboardingStatus.reddit_import_status === "succeeded",
    `expected reddit_import_status=succeeded, got ${onboardingStatus.reddit_import_status}`,
  );

  const verificationBody = await expectJson<{
    reddit_username: string;
    status: string;
  }>(
    await handler(
      new Request(`${options.apiBaseUrl}/onboarding/reddit-verification`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${accessToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          reddit_username: options.redditUsername,
        }),
      }),
    ),
    200,
    "reddit verification",
  );

  assert(
    verificationBody.reddit_username === options.redditUsername,
    `expected reddit_username=${options.redditUsername}, got ${verificationBody.reddit_username}`,
  );
  assert(verificationBody.status === "verified", `expected verification status=verified, got ${verificationBody.status}`);

  const importBody = await expectJson<{
    job: {
      job_type: string;
      status: string;
    };
  }>(
    await handler(
      new Request(`${options.apiBaseUrl}/onboarding/reddit-imports`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${accessToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          reddit_username: options.redditUsername,
        }),
      }),
    ),
    202,
    "reddit import",
  );

  assert(importBody.job.job_type === "reddit_snapshot_import", `expected reddit_snapshot_import, got ${importBody.job.job_type}`);
  assert(
    importBody.job.status === "queued" || importBody.job.status === "running" || importBody.job.status === "succeeded",
    `expected import job status queued|running|succeeded, got ${importBody.job.status}`,
  );

  if (importBody.job.status !== "succeeded") {
    await runOnePlatformJob({
      env,
      store,
      jobType: "reddit_snapshot_import",
    });
    await runOnePlatformJob({
      env,
      store,
      jobType: "reddit_feature_derivation",
    });
  }

  const latestImportBody = await expectJson<{
    reddit_username: string;
    global_karma: number | null;
    top_subreddits: Array<{ subreddit: string }>;
    suggested_communities: Array<{ community_id: string }>;
  }>(
    await handler(
      new Request(`${options.apiBaseUrl}/onboarding/reddit-imports/latest`, {
        headers: {
          authorization: `Bearer ${accessToken}`,
        },
      }),
    ),
    200,
    "latest reddit import",
  );

  assert(
    latestImportBody.reddit_username === options.redditUsername,
    `expected latest import username=${options.redditUsername}, got ${latestImportBody.reddit_username}`,
  );
  assert(latestImportBody.global_karma != null, "expected latest import global_karma to be present");
  assert(latestImportBody.top_subreddits.length > 0, "expected at least one top subreddit");

  return {
    ok: true,
    subject: options.subject,
    reddit_username: latestImportBody.reddit_username,
    global_karma: latestImportBody.global_karma,
    top_subreddit: latestImportBody.top_subreddits[0]?.subreddit ?? null,
    suggested_community_ids: latestImportBody.suggested_communities.map((entry) => entry.community_id),
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const result = await runRedditOnboardingSmoke(options);
  console.log(JSON.stringify(result, null, 2));
}

if (import.meta.main) {
  await main();
}
