import { afterAll, beforeEach, describe, expect, test } from "bun:test";

import { PowerDnsApiClient } from "./pdns-store";

type RecordedRequest = {
  method: string;
  path: string;
  contentType: string | null;
  apiKey: string | null;
  body: unknown;
};

const requests: RecordedRequest[] = [];
let zones = new Map<string, { name: string; dnssec: boolean; serial: number; rrsets: unknown[] }>();

const mock = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  async fetch(request) {
    const url = new URL(request.url);
    const body = request.method === "GET" ? undefined : await request.json().catch(() => undefined);
    requests.push({
      method: request.method,
      path: url.pathname,
      contentType: request.headers.get("content-type"),
      apiKey: request.headers.get("x-api-key"),
      body,
    });

    const zoneMatch = url.pathname.match(/^\/api\/v1\/servers\/localhost\/zones\/([^/]+)(\/rectify|\/notify)?$/);
    if (zoneMatch) {
      const zoneName = decodeURIComponent(zoneMatch[1]!);
      const zone = zones.get(zoneName);
      if (!zone) {
        return Response.json({ error: "Not Found" }, { status: 404 });
      }
      if (zoneMatch[2]) {
        return Response.json({ result: "ok" });
      }
      if (request.method === "PATCH") {
        applyRrsets(zone, (body as { rrsets: RrsetPayload[] }).rrsets);
        zone.serial += 1;
        return new Response(null, { status: 204 });
      }
      return Response.json(zone);
    }

    if (url.pathname === "/api/v1/servers/localhost/zones" && request.method === "POST") {
      const payload = body as { name: string; rrsets: RrsetPayload[] };
      if (zones.has(payload.name)) {
        return Response.json({ error: "Conflict" }, { status: 409 });
      }
      const zone = { name: payload.name, dnssec: false, serial: 1, rrsets: [] as unknown[] };
      applyRrsets(zone, payload.rrsets);
      zones.set(payload.name, zone);
      return Response.json(zone, { status: 201 });
    }

    return Response.json({ error: `unhandled ${request.method} ${url.pathname}` }, { status: 500 });
  },
});

type RrsetPayload = {
  name: string;
  type: string;
  ttl: number;
  changetype: string;
  records: { content: string; disabled: boolean }[];
};

function applyRrsets(zone: { rrsets: unknown[] }, rrsets: RrsetPayload[]) {
  for (const rrset of rrsets) {
    zone.rrsets = (zone.rrsets as RrsetPayload[]).filter(
      (existing) => !(existing.name === rrset.name && existing.type === rrset.type),
    );
    if (rrset.changetype === "REPLACE") {
      zone.rrsets.push({ ...rrset });
    }
  }
}

function client(): PowerDnsApiClient {
  return new PowerDnsApiClient({
    apiUrl: `http://127.0.0.1:${mock.port}`,
    apiKey: "test-key",
    defaultSoaContent: "ns1.pirate dns.pirate 0 3600 900 1209600 300",
  });
}

const ENSURE_INPUT = {
  zoneName: "crew.",
  nameservers: ["ns1.pirate.", "ns2.pirate."],
  nameserverIpv4: null,
  apexIpv4: "203.0.113.10",
  wildcardIpv4: "203.0.113.10",
  ttl: 300,
};

beforeEach(() => {
  requests.length = 0;
  zones = new Map();
});

afterAll(() => {
  mock.stop(true);
});

describe("PowerDnsApiClient", () => {
  test("creates a missing zone with every managed rrset in a single POST", async () => {
    const result = await client().ensureZone({
      ...ENSURE_INPUT,
      extraRrsets: [{ name: "_pirate.crew.", type: "TXT", ttl: 300, records: ['"pirate-verification=abc"'] }],
    });

    expect(result.created).toBe(true);
    const writes = requests.filter((entry) => entry.method === "POST" || entry.method === "PATCH");
    expect(writes).toHaveLength(1);
    expect(writes[0]!.method).toBe("POST");
    expect(writes[0]!.contentType).toBe("application/json");
    expect(writes[0]!.apiKey).toBe("test-key");

    const posted = writes[0]!.body as { soa_edit_api: string; rrsets: RrsetPayload[] };
    expect(posted.soa_edit_api).toBe("DEFAULT");
    const types = posted.rrsets.map((rrset) => `${rrset.name}|${rrset.type}`);
    expect(types).toContain("crew.|SOA");
    expect(types).toContain("crew.|NS");
    expect(types).toContain("crew.|A");
    expect(types).toContain("*.crew.|A");
    expect(types).toContain("_pirate.crew.|TXT");
  });

  test("converges an existing zone with a single PATCH that omits the SOA", async () => {
    await client().ensureZone(ENSURE_INPUT);
    requests.length = 0;

    const result = await client().ensureZone({
      ...ENSURE_INPUT,
      extraRrsets: [{ name: "_pirate.crew.", type: "TXT", ttl: 300, records: ['"pirate-verification=xyz"'] }],
    });

    expect(result.created).toBe(false);
    const writes = requests.filter((entry) => entry.method === "POST" || entry.method === "PATCH");
    expect(writes).toHaveLength(1);
    expect(writes[0]!.method).toBe("PATCH");
    expect(writes[0]!.contentType).toBe("application/json");

    const patched = writes[0]!.body as { rrsets: RrsetPayload[] };
    expect(patched.rrsets.some((rrset) => rrset.type === "SOA")).toBe(false);
    expect(patched.rrsets.some((rrset) => rrset.type === "TXT")).toBe(true);
  });

  test("notifies secondaries after every write and rectifies DNSSEC zones", async () => {
    await client().ensureZone(ENSURE_INPUT);
    expect(requests.some((entry) => entry.path.endsWith("/notify") && entry.method === "PUT")).toBe(true);
    expect(requests.some((entry) => entry.path.endsWith("/rectify"))).toBe(false);

    zones.get("crew.")!.dnssec = true;
    requests.length = 0;
    await client().ensureZone(ENSURE_INPUT);
    expect(requests.some((entry) => entry.path.endsWith("/rectify") && entry.method === "PUT")).toBe(true);
    expect(requests.some((entry) => entry.path.endsWith("/notify") && entry.method === "PUT")).toBe(true);
  });

  test("ensureZone is idempotent for repeated identical input", async () => {
    const first = await client().ensureZone(ENSURE_INPUT);
    const second = await client().ensureZone(ENSURE_INPUT);

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.zone.rrsets).toEqual(first.zone.rrsets);
  });

  test("getZoneByName returns null for missing zones and dot-stripped names otherwise", async () => {
    expect(await client().getZoneByName("missing.")).toBe(null);

    await client().ensureZone(ENSURE_INPUT);
    const zone = await client().getZoneByName("crew.");
    expect(zone?.name).toBe("crew");
    expect(zone?.nameservers).toEqual(["ns1.pirate.", "ns2.pirate."]);
    expect(zone?.rrsets.every((rrset) => !rrset.name.endsWith("."))).toBe(true);
  });

  test("surfaces PowerDNS error bodies on failure", async () => {
    const failing = new PowerDnsApiClient({
      apiUrl: `http://127.0.0.1:${mock.port}`,
      apiKey: "test-key",
      serverId: "localhost",
      defaultSoaContent: "ns1.pirate dns.pirate 0 3600 900 1209600 300",
    });
    zones.set("broken.", { name: "broken.", dnssec: false, serial: 1, rrsets: [] });
    const original = zones.get;
    // Force the PATCH to fail by removing the zone between GET and PATCH.
    let reads = 0;
    zones.get = function (key: string) {
      if (key === "broken." && ++reads > 1) {
        return undefined;
      }
      return original.call(this, key);
    } as typeof zones.get;

    await expect(failing.ensureZone({ ...ENSURE_INPUT, zoneName: "broken." })).rejects.toThrow(/PowerDNS API/);
    zones.get = original;
  });
});
