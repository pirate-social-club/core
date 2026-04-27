#!/usr/bin/env bun

type Options = {
  apiUrl: string;
  rootLabel: string;
  communityId: string;
  adminAsUserId: string;
};

type NamespaceSession = {
  namespace_verification_session_id?: string;
  namespace_verification_id?: string | null;
  status?: string;
};

type Community = {
  community_id?: string;
  namespace_verification_id?: string | null;
  route_slug?: string | null;
};

type PublicCommunity = {
  community_id?: string;
  route_slug?: string | null;
};

function usage(exitCode = 1): never {
  console.error(`Usage:
  rtk infisical run --env prod --path /services/api -- \\
    rtk bun scripts/community/attach-prod-community-namespace.ts \\
      --root-label beermoney \\
      --community-id cmt_... \\
      --admin-as-user-id usr_... \\
      [--api-url https://api.pirate.sc]`);
  process.exit(exitCode);
}

function parseArgs(argv: string[]): Options {
  const options: Options = {
    apiUrl: "https://api.pirate.sc",
    rootLabel: "",
    communityId: "",
    adminAsUserId: "",
  };

  for (let index = 0; index < argv.length; ) {
    const arg = argv[index];
    const value = argv[index + 1];
    switch (arg) {
      case "--api-url":
        options.apiUrl = value ?? "";
        index += 2;
        break;
      case "--root-label":
        options.rootLabel = canonicalRootLabel(value ?? "");
        index += 2;
        break;
      case "--community-id":
        options.communityId = value ?? "";
        index += 2;
        break;
      case "--admin-as-user-id":
        options.adminAsUserId = value ?? "";
        index += 2;
        break;
      case "-h":
      case "--help":
        usage(0);
        break;
      default:
        console.error(`unknown argument: ${arg}`);
        usage();
    }
  }

  if (!options.apiUrl || !options.rootLabel || !options.communityId || !options.adminAsUserId) {
    usage();
  }
  if (!options.communityId.startsWith("cmt_")) {
    throw new Error("--community-id must be a cmt_* id");
  }
  if (!options.adminAsUserId.startsWith("usr_")) {
    throw new Error("--admin-as-user-id must be a usr_* id");
  }

  return options;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const adminToken = process.env.PIRATE_ADMIN_TOKEN?.trim();
  if (!adminToken) {
    throw new Error("PIRATE_ADMIN_TOKEN is required in the environment");
  }

  const started = await apiRequest<NamespaceSession>(options, {
    path: "/namespace-verification-sessions",
    method: "POST",
    body: {
      family: "hns",
      root_label: options.rootLabel,
    },
  });
  const sessionId = started.namespace_verification_session_id;
  if (!sessionId) {
    throw new Error("namespace start did not return namespace_verification_session_id");
  }

  const completed = await apiRequest<NamespaceSession>(options, {
    path: `/namespace-verification-sessions/${encodeURIComponent(sessionId)}/complete`,
    method: "POST",
    body: {},
  });
  const namespaceVerificationId = completed.namespace_verification_id;
  if (completed.status !== "verified" || !namespaceVerificationId) {
    throw new Error(`namespace did not verify; status=${completed.status ?? "unknown"}`);
  }

  const attached = await apiRequest<Community>(options, {
    path: `/communities/${encodeURIComponent(options.communityId)}/namespace`,
    method: "POST",
    body: {
      namespace_verification_id: namespaceVerificationId,
    },
  });
  if (attached.namespace_verification_id !== namespaceVerificationId) {
    throw new Error("community attach returned a different namespace_verification_id");
  }

  const publicCommunity = await getPublicCommunity(options);
  if (publicCommunity.community_id !== options.communityId) {
    throw new Error(`public slug did not resolve to ${options.communityId}`);
  }

  console.log(JSON.stringify({
    root_label: options.rootLabel,
    community_id: options.communityId,
    namespace_verification_session_id: sessionId,
    namespace_verification_id: namespaceVerificationId,
    route_slug: attached.route_slug ?? publicCommunity.route_slug ?? options.rootLabel,
    public_slug_verified: true,
  }, null, 2));
}

async function getPublicCommunity(options: Options): Promise<PublicCommunity> {
  let lastStatus = 0;
  let lastBody = "";
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const response = await fetch(`${trimTrailingSlash(options.apiUrl)}/public-communities/${encodeURIComponent(options.rootLabel)}`);
    lastStatus = response.status;
    lastBody = await response.text();
    if (response.ok) {
      return JSON.parse(lastBody) as PublicCommunity;
    }
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }
  throw new Error(`public slug did not verify; last_status=${lastStatus} body=${lastBody.slice(0, 200)}`);
}

async function apiRequest<T>(
  options: Options,
  input: {
    path: string;
    method: "GET" | "POST";
    body?: unknown;
  },
): Promise<T> {
  const response = await fetch(`${trimTrailingSlash(options.apiUrl)}${input.path}`, {
    method: input.method,
    headers: {
      "Content-Type": "application/json",
      "X-Admin-Token": process.env.PIRATE_ADMIN_TOKEN ?? "",
      "X-Admin-As-User-Id": options.adminAsUserId,
    },
    body: input.body === undefined ? undefined : JSON.stringify(input.body),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`API request failed: ${input.method} ${input.path} status=${response.status} body=${text.slice(0, 200)}`);
  }
  return JSON.parse(text) as T;
}

function canonicalRootLabel(value: string): string {
  const label = value.trim().normalize("NFKC").toLowerCase().replace(/^@/, "");
  if (!label || label.includes(".") || !/^[a-z0-9-]+$/.test(label)) {
    throw new Error(`invalid root label: ${value}`);
  }
  return label;
}

function trimTrailingSlash(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
