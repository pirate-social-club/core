type InspectResult = {
  root_label: string;
  zone_name: string;
  challenge_name: string;
  zone_exists: boolean;
  challenge_present: boolean;
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

import { PowerDnsClient, type PowerDnsZone } from "./pdns-client";

const verifierHost = Bun.env.HNS_VERIFIER_HOST?.trim() || "127.0.0.1";
const verifierPort = Number(Bun.env.HNS_VERIFIER_PORT || "4048");
const verifierAuthToken = Bun.env.HNS_VERIFIER_AUTH_TOKEN?.trim() || null;

const pdnsApiUrl = Bun.env.PDNS_API_URL?.trim() || "http://127.0.0.1:8081/api/v1";
const pdnsServerId = Bun.env.PDNS_SERVER_ID?.trim() || "localhost";
const pdnsApiKey = Bun.env.PDNS_API_KEY?.trim() || null;

const defaultNameservers = parseCsv(Bun.env.HNS_AUTHORITATIVE_NAMESERVERS) ?? ["ns1.pirate.sc."];
const defaultTtl = Number(Bun.env.HNS_AUTHORITATIVE_TTL || "300");
const defaultApexIpv4 = Bun.env.HNS_AUTHORITATIVE_APEX_IPV4?.trim() || null;
const defaultProfileIpv4 = Bun.env.HNS_AUTHORITATIVE_PROFILE_IPV4?.trim() || defaultApexIpv4;
const defaultWildcardIpv4 = Bun.env.HNS_AUTHORITATIVE_WILDCARD_IPV4?.trim() || defaultApexIpv4;

function parseCsv(value: string | undefined): string[] | null {
  const entries = value?.split(",").map((entry) => entry.trim()).filter(Boolean) ?? [];
  return entries.length > 0 ? entries.map(withTrailingDot) : null;
}

function withTrailingDot(value: string): string {
  return value.endsWith(".") ? value : `${value}.`;
}

function json(data: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(data), {
    headers: {
      "content-type": "application/json",
    },
    ...init,
  });
}

function requireVerifierAuth(request: Request) {
  if (!verifierAuthToken) {
    return null;
  }
  return request.headers.get("authorization") === `Bearer ${verifierAuthToken}`
    ? null
    : json({ error: "Unauthorized" }, { status: 401 });
}

function requirePowerDnsClient(): PowerDnsClient {
  if (!pdnsApiKey) {
    throw new Error("PDNS_API_KEY is required");
  }

  return new PowerDnsClient(pdnsApiUrl, pdnsApiKey, pdnsServerId);
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

function escapeTxtRecord(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, "\\\"")}"`;
}

function normalizeTxtRecordContent(value: string): string {
  const trimmed = value.trim();
  if (trimmed.startsWith("\"") && trimmed.endsWith("\"")) {
    return trimmed.slice(1, -1).replace(/\\"/g, "\"").replace(/\\\\/g, "\\");
  }
  return trimmed;
}

function summarizeZone(zone: PowerDnsZone): InspectResult["rrsets"] {
  return zone.rrsets?.map((rrset) => ({
    name: rrset.name,
    type: rrset.type,
    ttl: rrset.ttl ?? null,
    records: rrset.records?.map((record) => record.content) ?? [],
  })) ?? [];
}

async function inspectRoot(rootLabel: string, challengeHost?: string | null): Promise<InspectResult> {
  const client = requirePowerDnsClient();
  const zoneName = normalizeZoneName(rootLabel);
  const challengeName = normalizeChallengeName(rootLabel, challengeHost);
  const zone = await client.getZoneByName(zoneName);

  if (!zone) {
    return {
      root_label: normalizeRootLabel(rootLabel),
      zone_name: zoneName,
      challenge_name: challengeName,
      zone_exists: false,
      challenge_present: false,
      nameservers: defaultNameservers,
      observation_provider: "powerdns_api",
      failure_reason: "zone_not_provisioned",
      rrsets: [],
    };
  }

  const hydratedZone = await client.getZone(zone.id, {
    rrsetName: challengeName,
    rrsetType: "TXT",
  });
  const challengePresent = (hydratedZone.rrsets ?? []).some((rrset) => rrset.type === "TXT" && rrset.name === challengeName);

  return {
    root_label: normalizeRootLabel(rootLabel),
    zone_name: zoneName,
    challenge_name: challengeName,
    zone_exists: true,
    challenge_present: challengePresent,
    nameservers: hydratedZone.nameservers ?? defaultNameservers,
    observation_provider: "powerdns_api",
    failure_reason: challengePresent ? null : "challenge_not_published",
    rrsets: summarizeZone(hydratedZone),
  };
}

async function publishTxt(body: {
  root_label?: string | null;
  challenge_host?: string | null;
  challenge_txt_value?: string | null;
  apex_ipv4?: string | null;
  profile_ipv4?: string | null;
  wildcard_ipv4?: string | null;
  nameservers?: string[] | null;
}) {
  const rootLabel = body.root_label?.trim();
  const challengeTxtValue = body.challenge_txt_value?.trim();

  if (!rootLabel || !challengeTxtValue) {
    return json({ error: "root_label and challenge_txt_value are required" }, { status: 400 });
  }

  const client = requirePowerDnsClient();
  const normalizedRoot = normalizeRootLabel(rootLabel);
  const zoneName = normalizeZoneName(normalizedRoot);
  const challengeName = normalizeChallengeName(normalizedRoot, body.challenge_host);
  const nameservers = body.nameservers?.map(withTrailingDot) ?? defaultNameservers;

  const ensured = await client.ensureZone({
    zoneName,
    nameservers,
    apexIpv4: body.apex_ipv4?.trim() || defaultApexIpv4,
    profileIpv4: body.profile_ipv4?.trim() || defaultProfileIpv4,
    wildcardIpv4: body.wildcard_ipv4?.trim() || defaultWildcardIpv4,
    ttl: defaultTtl,
  });

  await client.replaceRecordSet(ensured.zone.id, challengeName, "TXT", defaultTtl, [escapeTxtRecord(challengeTxtValue)]);
  const zone = await client.getZone(ensured.zone.id, {
    rrsetName: challengeName,
    rrsetType: "TXT",
  });

  return json({
    root_label: normalizedRoot,
    zone_name: zoneName,
    challenge_name: challengeName,
    challenge_txt_value: challengeTxtValue,
    zone_created: ensured.created,
    nameservers,
    observation_provider: "powerdns_api",
    rrsets: summarizeZone(zone),
  });
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

  const client = requirePowerDnsClient();
  const normalizedRoot = normalizeRootLabel(rootLabel);
  const zoneName = normalizeZoneName(normalizedRoot);
  const challengeName = normalizeChallengeName(normalizedRoot, body.challenge_host);
  const zone = await client.getZoneByName(zoneName);

  if (!zone) {
    return json({
      verified: false,
      observation_provider: "powerdns_api",
      failure_reason: "zone_not_provisioned",
    });
  }

  const hydratedZone = await client.getZone(zone.id, {
    rrsetName: challengeName,
    rrsetType: "TXT",
  });
  const rrset = (hydratedZone.rrsets ?? []).find((entry) => entry.name === challengeName && entry.type === "TXT") ?? null;
  const observedValues = rrset?.records?.map((record) => normalizeTxtRecordContent(record.content)) ?? [];
  const verified = observedValues.includes(challengeTxtValue);

  return json({
    verified,
    observation_provider: "powerdns_api",
    failure_reason: verified
      ? null
      : rrset == null
        ? "challenge_not_published"
        : "challenge_mismatch",
    observed_values: observedValues,
    root_label: normalizedRoot,
    zone_name: zoneName,
    challenge_name: challengeName,
  });
}

Bun.serve({
  hostname: verifierHost,
  port: verifierPort,
  async fetch(request) {
    const url = new URL(request.url);
    const authResponse = requireVerifierAuth(request);
    if (authResponse) {
      return authResponse;
    }

    if (url.pathname === "/health") {
      return json({
        ok: true,
        bind_host: verifierHost,
        bind_port: verifierPort,
        pdns_api_url: pdnsApiUrl,
        pdns_server_id: pdnsServerId,
        pdns_api_configured: pdnsApiKey != null,
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

    if (url.pathname === "/publish-txt") {
      if (request.method !== "POST") {
        return new Response("Method Not Allowed", { status: 405 });
      }

      try {
        const body = await request.json() as Parameters<typeof publishTxt>[0];
        return await publishTxt(body);
      } catch (error) {
        return json({
          error: error instanceof Error ? error.message : "publish failed",
        }, { status: 500 });
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

    return new Response("Not Found", { status: 404 });
  },
});

console.log(`HNS verifier listening on http://${verifierHost}:${verifierPort}`);
