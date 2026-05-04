#!/usr/bin/env bun

import { $ } from "bun";
import { createHmac, randomUUID } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

type OwnerConfig = {
  subject: string;
  issuer?: string;
  audience?: string;
};

type DefaultsConfig = {
  database_region?: string;
  publisher_ssh?: string;
  publisher_bin?: string;
  wallet_export?: string;
  max_index?: number;
};

type CommunityInput = {
  root: string;
  display_name: string;
  country_code: string;
  description?: string;
  seed_folder?: string;
};

type InputFile = {
  owner: OwnerConfig;
  defaults?: DefaultsConfig;
  communities: CommunityInput[];
};

type CommunityState = {
  root: string;
  display_name: string;
  country_code: string;
  root_label: string;
  namespace_verification_session_id: string | null;
  namespace_verification_id: string | null;
  community_id: string | null;
  route_slug: string | null;
  status: "pending" | "namespace_started" | "namespace_published" | "namespace_verified" | "community_created" | "failed";
  error: string | null;
};

type StateFile = Record<string, CommunityState>;

type SessionExchangeResponse = {
  access_token?: string;
  user?: { id?: string; user_id?: string };
};

type PublicProfileResolution = {
  profile?: {
    id?: string;
  };
};

type NamespaceSession = {
  id?: string;
  namespace_verification_session_id?: string;
  namespace_verification?: string | null;
  namespace_verification_id?: string | null;
  status?: string;
  challenge_payload?: {
    txt_key?: string;
    txt_value?: string;
    web_url?: string;
    freedom_url?: string;
  } | null;
  failure_reason?: string | null;
};

type CommunityCreateResponse = {
  community?: {
    id?: string;
    community_id?: string;
    display_name?: string;
    route_slug?: string | null;
    namespace_verification?: string | null;
    namespace_verification_id?: string | null;
    provisioning_state?: string;
    status?: string;
  };
  job?: {
    job_id?: string;
    status?: string;
    error_code?: string | null;
  };
};

function namespaceSessionId(session: NamespaceSession): string | null {
  return (session.namespace_verification_session_id ?? session.id)?.trim() ?? null;
}

function namespaceVerificationIdFromSession(session: NamespaceSession): string | null {
  const value = (session.namespace_verification_id ?? session.namespace_verification)?.trim();
  if (!value) return null;
  return value.startsWith("nv_nv_") ? value.slice("nv_".length) : value;
}

function publicNamespaceVerificationId(value: string): string {
  const trimmed = value.trim();
  return `nv_${trimmed}`;
}

function communityId(response: CommunityCreateResponse): string | null {
  return (response.community?.community_id ?? response.community?.id)?.trim().replace(/^com_/u, "").replace(/^cmt_/u, "") ?? null;
}

function usage(exitCode = 1): never {
  console.error(`Usage:
  rtk infisical run --env prod --path /services/api -- \\
    rtk bun scripts/community/batch-create-prod-spaces-communities.ts \\
      --input spaces-communities.json \\
      [--state spaces-communities-state.json] \\
      [--dry-run] [--limit N] [--only-root @xn--t77hga] \\
      [--api-url https://api.pirate.sc]

Environment:
  AUTH_UPSTREAM_JWT_SHARED_SECRET  Required.
  CONTROL_PLANE_DATABASE_URL       Required.

Flags:
  --input PATH        JSON input file with owner config and communities array.
  --state PATH        JSON state file for resumable progress. Defaults next to input.
  --dry-run           Validate input and show plan without making API calls.
  --limit N           Process at most N pending communities.
  --only-root ROOT    Process only the community with this root label (e.g. xn--t77hga).
  --api-url URL       Default: https://api.pirate.sc
  --wallet-export PATH
                     Local Spaces wallet export path. The wallet export stays
                     on this machine and is not copied to the verifier VPS.
                     Can also be set with PIRATE_SPACES_WALLET_EXPORT.
  --owner-wallet-address ADDRESS
                     Optional EVM wallet address to attach to the launch owner.
                     Can also be set with PIRATE_LAUNCH_OWNER_WALLET_ADDRESS.
  -h, --help          Show this help text.`);
  process.exit(exitCode);
}

type Options = {
  apiUrl: string;
  inputPath: string;
  statePath: string;
  dryRun: boolean;
  limit: number | null;
  onlyRoot: string | null;
  walletExport: string | null;
  ownerWalletAddress: string | null;
};

function parseArgs(argv: string[]): Options {
  const options: Options = {
    apiUrl: "https://api.pirate.sc",
    inputPath: "",
    statePath: "",
    dryRun: false,
    limit: null,
    onlyRoot: null,
    walletExport: null,
    ownerWalletAddress: null,
  };

  for (let index = 0; index < argv.length; ) {
    const arg = argv[index];
    const value = argv[index + 1] ?? "";
    switch (arg) {
      case "--api-url":
        options.apiUrl = value.trim() || options.apiUrl;
        index += 2;
        break;
      case "--input":
        options.inputPath = resolve(value);
        index += 2;
        break;
      case "--state":
        options.statePath = resolve(value);
        index += 2;
        break;
      case "--dry-run":
        options.dryRun = true;
        index += 1;
        break;
      case "--limit":
        options.limit = parseInt(value, 10);
        if (!Number.isFinite(options.limit) || options.limit < 1) {
          throw new Error("--limit must be a positive integer");
        }
        index += 2;
        break;
      case "--only-root":
        options.onlyRoot = value.trim();
        index += 2;
        break;
      case "--wallet-export":
        options.walletExport = value.trim() || null;
        index += 2;
        break;
      case "--owner-wallet-address":
        options.ownerWalletAddress = value.trim() || null;
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

  if (!options.inputPath) {
    console.error("--input is required");
    usage();
  }
  return options;
}

function canonicalSpacesRoot(value: string): string {
  const label = value.trim().normalize("NFKC").toLowerCase().replace(/^@/u, "");
  if (!label || label.includes(".")) {
    throw new Error(`invalid Spaces root label: ${value}`);
  }
  const hostname = new URL(`http://${label}.invalid`).hostname;
  const canonical = hostname.slice(0, -".invalid".length);
  if (!canonical || canonical.includes(".")) {
    throw new Error(`invalid Spaces root label: ${value}`);
  }
  return canonical;
}

function normalizeCountryCode(code: string): string {
  const upper = code.trim().toUpperCase();
  if (/^[A-Z]{2}$/.test(upper)) {
    const iso3 = ISO3_BY_ISO2.get(upper);
    if (iso3) return iso3;
    throw new Error(`unknown ISO-3166 alpha-2 country code: ${code}`);
  }
  if (/^[A-Z]{3}$/.test(upper) && ISO3_CODES.has(upper)) {
    return upper;
  }
  throw new Error(`invalid ISO-3166 country code: ${code} (use alpha-2 or alpha-3)`);
}

const ISO_COUNTRY_CODE_PAIRS =
  "AF:AFG,AL:ALB,DZ:DZA,AS:ASM,AD:AND,AO:AGO,AI:AIA,AQ:ATA,AG:ATG,AR:ARG,AM:ARM,AW:ABW,AU:AUS,AT:AUT,AZ:AZE,BS:BHS,BH:BHR,BD:BGD,BB:BRB,BY:BLR,BE:BEL,BZ:BLZ,BJ:BEN,BM:BMU,BT:BTN,BO:BOL,BA:BIH,BW:BWA,BV:BVT,BR:BRA,IO:IOT,BN:BRN,BG:BGR,BF:BFA,BI:BDI,KH:KHM,CM:CMR,CA:CAN,CV:CPV,KY:CYM,CF:CAF,TD:TCD,CL:CHL,CN:CHN,CX:CXR,CC:CCK,CO:COL,KM:COM,CG:COG,CD:COD,CK:COK,CR:CRI,CI:CIV,HR:HRV,CU:CUB,CY:CYP,CZ:CZE,DK:DNK,DJ:DJI,DM:DMA,DO:DOM,EC:ECU,EG:EGY,SV:SLV,GQ:GNQ,ER:ERI,EE:EST,ET:ETH,FK:FLK,FO:FRO,FJ:FJI,FI:FIN,FR:FRA,GF:GUF,PF:PYF,TF:ATF,GA:GAB,GM:GMB,GE:GEO,DE:DEU,GH:GHA,GI:GIB,GR:GRC,GL:GRL,GD:GRD,GP:GLP,GU:GUM,GT:GTM,GN:GIN,GW:GNB,GY:GUY,HT:HTI,HM:HMD,VA:VAT,HN:HND,HK:HKG,HU:HUN,IS:ISL,IN:IND,ID:IDN,IR:IRN,IQ:IRQ,IE:IRL,IL:ISR,IT:ITA,JM:JAM,JP:JPN,JO:JOR,KZ:KAZ,KE:KEN,KI:KIR,KP:PRK,KR:KOR,KW:KWT,KG:KGZ,LA:LAO,LV:LVA,LB:LBN,LS:LSO,LR:LBR,LY:LBY,LI:LIE,LT:LTU,LU:LUX,MO:MAC,MG:MDG,MW:MWI,MY:MYS,MV:MDV,ML:MLI,MT:MLT,MH:MHL,MQ:MTQ,MR:MRT,MU:MUS,YT:MYT,MX:MEX,FM:FSM,MD:MDA,MC:MCO,MN:MNG,MS:MSR,MA:MAR,MZ:MOZ,MM:MMR,NA:NAM,NR:NRU,NP:NPL,NL:NLD,NC:NCL,NZ:NZL,NI:NIC,NE:NER,NG:NGA,NU:NIU,NF:NFK,MP:MNP,MK:MKD,NO:NOR,OM:OMN,PK:PAK,PW:PLW,PS:PSE,PA:PAN,PG:PNG,PY:PRY,PE:PER,PH:PHL,PN:PCN,PL:POL,PT:PRT,PR:PRI,QA:QAT,RE:REU,RO:ROU,RU:RUS,RW:RWA,SH:SHN,KN:KNA,LC:LCA,PM:SPM,VC:VCT,WS:WSM,SM:SMR,ST:STP,SA:SAU,SN:SEN,SC:SYC,SL:SLE,SG:SGP,SK:SVK,SI:SVN,SB:SLB,SO:SOM,ZA:ZAF,GS:SGS,ES:ESP,LK:LKA,SD:SDN,SR:SUR,SJ:SJM,SZ:SWZ,SE:SWE,CH:CHE,SY:SYR,TW:TWN,TJ:TJK,TZ:TZA,TH:THA,TL:TLS,TG:TGO,TK:TKL,TO:TON,TT:TTO,TN:TUN,TR:TUR,TM:TKM,TC:TCA,TV:TUV,UG:UGA,UA:UKR,AE:ARE,GB:GBR,US:USA,UM:UMI,UY:URY,UZ:UZB,VU:VUT,VE:VEN,VN:VNM,VG:VGB,VI:VIR,WF:WLF,EH:ESH,YE:YEM,ZM:ZMB,ZW:ZWE,AX:ALA,BQ:BES,CW:CUW,GG:GGY,IM:IMN,JE:JEY,ME:MNE,BL:BLM,MF:MAF,RS:SRB,SX:SXM,SS:SSD,XK:XKK";

const COUNTRY_CODE_PAIRS = ISO_COUNTRY_CODE_PAIRS.split(",").map((pair) => pair.split(":") as [string, string]);
const ISO3_BY_ISO2 = new Map(COUNTRY_CODE_PAIRS);
const ISO3_CODES = new Set(COUNTRY_CODE_PAIRS.map(([, alpha3]) => alpha3));

function requireEnv(name: string): string {
  const value = String(process.env[name] ?? "").trim();
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

function makeId(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, "")}`;
}

function base64UrlJson(value: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function signHs256Jwt(input: {
  issuer: string;
  audience: string;
  subject: string;
  sharedSecret: string;
  ownerWalletAddress: string | null;
}): string {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const header = base64UrlJson({ alg: "HS256", typ: "JWT" });
  const payload = base64UrlJson({
    iss: input.issuer,
    aud: input.audience,
    sub: input.subject,
    iat: nowSeconds,
    exp: nowSeconds + 600,
    ...(input.ownerWalletAddress
      ? {
          wallet_address: input.ownerWalletAddress,
          selected_wallet_address: input.ownerWalletAddress,
        }
      : {}),
  });
  const signingInput = `${header}.${payload}`;
  const signature = createHmac("sha256", input.sharedSecret)
    .update(signingInput)
    .digest("base64url");
  return `${signingInput}.${signature}`;
}

async function apiRequest<T>(input: {
  apiUrl: string;
  path: string;
  method: "GET" | "POST";
  accessToken?: string;
  adminToken?: string | null;
  adminAsUserId?: string | null;
  body?: unknown;
}): Promise<T> {
  const response = await fetch(`${input.apiUrl.replace(/\/+$/u, "")}${input.path}`, {
    method: input.method,
    headers: {
      "Content-Type": "application/json",
      ...(input.accessToken ? { Authorization: `Bearer ${input.accessToken}` } : {}),
      ...(input.adminToken ? { "X-Admin-Token": input.adminToken } : {}),
      ...(input.adminAsUserId ? { "X-Admin-As-User-Id": input.adminAsUserId } : {}),
    },
    body: input.body === undefined ? undefined : JSON.stringify(input.body),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`API request failed: ${input.method} ${input.path} status=${response.status} body=${text.slice(0, 500)}`);
  }
  return JSON.parse(text) as T;
}

async function publicApiRequest<T>(input: {
  apiUrl: string;
  path: string;
}): Promise<T> {
  const response = await fetch(`${input.apiUrl.replace(/\/+$/u, "")}${input.path}`);
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`API request failed: GET ${input.path} status=${response.status} body=${text.slice(0, 500)}`);
  }
  return JSON.parse(text) as T;
}

async function resolveOwnerUserByWallet(input: {
  apiUrl: string;
  adminToken: string;
  walletAddress: string;
}): Promise<{ userId: string; accessToken: null; adminToken: string; adminAsUserId: string }> {
  const resolved = await publicApiRequest<PublicProfileResolution>({
    apiUrl: input.apiUrl,
    path: `/public-profiles/by-wallet/${encodeURIComponent(input.walletAddress)}`,
  });
  const publicUserId = resolved.profile?.id?.trim();
  const userId = publicUserId?.replace(/^usr_/u, "") ?? "";
  if (!userId) {
    throw new Error(`cold wallet did not resolve to a Pirate user: ${input.walletAddress}`);
  }
  return {
    userId,
    accessToken: null,
    adminToken: input.adminToken,
    adminAsUserId: userId,
  };
}

async function exchangeLaunchOwner(options: {
  apiUrl: string;
  issuer: string;
  audience: string;
  subject: string;
  ownerWalletAddress: string | null;
}): Promise<{ userId: string; accessToken: string }> {
  const sharedSecret = requireEnv("AUTH_UPSTREAM_JWT_SHARED_SECRET");
  const jwt = signHs256Jwt({
    issuer: options.issuer,
    audience: options.audience,
    subject: options.subject,
    sharedSecret,
    ownerWalletAddress: options.ownerWalletAddress,
  });

  const response = await apiRequest<SessionExchangeResponse>({
    apiUrl: options.apiUrl,
    path: "/auth/session/exchange",
    method: "POST",
    body: {
      proof: {
        type: "jwt_based_auth",
        jwt,
      },
    },
  });
  const userId = (response.user?.user_id ?? response.user?.id)?.trim().replace(/^usr_/u, "");
  const accessToken = response.access_token?.trim();
  if (!userId || !accessToken) {
    throw new Error(
      "session exchange did not return user id and access token"
        + `; response_keys=${Object.keys(response as Record<string, unknown>).join(",") || "none"}`
        + ` user_keys=${response.user ? Object.keys(response.user).join(",") : "none"}`,
    );
  }
  return { userId, accessToken };
}

type OwnerAuth = {
  userId: string;
  accessToken: string | null;
  adminToken: string | null;
  adminAsUserId: string | null;
};

function authForRequest(auth: OwnerAuth): {
  accessToken?: string;
  adminToken?: string | null;
  adminAsUserId?: string | null;
} {
  return auth.accessToken
    ? { accessToken: auth.accessToken }
    : { adminToken: auth.adminToken, adminAsUserId: auth.adminAsUserId };
}

async function markLaunchOwnerVerified(input: {
  db: Bun.SQL;
  userId: string;
  subject: string;
}): Promise<{ verificationSessionId: string | null; attestationId: string | null; auditEventId: string | null; reused: boolean }> {
  const now = new Date().toISOString();
  const verificationSessionId = makeId("vs");
  const attestationId = makeId("uat");
  const auditEventId = makeId("aud");
  const capabilities = buildDefaultCapabilities(now);

  const existingRows = await input.db<{
    verification_state: string;
    verification_capabilities_json: unknown;
    current_verification_session_id: string | null;
  }[]>`
    SELECT verification_state, verification_capabilities_json, current_verification_session_id
    FROM users
    WHERE user_id = ${input.userId}
    LIMIT 1
  `;
  const existing = existingRows[0];
  if (!existing) {
    throw new Error(`launch owner user does not exist: ${input.userId}`);
  }
  const existingCaps = typeof existing.verification_capabilities_json === "string"
    ? JSON.parse(existing.verification_capabilities_json) as { unique_human?: { state?: string } }
    : existing.verification_capabilities_json as { unique_human?: { state?: string } };
  if (existing.verification_state === "verified" && existingCaps?.unique_human?.state === "verified") {
    return {
      verificationSessionId: existing.current_verification_session_id,
      attestationId: null,
      auditEventId: null,
      reused: true,
    };
  }

  await input.db.begin(async (tx) => {
    await tx`
      INSERT INTO verification_sessions (
        verification_session_id, user_id, provider, session_kind, requested_capabilities_json,
        verification_requirements_json, status, upstream_session_ref, result_ref, failure_code,
        wallet_attachment_id, verification_intent, policy_id, started_at, completed_at, expires_at,
        created_at, updated_at
      ) VALUES (
        ${verificationSessionId}, ${input.userId}, 'self', 'prod_launch_bootstrap',
        ${JSON.stringify(["unique_human"])}, ${JSON.stringify([])}, 'verified',
        ${`prod-launch:${input.subject}`}, ${JSON.stringify({ reason: "initial_prod_space_launch" })},
        NULL, NULL, 'community_launch', NULL, ${now}, ${now}, NULL, ${now}, ${now}
      )
      ON CONFLICT (verification_session_id) DO NOTHING
    `;

    await tx`
      INSERT INTO user_attestations (
        user_attestation_id, user_id, source_verification_session_id, provider, attestation_type,
        capability_key, status, value_json, verified_at, expires_at, revoked_at, created_at, updated_at
      ) VALUES (
        ${attestationId}, ${input.userId}, ${verificationSessionId}, 'self', 'unique_human',
        'unique_human', 'accepted', ${JSON.stringify({ mechanism: "prod_launch_bootstrap" })},
        ${now}, NULL, NULL, ${now}, ${now}
      )
      ON CONFLICT (user_attestation_id) DO NOTHING
    `;

    await tx`
      UPDATE users
      SET verification_state = 'verified',
          capability_provider = 'self',
          verification_capabilities_json = ${JSON.stringify(capabilities)},
          verified_at = ${now},
          current_verification_session_id = ${verificationSessionId},
          updated_at = ${now}
      WHERE user_id = ${input.userId}
    `;

    await tx`
      INSERT INTO audit_log (
        audit_event_id, actor_type, actor_id, action, target_type, target_id,
        community_id, metadata_json, created_at
      ) VALUES (
        ${auditEventId}, 'operator', 'prod-launch-script', 'user.unique_human_bootstrap',
        'user', ${input.userId}, NULL,
        ${JSON.stringify({ subject: input.subject, verification_session_id: verificationSessionId })},
        ${now}
      )
    `;
  });

  return { verificationSessionId, attestationId, auditEventId, reused: false };
}

function buildDefaultCapabilities(now: string) {
  return {
    unique_human: {
      state: "verified",
      provider: "self",
      proof_type: "unique_human",
      mechanism: "prod_launch_bootstrap",
      verified_at: now,
    },
    age_over_18: { state: "unverified", provider: null, proof_type: null, mechanism: null, verified_at: null },
    minimum_age: { state: "unverified", value: null, provider: null, proof_type: null, mechanism: null, verified_at: null },
    nationality: { state: "unverified", value: null, provider: null, proof_type: null, mechanism: null, verified_at: null },
    gender: { state: "unverified", value: null, provider: null, proof_type: null, mechanism: null, verified_at: null },
    wallet_score: {
      state: "unverified",
      provider: null,
      proof_type: null,
      mechanism: null,
      verified_at: null,
      score: null,
      score_threshold: null,
      passing_score: null,
      last_score_timestamp: null,
      expiration_timestamp: null,
      stamps: null,
    },
  };
}

async function findVerifiedNamespace(input: {
  db: Bun.SQL;
  userId: string;
  rootLabel: string;
}): Promise<string | null> {
  const rows = await input.db<{ namespace_verification_id: string }[]>`
    SELECT namespace_verification_id
    FROM namespace_verifications
    WHERE user_id = ${input.userId}
      AND family = 'spaces'
      AND normalized_root_label = ${input.rootLabel}
      AND status = 'verified'
    ORDER BY accepted_at DESC
    LIMIT 1
  `;
  return rows[0]?.namespace_verification_id ?? null;
}

async function findReusableNamespaceSession(input: {
  db: Bun.SQL;
  userId: string;
  rootLabel: string;
}): Promise<NamespaceSession | null> {
  const rows = await input.db<{
    namespace_verification_session_id: string;
    namespace_verification_id: string | null;
    status: string;
    normalized_root_label: string | null;
    challenge_payload_json: unknown;
    failure_reason: string | null;
  }[]>`
    SELECT
      namespace_verification_session_id,
      namespace_verification_id,
      status,
      normalized_root_label,
      challenge_payload_json,
      failure_reason
    FROM namespace_verification_sessions
    WHERE user_id = ${input.userId}
      AND family = 'spaces'
      AND normalized_root_label = ${input.rootLabel}
      AND status IN ('challenge_required', 'challenge_pending')
    ORDER BY created_at DESC
    LIMIT 1
  `;
  const row = rows[0];
  if (!row) {
    return null;
  }
  return {
    namespace_verification_session_id: row.namespace_verification_session_id,
    namespace_verification_id: row.namespace_verification_id,
    status: row.status,
    normalized_root_label: row.normalized_root_label,
    challenge_payload: typeof row.challenge_payload_json === "string"
      ? JSON.parse(row.challenge_payload_json)
      : row.challenge_payload_json as NamespaceSession["challenge_payload"],
    failure_reason: row.failure_reason,
  };
}

async function publishSpacesChallenge(
  publisherSsh: string,
  publisherBin: string,
  walletExport: string,
  rootLabel: string,
  session: NamespaceSession,
  maxIndex: number,
): Promise<void> {
  const payload = session.challenge_payload;
  const txtKey = payload?.txt_key?.trim();
  const txtValue = payload?.txt_value?.trim();
  const webUrl = payload?.web_url?.trim();
  const freedomUrl = payload?.freedom_url?.trim();
  if (!txtKey || !txtValue || !webUrl || !freedomUrl) {
    throw new Error("namespace session did not return a complete Spaces publish challenge");
  }

  if (publisherSsh.trim()) {
    throw new Error("Refusing to use --publisher-ssh with a wallet export. Keep wallet exports local and run the local spaces-publisher.");
  }

  await $`${publisherBin} publish ${`@${rootLabel}`} --wallet-export ${walletExport} --web ${webUrl} --freedom ${freedomUrl} --txt ${`${txtKey}=${txtValue}`} --max-index ${String(maxIndex)}`;
}

async function completeNamespaceWithRetry(options: {
  apiUrl: string;
  accessToken?: string;
  adminToken?: string | null;
  adminAsUserId?: string | null;
  sessionId: string;
}): Promise<NamespaceSession> {
  let last: NamespaceSession | null = null;
  for (let attempt = 1; attempt <= 8; attempt += 1) {
    last = await apiRequest<NamespaceSession>({
      apiUrl: options.apiUrl,
      path: `/namespace-verification-sessions/${encodeURIComponent(options.sessionId)}/complete`,
      method: "POST",
      accessToken: options.accessToken,
      adminToken: options.adminToken,
      adminAsUserId: options.adminAsUserId,
      body: {},
    });
    if (last.status === "verified" && namespaceVerificationIdFromSession(last)) {
      return last;
    }
    if (last.status === "failed" || last.status === "expired") {
      break;
    }
    await Bun.sleep(4000);
  }
  throw new Error(`namespace verification did not complete; status=${last?.status ?? "unknown"} failure=${last?.failure_reason ?? "none"}`);
}

function buildNationalityGatePolicy(countryCode: string): Record<string, unknown> {
  return {
    version: 1,
    expression: {
      op: "gate",
      gate: {
        type: "nationality",
        provider: "self",
        allowed: [countryCode],
      },
    },
  };
}

function normalizeEvmAddress(value: string | null | undefined): string | null {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) return null;
  if (!/^0x[a-fA-F0-9]{40}$/u.test(trimmed)) {
    throw new Error("--owner-wallet-address/PIRATE_LAUNCH_OWNER_WALLET_ADDRESS must be an EVM address");
  }
  return trimmed.toLowerCase();
}

function loadState(path: string): StateFile {
  if (!existsSync(path)) {
    return {};
  }
  const raw = readFileSync(path, "utf8");
  return JSON.parse(raw) as StateFile;
}

function saveState(path: string, state: StateFile): void {
  writeFileSync(path, JSON.stringify(state, null, 2) + "\n");
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const inputRaw = readFileSync(options.inputPath, "utf8");
  const input: InputFile = JSON.parse(inputRaw);

  const issuer = input.owner.issuer ?? "pirate-production-upstream";
  const audience = input.owner.audience ?? "api-core";
  const databaseRegion = input.defaults?.database_region ?? "aws-us-east-1";
  const publisherSsh = input.defaults?.publisher_ssh ?? "";
  const publisherBin = input.defaults?.publisher_bin ?? "./tools/spaces-publisher/spaces-publisher";
  const walletExport = options.walletExport
    ?? process.env.PIRATE_SPACES_WALLET_EXPORT?.trim()
    ?? input.defaults?.wallet_export?.trim()
    ?? "";
  const maxIndex = input.defaults?.max_index ?? 10000;
  const ownerWalletAddress = normalizeEvmAddress(
    options.ownerWalletAddress ?? process.env.PIRATE_LAUNCH_OWNER_WALLET_ADDRESS,
  );

  const adminToken = process.env.PIRATE_ADMIN_TOKEN?.trim() || null;
  if (!options.dryRun && !walletExport) {
    throw new Error("--wallet-export or PIRATE_SPACES_WALLET_EXPORT is required for non-dry-run execution");
  }
  if (!options.dryRun && ownerWalletAddress && !adminToken) {
    throw new Error("PIRATE_ADMIN_TOKEN is required when --owner-wallet-address/PIRATE_LAUNCH_OWNER_WALLET_ADDRESS is set");
  }

  const statePath = options.statePath || resolve(options.inputPath, "..", "spaces-communities-state.json");
  const state = loadState(statePath);

  const communities: Array<CommunityInput & { root_label: string; country_code_iso3: string }> = [];
  for (const entry of input.communities) {
    const rootLabel = canonicalSpacesRoot(entry.root);
    const countryCodeIso3 = normalizeCountryCode(entry.country_code);
    communities.push({ ...entry, root_label: rootLabel, country_code_iso3: countryCodeIso3 });
  }

  if (options.onlyRoot) {
    const normalizedOnlyRoot = canonicalSpacesRoot(options.onlyRoot);
    const match = communities.find((c) => c.root_label === normalizedOnlyRoot);
    if (!match) {
      throw new Error(`--only-root ${options.onlyRoot} not found in input communities`);
    }
    process.stdout.write(`[filter] only processing root: @${normalizedOnlyRoot}\n`);
  }

  if (options.dryRun) {
    process.stdout.write("\n=== DRY RUN ===\n\n");
    let pendingCount = 0;
    let completedCount = 0;
    let skippedCount = 0;
    for (const c of communities) {
      const existing = state[c.root_label];
      if (options.onlyRoot && c.root_label !== canonicalSpacesRoot(options.onlyRoot)) {
        continue;
      }
      if (existing?.status === "community_created") {
        process.stdout.write(`  @${c.root_label} [${c.country_code_iso3}] "${c.display_name}" -> SKIP (already created: ${existing.community_id})\n`);
        completedCount += 1;
      } else if (existing?.status === "failed") {
        process.stdout.write(`  @${c.root_label} [${c.country_code_iso3}] "${c.display_name}" -> RETRY (previous failure: ${existing.error})\n`);
        pendingCount += 1;
      } else if (existing) {
        process.stdout.write(`  @${c.root_label} [${c.country_code_iso3}] "${c.display_name}" -> RESUME (status: ${existing.status})\n`);
        pendingCount += 1;
      } else {
        process.stdout.write(`  @${c.root_label} [${c.country_code_iso3}] "${c.display_name}" -> CREATE (new)\n`);
        pendingCount += 1;
      }
    }
    process.stdout.write(`\n  Total: ${communities.length} | Completed: ${completedCount} | Pending/Retry: ${pendingCount}\n`);
    if (options.limit) {
      process.stdout.write(`  --limit ${options.limit}: will process at most ${options.limit} communities\n`);
    }
    process.stdout.write("\nNo API calls made.\n");
    process.exit(0);
  }

  const databaseUrl = requireEnv("CONTROL_PLANE_DATABASE_URL");
  const db = new Bun.SQL(databaseUrl);

  try {
    process.stdout.write("[1/5] resolving launch owner...\n");
    const owner: OwnerAuth = ownerWalletAddress && adminToken
      ? await resolveOwnerUserByWallet({
          apiUrl: options.apiUrl,
          adminToken,
          walletAddress: ownerWalletAddress,
        })
      : await exchangeLaunchOwner({
          apiUrl: options.apiUrl,
          issuer,
          audience,
          subject: input.owner.subject,
          ownerWalletAddress,
        }).then((session) => ({
          userId: session.userId,
          accessToken: session.accessToken,
          adminToken: null,
          adminAsUserId: null,
        }));
    process.stdout.write(`  user_id: ${owner.userId}${ownerWalletAddress ? " (resolved from owner wallet)" : ""}\n`);

    if (owner.accessToken) {
      process.stdout.write("[2/5] bootstrapping launch owner unique_human verification...\n");
      const bootstrap = await markLaunchOwnerVerified({
        db,
        userId: owner.userId,
        subject: input.owner.subject,
      });
      process.stdout.write(`  bootstrap: ${bootstrap.reused ? "reused" : "created"}\n`);
    } else {
      process.stdout.write("[2/5] using existing owner wallet user via admin impersonation; skipping launch-owner bootstrap.\n");
    }

    let processed = 0;
    for (const c of communities) {
      if (options.limit !== null && processed >= options.limit) {
        process.stdout.write(`\n--limit ${options.limit} reached; stopping.\n`);
        break;
      }
      if (options.onlyRoot && c.root_label !== canonicalSpacesRoot(options.onlyRoot)) {
        continue;
      }

      const existing = state[c.root_label];

      if (existing?.status === "community_created") {
        process.stdout.write(`\n[@${c.root_label}] already created (${existing.community_id}); skipping.\n`);
        continue;
      }

      process.stdout.write(`\n[@${c.root_label}] "${c.display_name}" (${c.country_code_iso3})\n`);

      try {
        let namespaceVerificationId: string | null = existing?.namespace_verification_id ?? null;
        let namespaceVerificationSessionId: string | null = existing?.namespace_verification_session_id ?? null;
        let namespaceSessionForPublish: NamespaceSession | null = null;

        if (!namespaceVerificationId) {
          const verifiedId = !namespaceVerificationSessionId
            ? await findVerifiedNamespace({ db, userId: owner.userId, rootLabel: c.root_label })
            : null;
          if (verifiedId) {
            namespaceVerificationId = verifiedId;
            process.stdout.write(`  [namespace] found existing verified: ${verifiedId}\n`);
          }
        }

        if (!namespaceVerificationId && !namespaceVerificationSessionId) {
          process.stdout.write("  [namespace] starting session...\n");
          const started = await apiRequest<NamespaceSession>({
            apiUrl: options.apiUrl,
            path: "/namespace-verification-sessions",
            method: "POST",
            ...authForRequest(owner),
            body: {
              family: "spaces",
              root_label: c.root_label,
            },
          });
          namespaceVerificationSessionId = namespaceSessionId(started);
          if (!namespaceVerificationSessionId) {
            throw new Error("namespace start did not return namespace_verification_session_id");
          }
          namespaceSessionForPublish = started;
          process.stdout.write(`  [namespace] session: ${namespaceVerificationSessionId}\n`);

          state[c.root_label] = {
            root: c.root,
            display_name: c.display_name,
            country_code: c.country_code,
            root_label: c.root_label,
            namespace_verification_session_id: namespaceVerificationSessionId,
            namespace_verification_id: null,
            community_id: null,
            route_slug: null,
            status: "namespace_started",
            error: null,
          };
          saveState(statePath, state);
        }

        if (!namespaceVerificationId) {
          let session: NamespaceSession | null = namespaceSessionForPublish;

          if (!session && namespaceVerificationSessionId && existing?.status === "namespace_started") {
            process.stdout.write("  [namespace] resuming from started session, fetching challenge...\n");
            const resumed = await findReusableNamespaceSession({ db, userId: owner.userId, rootLabel: c.root_label });
            if (resumed) {
              session = resumed;
            } else {
              process.stdout.write("  [namespace] no reusable session found at 'namespace_started'; restarting...\n");
              const restarted = await apiRequest<NamespaceSession>({
                apiUrl: options.apiUrl,
                path: "/namespace-verification-sessions",
                method: "POST",
                ...authForRequest(owner),
                body: {
                  family: "spaces",
                  root_label: c.root_label,
                },
              });
              namespaceVerificationSessionId = namespaceSessionId(restarted) ?? namespaceVerificationSessionId;
              session = restarted;
            }
          } else if (!session && namespaceVerificationSessionId && existing?.status === "namespace_published") {
            process.stdout.write("  [namespace] resuming from published state, completing...\n");
          } else if (!session && namespaceVerificationSessionId) {
            const resumed = await findReusableNamespaceSession({ db, userId: owner.userId, rootLabel: c.root_label });
            if (resumed) {
              session = resumed;
            }
          }

          if (session && !namespaceVerificationId && existing?.status !== "namespace_published") {
            process.stdout.write("  [namespace] publishing Fabric records...\n");
            await publishSpacesChallenge(publisherSsh, publisherBin, walletExport, c.root_label, session, maxIndex);
            process.stdout.write("  [namespace] published.\n");

            state[c.root_label] = {
              ...state[c.root_label],
              status: "namespace_published",
              error: null,
            };
            saveState(statePath, state);
          }

          process.stdout.write("  [namespace] completing verification...\n");
          if (!namespaceVerificationSessionId) {
            throw new Error("no namespace_verification_session_id available for completion");
          }
          const completed = await completeNamespaceWithRetry({
            apiUrl: options.apiUrl,
            ...authForRequest(owner),
            sessionId: namespaceVerificationSessionId,
          });
          namespaceVerificationId = namespaceVerificationIdFromSession(completed);
          if (!namespaceVerificationId) {
            throw new Error(`namespace completion did not return namespace_verification_id; status=${completed.status ?? "unknown"}`);
          }
          process.stdout.write(`  [namespace] verified: ${namespaceVerificationId}\n`);

          state[c.root_label] = {
            ...state[c.root_label],
            namespace_verification_id: namespaceVerificationId,
            status: "namespace_verified",
            error: null,
          };
          saveState(statePath, state);
        }

        process.stdout.write("  [community] creating...\n");
        const created = await apiRequest<CommunityCreateResponse>({
          apiUrl: options.apiUrl,
          path: "/communities",
          method: "POST",
          ...authForRequest(owner),
          body: {
            display_name: c.display_name,
            description: c.description ?? null,
            database_region: databaseRegion,
            membership_mode: "gated",
            allow_anonymous_identity: false,
            default_age_gate_policy: "none",
            governance_mode: "centralized",
            human_verification_lane: "self",
            namespace: {
              namespace_verification: publicNamespaceVerificationId(namespaceVerificationId),
            },
            handle_policy: {
              policy_template: "standard",
            },
            gate_policy: buildNationalityGatePolicy(c.country_code_iso3),
          },
        });

        const createdCommunityId = communityId(created);
        if (!createdCommunityId) {
          throw new Error(`community create did not return community_id; job_status=${created.job?.status} job_error=${created.job?.error_code}`);
        }
        process.stdout.write(`  [community] created: ${createdCommunityId}\n`);

        state[c.root_label] = {
          root: c.root,
          display_name: c.display_name,
          country_code: c.country_code,
          root_label: c.root_label,
          namespace_verification_session_id: namespaceVerificationSessionId,
          namespace_verification_id: namespaceVerificationId,
          community_id: createdCommunityId,
          route_slug: created.community?.route_slug ?? null,
          status: "community_created",
          error: null,
        };
        saveState(statePath, state);
        process.stdout.write(`  [@${c.root_label}] done.\n`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        process.stderr.write(`  [@${c.root_label}] FAILED: ${message}\n`);
        state[c.root_label] = {
          ...(state[c.root_label] ?? {
            root: c.root,
            display_name: c.display_name,
            country_code: c.country_code,
            root_label: c.root_label,
            namespace_verification_session_id: null,
            namespace_verification_id: null,
            community_id: null,
            route_slug: null,
          }),
          status: "failed",
          error: message,
        };
        saveState(statePath, state);
      }

      processed += 1;
    }

    const completedCommunities = Object.values(state).filter((s) => s.status === "community_created").length;
    const failedCommunities = Object.values(state).filter((s) => s.status === "failed").length;
    const pendingCommunities = Object.values(state).filter((s) => !["community_created", "failed"].includes(s.status)).length;

    process.stdout.write(`\n=== SUMMARY ===\n`);
    process.stdout.write(`  Created:  ${completedCommunities}\n`);
    process.stdout.write(`  Failed:   ${failedCommunities}\n`);
    process.stdout.write(`  Pending:  ${pendingCommunities}\n`);
    process.stdout.write(`  Total:    ${Object.keys(state).length}\n`);
  } finally {
    await db.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
