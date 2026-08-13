import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SCRIPT = "scripts/ci/fetch-infisical-secrets.sh";
const SUB = "repo:pirate-social-club/web:ref:refs/heads/main";
const AUD = "https://github.com/pirate-social-club";
const ACCESS_TOKEN = "infisical-access-token-should-never-be-printed";
const SECRET_VALUE = "hns-verifier-token-should-never-be-printed";

function fakeJwt(): string {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "RS256" })}.${encode({ iss: "https://token.actions.githubusercontent.com", aud: AUD, sub: SUB })}.signature`;
}

type StubOptions = {
  loginStatus: number;
  secretStatus: number;
};

function startStub({ loginStatus, secretStatus }: StubOptions) {
  return Bun.serve({
    port: 0,
    fetch(request) {
      const { pathname } = new URL(request.url);
      if (pathname === "/oidc") {
        return Response.json({ value: fakeJwt() });
      }
      if (pathname === "/api/v1/auth/oidc-auth/login") {
        return loginStatus === 200
          ? Response.json({ accessToken: ACCESS_TOKEN })
          : Response.json({ message: "identity trust policy mismatch" }, { status: loginStatus });
      }
      if (pathname.startsWith("/api/v4/secrets/")) {
        return secretStatus === 200
          ? Response.json({ secret: { secretValue: SECRET_VALUE } })
          : Response.json(
            { message: "permission denied", details: [{ conditions: { environment: "staging" } }] },
            { status: secretStatus },
          );
      }
      return new Response("not found", { status: 404 });
    },
  });
}

let workdir: string | null = null;

afterEach(() => {
  if (workdir) rmSync(workdir, { force: true, recursive: true });
  workdir = null;
});

async function run(options: StubOptions) {
  const server = startStub(options);
  workdir = mkdtempSync(join(tmpdir(), "infisical-fetch-"));
  const githubEnv = join(workdir, "github.env");
  await Bun.write(githubEnv, "");
  try {
    const proc = Bun.spawn(["bash", SCRIPT], {
      env: {
        ...process.env,
        ACTIONS_ID_TOKEN_REQUEST_TOKEN: "github-request-token",
        ACTIONS_ID_TOKEN_REQUEST_URL: `http://localhost:${server.port}/oidc?x=1`,
        GITHUB_ENV: githubEnv,
        INFISICAL_API_BASE_URL: `http://localhost:${server.port}`,
        INFISICAL_IDENTITY_ID: "identity-under-test",
        INFISICAL_PROJECT_ID: "project-under-test",
        INFISICAL_ENV: "prod",
        INFISICAL_SECRET_PATH: "/services/api",
        SECRET_NAMES: "HNS_VERIFIER_AUTH_TOKEN",
      },
      stderr: "pipe",
      stdout: "pipe",
    });
    const [stderr, stdout, exitCode] = await Promise.all([
      new Response(proc.stderr).text(),
      new Response(proc.stdout).text(),
      proc.exited,
    ]);
    return { exitCode, githubEnv: readFileSync(githubEnv, "utf8"), stderr, stdout };
  } finally {
    server.stop(true);
  }
}

describe("fetch-infisical-secrets failure classification", () => {
  test("names the OIDC login stage and echoes the presented claims", async () => {
    const result = await run({ loginStatus: 403, secretStatus: 200 });

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("OIDC AUTHENTICATION failed (HTTP 403)");
    expect(result.stderr).toContain("/auth/oidc-auth/login");
    expect(result.stderr).toContain("NOT a project-permission problem");
    // The whole point: the operator can compare the presented sub against Infisical.
    expect(result.stderr).toContain(`sub=${SUB}`);
    expect(result.stderr).toContain(`aud=${AUD}`);
    expect(result.stderr).not.toContain("SECRET READ failed");
  });

  test("names the secret-read stage separately and never blames authentication", async () => {
    const result = await run({ loginStatus: 200, secretStatus: 403 });

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("SECRET READ failed (HTTP 403)");
    expect(result.stderr).toContain("HNS_VERIFIER_AUTH_TOKEN");
    expect(result.stderr).toContain("env=prod path=/services/api");
    expect(result.stderr).toContain("describeSecret AND readValue");
    expect(result.stderr).not.toContain("OIDC AUTHENTICATION failed");
    // Infisical's 403 body lists the rules the identity actually has.
    expect(result.stderr).toContain("permission denied");
  });

  test("never prints the OIDC token or the Infisical access token", async () => {
    for (const options of [
      { loginStatus: 403, secretStatus: 200 },
      { loginStatus: 200, secretStatus: 403 },
    ]) {
      const result = await run(options);
      const output = `${result.stderr}\n${result.stdout}`;
      expect(output).not.toContain(ACCESS_TOKEN);
      expect(output).not.toContain(".signature");
    }
  });

  test("still exports and masks the secret on the success path", async () => {
    const result = await run({ loginStatus: 200, secretStatus: 200 });

    expect(result.exitCode).toBe(0);
    expect(result.githubEnv.trim()).toBe(`HNS_VERIFIER_AUTH_TOKEN=${SECRET_VALUE}`);
    expect(result.stdout).toContain(`::add-mask::${SECRET_VALUE}`);
  });
});
