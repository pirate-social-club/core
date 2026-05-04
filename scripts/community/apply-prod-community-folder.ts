#!/usr/bin/env bun

import { createHmac } from "node:crypto";
import { basename, join, resolve } from "node:path";

type Options = {
  apiUrl: string;
  folder: string;
  communityId: string;
  issuer: string;
  audience: string;
  subject: string;
  nationality: string;
};

type SessionExchangeResponse = {
  access_token?: string;
  user?: { user_id?: string };
};

type MediaUploadResponse = {
  media_ref?: string;
};

type CommunityResponse = {
  community_id?: string;
  display_name?: string;
  description?: string | null;
  avatar_ref?: string | null;
  banner_ref?: string | null;
  membership_mode?: string;
  route_slug?: string | null;
  gate_policy?: unknown;
  label_policy?: unknown;
  donation_policy_mode?: string;
  donation_partner_id?: string | null;
};

function usage(exitCode = 1): never {
  console.error(`Usage:
  rtk infisical run --env prod --path /services/api -- \\
    rtk bun scripts/community/apply-prod-community-folder.ts \\
      --folder /home/t42/Documents/pirate-communities/@xn--t77hga \\
      --community-id cmt_...

Environment:
  AUTH_UPSTREAM_JWT_SHARED_SECRET  Required.`);
  process.exit(exitCode);
}

function parseArgs(argv: string[]): Options {
  const options: Options = {
    apiUrl: "https://api.pirate.sc",
    folder: "",
    communityId: "",
    issuer: "pirate-production-upstream",
    audience: "api-core",
    subject: "launch-owner-palestine-space-20260429",
    nationality: "PSE",
  };

  for (let index = 0; index < argv.length; ) {
    const arg = argv[index];
    const value = argv[index + 1] ?? "";
    switch (arg) {
      case "--api-url":
        options.apiUrl = value.trim() || options.apiUrl;
        index += 2;
        break;
      case "--folder":
        options.folder = resolve(value);
        index += 2;
        break;
      case "--community-id":
        options.communityId = value.trim();
        index += 2;
        break;
      case "--issuer":
        options.issuer = value.trim() || options.issuer;
        index += 2;
        break;
      case "--audience":
        options.audience = value.trim() || options.audience;
        index += 2;
        break;
      case "--subject":
        options.subject = value.trim() || options.subject;
        index += 2;
        break;
      case "--nationality":
        options.nationality = value.trim().toUpperCase() || options.nationality;
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

  if (!options.folder || !options.communityId) {
    usage();
  }
  if (!/^cmt_[a-f0-9]+$/u.test(options.communityId)) {
    throw new Error("--community-id must be a cmt_* id");
  }
  if (!/^[A-Z]{2,3}$/u.test(options.nationality)) {
    throw new Error("--nationality must be an ISO-3166 alpha-2 or alpha-3 country code");
  }
  return options;
}

function requireEnv(name: string): string {
  const value = String(process.env[name] ?? "").trim();
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

function base64UrlJson(value: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function signHs256Jwt(input: {
  issuer: string;
  audience: string;
  subject: string;
  sharedSecret: string;
}): string {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const header = base64UrlJson({ alg: "HS256", typ: "JWT" });
  const payload = base64UrlJson({
    iss: input.issuer,
    aud: input.audience,
    sub: input.subject,
    iat: nowSeconds,
    exp: nowSeconds + 600,
  });
  const signingInput = `${header}.${payload}`;
  const signature = createHmac("sha256", input.sharedSecret)
    .update(signingInput)
    .digest("base64url");
  return `${signingInput}.${signature}`;
}

async function readText(path: string): Promise<string> {
  return (await Bun.file(path).text()).trim();
}

function contentTypeFor(path: string): string {
  const lower = path.toLowerCase();
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".webp")) return "image/webp";
  return "application/octet-stream";
}

async function apiRequest<T>(input: {
  apiUrl: string;
  path: string;
  method: "GET" | "POST" | "PUT" | "PATCH";
  accessToken: string;
  body?: unknown;
}): Promise<T> {
  const response = await fetch(`${input.apiUrl.replace(/\/+$/u, "")}${input.path}`, {
    method: input.method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${input.accessToken}`,
    },
    body: input.body === undefined ? undefined : JSON.stringify(input.body),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`API request failed: ${input.method} ${input.path} status=${response.status} body=${text.slice(0, 500)}`);
  }
  return JSON.parse(text) as T;
}

async function exchangeLaunchOwner(options: Options): Promise<{ userId: string; accessToken: string }> {
  const jwt = signHs256Jwt({
    issuer: options.issuer,
    audience: options.audience,
    subject: options.subject,
    sharedSecret: requireEnv("AUTH_UPSTREAM_JWT_SHARED_SECRET"),
  });
  const response = await apiRequest<SessionExchangeResponse>({
    apiUrl: options.apiUrl,
    path: "/auth/session/exchange",
    method: "POST",
    accessToken: "",
    body: { proof: { type: "jwt_based_auth", jwt } },
  });
  const userId = response.user?.user_id?.trim();
  const accessToken = response.access_token?.trim();
  if (!userId || !accessToken) {
    throw new Error("session exchange did not return user_id and access_token");
  }
  return { userId, accessToken };
}

async function uploadMedia(options: Options, accessToken: string, kind: "avatar" | "banner", filePath: string): Promise<string> {
  const bytes = await Bun.file(filePath).arrayBuffer();
  const form = new FormData();
  form.set("kind", kind);
  form.set("file", new File([bytes], basename(filePath), { type: contentTypeFor(filePath) }));
  const response = await fetch(`${options.apiUrl.replace(/\/+$/u, "")}/community-media`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
    body: form,
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`media upload failed: ${kind} status=${response.status} body=${text.slice(0, 500)}`);
  }
  const parsed = JSON.parse(text) as MediaUploadResponse;
  if (!parsed.media_ref) {
    throw new Error(`media upload did not return media_ref for ${kind}`);
  }
  return parsed.media_ref;
}

function parseRules(text: string) {
  return {
    rules: text
      .split(/\n\s*\n/u)
      .map((block) => block.trim())
      .filter(Boolean)
      .map((block, index) => {
        const lines = block.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean);
        const title = lines[0] ?? "";
        const body = lines.slice(1).join("\n\n");
        if (!title || !body) {
          throw new Error(`rule block ${index + 1} must include title and body`);
        }
        return {
          title,
          body,
          report_reason: title,
          position: index,
          status: "active",
        };
      }),
  };
}

function parseLabels(text: string) {
  return {
    label_enabled: true,
    require_label_on_top_level_posts: false,
    definitions: text
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((label) => ({ label, status: "active" })),
  };
}

function buildNationalityGate(nationality: string) {
  return {
    membership_mode: "gated",
    default_age_gate_policy: "none",
    allow_anonymous_identity: false,
    gate_policy: {
      version: 1,
      expression: {
        op: "gate",
        gate: {
          type: "nationality",
          provider: "self",
          allowed: [nationality],
        },
      },
    },
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const session = await exchangeLaunchOwner(options);

  const name = await readText(join(options.folder, "name.txt"));
  const description = await readText(join(options.folder, "description.txt"));
  const rules = parseRules(await readText(join(options.folder, "rules.txt")));
  const labels = parseLabels(await readText(join(options.folder, "labels.txt")));
  const endaomentUrl = await readText(join(options.folder, "endaoment.txt"));
  const avatarRef = await uploadMedia(options, session.accessToken, "avatar", join(options.folder, "avatar.jpeg"));
  const bannerRef = await uploadMedia(options, session.accessToken, "banner", join(options.folder, "cover.png"));

  const updatedProfile = await apiRequest<CommunityResponse>({
    apiUrl: options.apiUrl,
    path: `/communities/${encodeURIComponent(options.communityId)}`,
    method: "PATCH",
    accessToken: session.accessToken,
    body: {
      display_name: name,
      description,
      avatar_ref: avatarRef,
      banner_ref: bannerRef,
      human_verification_lane: "self",
    },
  });

  const updatedRules = await apiRequest<CommunityResponse>({
    apiUrl: options.apiUrl,
    path: `/communities/${encodeURIComponent(options.communityId)}/rules`,
    method: "PUT",
    accessToken: session.accessToken,
    body: rules,
  });

  const updatedLabels = await apiRequest<CommunityResponse>({
    apiUrl: options.apiUrl,
    path: `/communities/${encodeURIComponent(options.communityId)}/labels`,
    method: "PATCH",
    accessToken: session.accessToken,
    body: labels,
  });

  const updatedGates = await apiRequest<CommunityResponse>({
    apiUrl: options.apiUrl,
    path: `/communities/${encodeURIComponent(options.communityId)}/gates`,
    method: "PUT",
    accessToken: session.accessToken,
    body: buildNationalityGate(options.nationality),
  });

  const donationPartner = await apiRequest<Record<string, unknown>>({
    apiUrl: options.apiUrl,
    path: `/communities/${encodeURIComponent(options.communityId)}/donation-policy/resolve`,
    method: "POST",
    accessToken: session.accessToken,
    body: { endaoment_url: endaomentUrl },
  });

  const updatedDonation = await apiRequest<CommunityResponse>({
    apiUrl: options.apiUrl,
    path: `/communities/${encodeURIComponent(options.communityId)}/donation-policy`,
    method: "PATCH",
    accessToken: session.accessToken,
    body: {
      donation_policy_mode: "optional_creator_sidecar",
      donation_partner_id: donationPartner.donation_partner_id,
      donation_partner: donationPartner,
    },
  });

  const publicCommunity = await fetch(`${options.apiUrl.replace(/\/+$/u, "")}/public-communities/%40xn--t77hga`)
    .then(async (response) => {
      const text = await response.text();
      if (!response.ok) {
        throw new Error(`public community read failed: status=${response.status} body=${text.slice(0, 500)}`);
      }
      return JSON.parse(text) as CommunityResponse;
    });

  console.log(JSON.stringify({
    status: "applied",
    community_id: options.communityId,
    launch_owner_user_id: session.userId,
    display_name: updatedProfile.display_name,
    description_length: updatedProfile.description?.length ?? 0,
    avatar_uploaded: Boolean(updatedProfile.avatar_ref),
    banner_uploaded: Boolean(updatedProfile.banner_ref),
    rules_count: rules.rules.length,
    labels_count: labels.definitions.length,
    membership_mode: updatedGates.membership_mode,
    nationality_gate: {
      provider: "self",
      required_value: options.nationality,
    },
    donation_policy_mode: updatedDonation.donation_policy_mode,
    donation_partner_id: updatedDonation.donation_partner_id,
    public_display_name: publicCommunity.display_name,
    public_description_length: publicCommunity.description?.length ?? 0,
    public_route_slug: publicCommunity.route_slug,
    sanity: {
      rules_response_seen: Boolean(updatedRules.community_id),
      labels_response_seen: Boolean(updatedLabels.community_id),
    },
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
