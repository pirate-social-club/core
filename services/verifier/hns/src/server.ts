type InspectResult = {
  root_label: string;
  zone_name: string;
  challenge_name: string;
  zone_exists: boolean;
  challenge_present: boolean;
  root_exists: boolean | null;
  root_control_verified: boolean | null;
  expiry_horizon_sufficient: boolean | null;
  routing_enabled: boolean | null;
  pirate_dns_authority_verified: boolean | null;
  control_class: "single_holder_root" | "multisig_controlled_root" | "dao_controlled_root" | "burned_or_immutable_root" | null;
  operation_class: "owner_managed_namespace" | "routing_only_namespace" | "pirate_delegated_namespace" | "owner_signed_updates_namespace" | null;
  nameservers: string[];
  observation_provider: string;
  failure_reason: string | null;
  rrsets?: {
    name: string;
    type: string;
    ttl: number | null;
    records: string[];
  }[];
};

type PublicResolverConfig = {
  id: string;
  url: string;
};

type PublicDnsRecord = {
  TTL?: number;
  data?: string;
  name?: string;
  type?: number;
  typename?: string;
};

type PublicDnsResponse = {
  Answer?: PublicDnsRecord[];
  Status?: number;
  Responder?: string;
};

import { PowerDnsStore, type PowerDnsZoneSnapshot } from "./pdns-store";
import { json, requireBearerAuth } from "../../shared/http";

const verifierHost = Bun.env.HNS_VERIFIER_HOST?.trim() || "127.0.0.1";
const verifierPort = Number(Bun.env.HNS_VERIFIER_PORT || "4048");
const verifierAuthToken = Bun.env.HNS_VERIFIER_AUTH_TOKEN?.trim() || null;

const pdnsSqliteDatabase = Bun.env.PDNS_SQLITE_DATABASE?.trim() || "/srv/pirate-hns/authdns/data/pdns.sqlite3";
const defaultSoaContent = Bun.env.PDNS_DEFAULT_SOA_CONTENT?.trim() || "ns1.pirate dns.pirate 0 3600 900 1209600 300";

const defaultNameservers = parseCsv(Bun.env.HNS_AUTHORITATIVE_NAMESERVERS) ?? ["ns1.pirate."];
const publicResolverConfigs = parsePublicResolverConfigs(Bun.env.HNS_PUBLIC_RESOLVER_JSON_URLS)
  ?? [{ id: "web3dns", url: "https://api.web3dns.net/" }];

function parseCsv(value: string | undefined): string[] | null {
  const entries = value?.split(",").map((entry) => entry.trim()).filter(Boolean) ?? [];
  return entries.length > 0 ? entries.map(withTrailingDot) : null;
}

function parsePublicResolverConfigs(value: string | undefined): PublicResolverConfig[] | null {
  const entries = value?.split(",").map((entry) => entry.trim()).filter(Boolean) ?? [];
  if (entries.length === 0) return null;
  return entries.map((entry, index) => {
    const [id, ...urlParts] = entry.includes("=") ? entry.split("=") : [`resolver_${index + 1}`, entry];
    const url = urlParts.join("=").trim();
    if (!url) {
      throw new Error(`invalid HNS_PUBLIC_RESOLVER_JSON_URLS entry: ${entry}`);
    }
    return { id: id.trim() || `resolver_${index + 1}`, url };
  });
}

function withTrailingDot(value: string): string {
  return value.endsWith(".") ? value : `${value}.`;
}

function toStorageName(value: string): string {
  return value.replace(/\.$/, "");
}

function requirePowerDnsStore(): PowerDnsStore {
  return new PowerDnsStore(pdnsSqliteDatabase, defaultSoaContent);
}

function normalizeRootLabel(value: string): string {
  const trimmed = value.trim().toLowerCase().replace(/\/+$/, "");
  if (!/^[a-z0-9-]+$/.test(trimmed)) {
    throw new Error("root_label must be a single Handshake TLD label");
  }
  return trimmed;
}

function normalizeZoneName(rootLabel: string): string {
  return `${normalizeRootLabel(rootLabel)}.`;
}

function normalizeChallengeName(rootLabel: string, challengeHost?: string | null): string {
  const normalizedRoot = normalizeRootLabel(rootLabel);
  const value = (challengeHost?.trim() || "_pirate").replace(/\.$/, "").toLowerCase();

  if (value === "_pirate") {
    return `_pirate.${normalizedRoot}.`;
  }

  if (value === `_pirate.${normalizedRoot}`) {
    return `${value}.`;
  }

  if (value.endsWith(`.${normalizedRoot}`)) {
    return `${value}.`;
  }

  throw new Error("challenge_host must be _pirate or a name within the delegated root");
}

function normalizeTxtRecordContent(value: string): string {
  const trimmed = value.trim();
  if (trimmed.startsWith("\"") && trimmed.endsWith("\"")) {
    return trimmed.slice(1, -1).replace(/\\"/g, "\"").replace(/\\\\/g, "\\");
  }
  return trimmed;
}

function normalizeResolverRecordContent(value: string): string {
  return normalizeTxtRecordContent(value).trim();
}

function summarizeZone(zone: PowerDnsZoneSnapshot): InspectResult["rrsets"] {
  return zone.rrsets.map((rrset) => ({
    name: withTrailingDot(rrset.name),
    type: rrset.type,
    ttl: rrset.ttl ?? null,
    records: rrset.type === "NS"
      ? rrset.records.map((record) => withTrailingDot(record))
      : rrset.records,
  }));
}

function deriveInspectionFields(zoneExists: boolean) {
  if (!zoneExists) {
    return {
      root_exists: null,
      root_control_verified: null,
      expiry_horizon_sufficient: null,
      routing_enabled: null,
      pirate_dns_authority_verified: false,
      control_class: null,
      operation_class: null,
    };
  }

  return {
    root_exists: true,
    root_control_verified: null,
    expiry_horizon_sufficient: true,
    routing_enabled: true,
    pirate_dns_authority_verified: true,
    control_class: "single_holder_root" as const,
    operation_class: "pirate_delegated_namespace" as const,
  };
}

function resolverQueryUrl(resolver: PublicResolverConfig, name: string, type: "NS" | "TXT"): string {
  const url = new URL(resolver.url);
  url.searchParams.set("name", name.replace(/\.$/, ""));
  url.searchParams.set("type", type);
  return url.toString();
}

async function queryPublicResolver(resolver: PublicResolverConfig, name: string, type: "NS" | "TXT"): Promise<PublicDnsResponse> {
  const response = await fetch(resolverQueryUrl(resolver, name, type), {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) {
    throw new Error(`${resolver.id} returned HTTP ${response.status}`);
  }
  const body = await response.json() as PublicDnsResponse;
  if (!body || typeof body !== "object" || typeof body.Status !== "number" || !Array.isArray(body.Answer)) {
    throw new Error(`${resolver.id} returned unexpected DNS JSON`);
  }
  return body;
}

async function queryConfiguredPublicResolvers(name: string, type: "NS" | "TXT") {
  const responses = [];
  for (const resolver of publicResolverConfigs) {
    const body = await queryPublicResolver(resolver, name, type);
    responses.push({ resolver, body });
  }
  return responses;
}

function answerData(body: PublicDnsResponse, typename: "NS" | "TXT"): string[] {
  return (body.Answer ?? [])
    .filter((record) => record.typename === typename || (typename === "NS" ? record.type === 2 : record.type === 16))
    .map((record) => typeof record.data === "string" ? normalizeResolverRecordContent(record.data) : "")
    .filter(Boolean);
}

function expectedNameservers(): string[] {
  return defaultNameservers.map((nameserver) => withTrailingDot(nameserver).toLowerCase());
}

function normalizeNameserver(value: string): string {
  return withTrailingDot(value.trim().toLowerCase());
}

function publicNsInspection(rootLabel: string, responses: Awaited<ReturnType<typeof queryConfiguredPublicResolvers>>) {
  const expected = expectedNameservers();
  const resolverResults = responses.map(({ resolver, body }) => {
    const observed = answerData(body, "NS").map(normalizeNameserver);
    const missing = expected.filter((nameserver) => !observed.includes(nameserver));
    return {
      resolver: resolver.id,
      status: body.Status ?? null,
      responder: body.Responder ?? null,
      observed_nameservers: observed,
      missing_nameservers: missing,
      matched: body.Status === 0 && missing.length === 0,
    };
  });
  const matched = resolverResults.every((result) => result.matched);
  return {
    root_label: normalizeRootLabel(rootLabel),
    zone_name: normalizeZoneName(rootLabel),
    observation_provider: "web3dns_json_doh",
    resolver_results: resolverResults,
    nameservers: expected,
    root_exists: resolverResults.some((result) => result.status === 0 && result.observed_nameservers.length > 0),
    root_control_verified: matched,
    expiry_horizon_sufficient: null,
    routing_enabled: matched,
    pirate_dns_authority_verified: matched,
    control_class: matched ? "single_holder_root" : null,
    operation_class: matched ? "pirate_delegated_namespace" : null,
    failure_reason: matched
      ? null
      : resolverResults.some((result) => result.status === 0 && result.observed_nameservers.length > 0)
        ? "nameserver_mismatch"
        : "root_not_found",
  };
}

async function inspectPublicRoot(rootLabel: string) {
  const normalizedRoot = normalizeRootLabel(rootLabel);
  const responses = await queryConfiguredPublicResolvers(normalizeZoneName(normalizedRoot), "NS");
  return publicNsInspection(normalizedRoot, responses);
}

async function inspectRoot(rootLabel: string, challengeHost?: string | null): Promise<InspectResult> {
  const store = requirePowerDnsStore();
  const zoneName = normalizeZoneName(rootLabel);
  const challengeName = normalizeChallengeName(rootLabel, challengeHost);
  const zone = store.getZoneByName(zoneName);

  if (!zone) {
    return {
      root_label: normalizeRootLabel(rootLabel),
      zone_name: zoneName,
      challenge_name: challengeName,
      zone_exists: false,
      challenge_present: false,
      nameservers: defaultNameservers,
      observation_provider: "powerdns_sqlite",
      failure_reason: "zone_not_provisioned",
      rrsets: [],
      ...deriveInspectionFields(false),
    };
  }

  const challengePresent = zone.rrsets.some((rrset) => rrset.type === "TXT" && rrset.name === toStorageName(challengeName));

  return {
    root_label: normalizeRootLabel(rootLabel),
    zone_name: zoneName,
    challenge_name: challengeName,
    zone_exists: true,
    challenge_present: challengePresent,
    nameservers: zone.nameservers.length > 0 ? zone.nameservers.map(withTrailingDot) : defaultNameservers,
    observation_provider: "powerdns_sqlite",
    failure_reason: challengePresent ? null : "challenge_not_published",
    rrsets: summarizeZone(zone),
    ...deriveInspectionFields(true),
  };
}

async function verifyTxt(body: {
  root_label?: string | null;
  challenge_host?: string | null;
  challenge_txt_value?: string | null;
}) {
  const rootLabel = body.root_label?.trim();
  const challengeTxtValue = body.challenge_txt_value?.trim();

  if (!rootLabel || !challengeTxtValue) {
    return json({ error: "root_label and challenge_txt_value are required" }, { status: 400 });
  }

  const store = requirePowerDnsStore();
  const normalizedRoot = normalizeRootLabel(rootLabel);
  const zoneName = normalizeZoneName(normalizedRoot);
  const challengeName = normalizeChallengeName(normalizedRoot, body.challenge_host);
  const zone = store.getZoneByName(zoneName);

  if (!zone) {
    return json({
      verified: false,
      observation_provider: "powerdns_sqlite",
      failure_reason: "zone_not_provisioned",
      root_exists: false,
      root_control_verified: false,
      expiry_horizon_sufficient: false,
      routing_enabled: false,
      pirate_dns_authority_verified: false,
      control_class: null,
      operation_class: null,
    });
  }

  const rrset = zone.rrsets.find((entry) => entry.name === toStorageName(challengeName) && entry.type === "TXT") ?? null;
  const observedValues = rrset?.records.map((record) => normalizeTxtRecordContent(record)) ?? [];
  const verified = observedValues.includes(challengeTxtValue);

  return json({
    verified,
    observation_provider: "powerdns_sqlite",
    failure_reason: verified
      ? null
      : rrset == null
        ? "challenge_not_published"
        : "challenge_mismatch",
    observed_values: observedValues,
    root_exists: true,
    root_control_verified: verified,
    expiry_horizon_sufficient: true,
    routing_enabled: true,
    pirate_dns_authority_verified: true,
    control_class: "single_holder_root",
    operation_class: "pirate_delegated_namespace",
    root_label: normalizedRoot,
    zone_name: zoneName,
    challenge_name: challengeName,
  });
}

async function verifyTxtPublic(body: {
  root_label?: string | null;
  challenge_host?: string | null;
  challenge_txt_value?: string | null;
}) {
  const rootLabel = body.root_label?.trim();
  const challengeTxtValue = body.challenge_txt_value?.trim();

  if (!rootLabel || !challengeTxtValue) {
    return json({ error: "root_label and challenge_txt_value are required" }, { status: 400 });
  }

  const normalizedRoot = normalizeRootLabel(rootLabel);
  const challengeName = normalizeChallengeName(normalizedRoot, body.challenge_host);
  const [nsResponses, txtResponses] = await Promise.all([
    queryConfiguredPublicResolvers(normalizeZoneName(normalizedRoot), "NS"),
    queryConfiguredPublicResolvers(challengeName, "TXT"),
  ]);
  const nsInspection = publicNsInspection(normalizedRoot, nsResponses);
  const txtResolverResults = txtResponses.map(({ resolver, body: responseBody }) => {
    const observedValues = answerData(responseBody, "TXT");
    return {
      resolver: resolver.id,
      status: responseBody.Status ?? null,
      responder: responseBody.Responder ?? null,
      observed_values: observedValues,
      matched: responseBody.Status === 0 && observedValues.includes(challengeTxtValue),
    };
  });
  const txtVerified = txtResolverResults.every((result) => result.matched);
  const verified = nsInspection.pirate_dns_authority_verified === true && txtVerified;

  return json({
    verified,
    observation_provider: "web3dns_json_doh",
    failure_reason: verified
      ? null
      : nsInspection.pirate_dns_authority_verified !== true
        ? nsInspection.failure_reason
        : txtResolverResults.some((result) => result.observed_values.length > 0)
          ? "challenge_mismatch"
          : "challenge_not_published",
    observed_values: txtResolverResults.flatMap((result) => result.observed_values),
    txt_resolver_results: txtResolverResults,
    ...nsInspection,
    challenge_name: challengeName,
    root_control_verified: verified,
  });
}

export async function handleRequest(request: Request) {
    const url = new URL(request.url);
    const authResponse = requireBearerAuth(request, verifierAuthToken);
    if (authResponse) {
      return authResponse;
    }

    if (url.pathname === "/health") {
      return json({
        ok: true,
        bind_host: verifierHost,
        bind_port: verifierPort,
        pdns_sqlite_database: pdnsSqliteDatabase,
        observation_provider: "powerdns_sqlite",
        requires_bearer_auth: verifierAuthToken != null,
      });
    }

    if (url.pathname === "/" || url.pathname === "/inspect") {
      if (request.method !== "GET") {
        return new Response("Method Not Allowed", { status: 405 });
      }

      try {
        const rootLabel = url.searchParams.get("root_label");
        if (!rootLabel) {
          return json({ error: "root_label is required" }, { status: 400 });
        }
        return json(await inspectRoot(rootLabel, url.searchParams.get("challenge_host")));
      } catch (error) {
        return json({
          error: error instanceof Error ? error.message : "inspect failed",
        }, { status: 500 });
      }
    }

    if (url.pathname === "/inspect-public") {
      if (request.method !== "GET") {
        return new Response("Method Not Allowed", { status: 405 });
      }

      try {
        const rootLabel = url.searchParams.get("root_label");
        if (!rootLabel) {
          return json({ error: "root_label is required" }, { status: 400 });
        }
        return json(await inspectPublicRoot(rootLabel));
      } catch (error) {
        return json({
          error: error instanceof Error ? error.message : "public inspect failed",
        }, { status: 502 });
      }
    }

    if (url.pathname === "/verify-txt") {
      if (request.method !== "POST") {
        return new Response("Method Not Allowed", { status: 405 });
      }

      try {
        const body = await request.json() as Parameters<typeof verifyTxt>[0];
        return await verifyTxt(body);
      } catch (error) {
        return json({
          error: error instanceof Error ? error.message : "TXT verification failed",
        }, { status: 500 });
      }
    }

    if (url.pathname === "/verify-txt-public") {
      if (request.method !== "POST") {
        return new Response("Method Not Allowed", { status: 405 });
      }

      try {
        const body = await request.json() as Parameters<typeof verifyTxtPublic>[0];
        return await verifyTxtPublic(body);
      } catch (error) {
        return json({
          error: error instanceof Error ? error.message : "public TXT verification failed",
        }, { status: 502 });
      }
    }

    return new Response("Not Found", { status: 404 });
}

if (import.meta.main) {
  Bun.serve({
    hostname: verifierHost,
    port: verifierPort,
    fetch(request) {
      return handleRequest(request);
    },
  });

  console.log(`HNS verifier listening on http://${verifierHost}:${verifierPort}`);
}
