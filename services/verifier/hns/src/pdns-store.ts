export type PowerDnsRrsetSummary = {
  name: string;
  type: string;
  ttl: number | null;
  records: string[];
};

export type PowerDnsZoneSnapshot = {
  name: string;
  serial: number;
  dnssec: boolean;
  nameservers: string[];
  rrsets: PowerDnsRrsetSummary[];
};

export type PowerDnsRrsetInput = {
  name: string;
  type: string;
  ttl: number;
  records: string[];
};

export type EnsureZoneInput = {
  zoneName: string;
  nameservers: string[];
  nameserverIpv4?: string | null;
  apexIpv4?: string | null;
  profileIpv4?: string | null;
  wildcardIpv4?: string | null;
  ttl: number;
  extraRrsets?: PowerDnsRrsetInput[];
};

export type EnsureZoneResult = {
  zone: PowerDnsZoneSnapshot;
  created: boolean;
};

type ApiZone = {
  name: string;
  serial?: number;
  dnssec?: boolean;
  rrsets?: {
    name: string;
    type: string;
    ttl: number;
    records: { content: string; disabled: boolean }[];
  }[];
};

export type PowerDnsApiClientConfig = {
  apiUrl: string;
  apiKey: string;
  serverId?: string;
  defaultSoaContent: string;
  /**
   * Native zones are NEVER notified: PowerDNS silently drops NOTIFY for them,
   * so a secondary would never learn about changes. Zones must be Master
   * (primary=yes in pdns.conf) for AXFR/NOTIFY replication to actually work.
   */
  zoneKind?: "Master" | "Native";
  /** TSIG key name granted TSIG-ALLOW-AXFR on every provisioned zone. */
  axfrTsigKeyName?: string | null;
};

/**
 * Typed client for the PowerDNS authoritative HTTP API. All zone mutations go
 * through the API (never the backend database) so validation, DNSSEC
 * rectification, SOA serial management (SOA-EDIT-API) and secondary NOTIFY
 * behave the way PowerDNS documents them.
 */
export class PowerDnsApiClient {
  private readonly apiUrl: string;
  private readonly apiKey: string;
  private readonly serverId: string;
  private readonly defaultSoaContent: string;
  private readonly zoneKind: "Master" | "Native";
  private readonly axfrTsigKeyName: string | null;

  constructor(config: PowerDnsApiClientConfig) {
    this.apiUrl = config.apiUrl.replace(/\/+$/, "");
    this.apiKey = config.apiKey;
    this.serverId = config.serverId ?? "localhost";
    this.defaultSoaContent = config.defaultSoaContent;
    this.zoneKind = config.zoneKind ?? "Master";
    this.axfrTsigKeyName = config.axfrTsigKeyName ?? null;
  }

  async getZoneByName(zoneName: string): Promise<PowerDnsZoneSnapshot | null> {
    const response = await this.request("GET", this.zonePath(zoneName));
    if (response.status === 404) {
      return null;
    }
    await assertOk(response, `get zone ${zoneName}`);
    return toSnapshot(await response.json() as ApiZone);
  }

  /**
   * Idempotently create or converge a zone. Every managed rrset (NS, glue,
   * apex/profile/wildcard A, plus caller-supplied extras such as a TXT
   * challenge) is applied in a single zone creation or a single PATCH, so
   * observers never see a partially-published zone. The SOA is only written at
   * creation; afterwards SOA-EDIT-API owns serial management.
   */
  async ensureZone(input: EnsureZoneInput): Promise<EnsureZoneResult> {
    const zoneName = canonical(input.zoneName);
    const rrsets = buildManagedRrsets(input);
    let created = false;
    let existing = await this.getZoneByName(zoneName);

    if (!existing) {
      const response = await this.request("POST", `/servers/${this.serverId}/zones`, {
        name: zoneName,
        kind: this.zoneKind,
        soa_edit_api: "DEFAULT",
        rrsets: [
          {
            name: zoneName,
            type: "SOA",
            ttl: input.ttl,
            changetype: "REPLACE",
            records: [{ content: canonicalSoaContent(this.defaultSoaContent), disabled: false }],
          },
          ...rrsets,
        ],
      });

      if (response.status === 409) {
        // Lost a creation race — converge via PATCH below.
        existing = await this.getZoneByName(zoneName);
        if (!existing) {
          throw new Error(`zone ${zoneName} conflicted on create but cannot be fetched`);
        }
      } else {
        await assertOk(response, `create zone ${zoneName}`);
        created = true;
      }
    }

    if (!created) {
      const response = await this.request("PATCH", this.zonePath(zoneName), { rrsets });
      await assertOk(response, `patch zone ${zoneName}`);
    }

    // Converge AXFR authorization on EVERY ensure, not only first creation.
    // Recovered zones, 409 creation races, and retries after a metadata failure
    // must all repair TSIG-ALLOW-AXFR instead of remaining silently
    // unreplicated forever.
    if (this.axfrTsigKeyName) {
      const metadata = await this.request(
        "PUT",
        `${this.zonePath(zoneName)}/metadata/TSIG-ALLOW-AXFR`,
        { kind: "TSIG-ALLOW-AXFR", metadata: [this.axfrTsigKeyName] },
      );
      await assertOk(metadata, `grant TSIG-ALLOW-AXFR on ${zoneName}`);
    }

    const zone = await this.getZoneByName(zoneName);
    if (!zone) {
      throw new Error(`zone ${zoneName} missing after write`);
    }

    if (zone.dnssec) {
      const response = await this.request("PUT", `${this.zonePath(zoneName)}/rectify`);
      await assertOk(response, `rectify zone ${zoneName}`);
    }

    // PowerDNS accepts /notify on Native zones but silently does nothing, so
    // only notify when the zone is actually a primary.
    if (this.zoneKind === "Master") {
      const notifyResponse = await this.request("PUT", `${this.zonePath(zoneName)}/notify`);
      await assertOk(notifyResponse, `notify zone ${zoneName}`);
    }

    return { zone, created };
  }

  private zonePath(zoneName: string): string {
    return `/servers/${this.serverId}/zones/${encodeURIComponent(canonical(zoneName))}`;
  }

  private async request(method: string, path: string, body?: unknown): Promise<Response> {
    return fetch(`${this.apiUrl}/api/v1${path}`, {
      method,
      headers: {
        "x-api-key": this.apiKey,
        accept: "application/json",
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  }
}

function buildManagedRrsets(input: EnsureZoneInput) {
  const zoneName = canonical(input.zoneName);
  const rrsets: PowerDnsRrsetInput[] = [
    {
      name: zoneName,
      type: "NS",
      ttl: input.ttl,
      records: input.nameservers.map(canonical),
    },
  ];

  if (input.nameserverIpv4) {
    for (const nameserver of input.nameservers.map(canonical)) {
      if (nameserver === zoneName || nameserver.endsWith(`.${zoneName}`)) {
        rrsets.push({ name: nameserver, type: "A", ttl: input.ttl, records: [input.nameserverIpv4] });
      }
    }
  }
  if (input.apexIpv4) {
    rrsets.push({ name: zoneName, type: "A", ttl: input.ttl, records: [input.apexIpv4] });
  }
  if (input.profileIpv4) {
    rrsets.push({ name: `profile.${zoneName}`, type: "A", ttl: input.ttl, records: [input.profileIpv4] });
  }
  if (input.wildcardIpv4) {
    rrsets.push({ name: `*.${zoneName}`, type: "A", ttl: input.ttl, records: [input.wildcardIpv4] });
  }
  for (const extra of input.extraRrsets ?? []) {
    rrsets.push({ ...extra, name: canonical(extra.name) });
  }

  return rrsets.map((rrset) => ({
    name: rrset.name,
    type: rrset.type,
    ttl: rrset.ttl,
    changetype: "REPLACE" as const,
    records: rrset.records.map((content) => ({ content, disabled: false })),
  }));
}

function toSnapshot(zone: ApiZone): PowerDnsZoneSnapshot {
  const rrsets: PowerDnsRrsetSummary[] = (zone.rrsets ?? []).map((rrset) => ({
    // Names are exposed without the trailing dot to match how callers compare
    // against normalized challenge/zone names.
    name: stripTrailingDot(rrset.name),
    type: rrset.type,
    ttl: rrset.ttl ?? null,
    records: rrset.records.filter((record) => !record.disabled).map((record) => record.content),
  }));

  const zoneStorageName = stripTrailingDot(zone.name);
  const nameservers = rrsets
    .filter((rrset) => rrset.name === zoneStorageName && rrset.type === "NS")
    .flatMap((rrset) => rrset.records);

  return {
    name: zoneStorageName,
    serial: zone.serial ?? 0,
    dnssec: zone.dnssec ?? false,
    nameservers,
    rrsets,
  };
}

async function assertOk(response: Response, action: string): Promise<void> {
  if (response.ok) {
    return;
  }
  let detail = "";
  try {
    const body = await response.json() as { error?: string };
    detail = body.error ?? "";
  } catch {
    // non-JSON error body
  }
  throw new Error(`PowerDNS API ${action} failed with status ${response.status}${detail ? `: ${detail}` : ""}`);
}

// The API validates SOA content strictly: MNAME and RNAME must be canonical
// (trailing dot). Legacy configs carry unqualified names that the old direct
// SQLite writes accepted without validation.
function canonicalSoaContent(value: string): string {
  const fields = value.trim().split(/\s+/);
  if (fields.length < 2) {
    return value;
  }
  return [canonical(fields[0]!), canonical(fields[1]!), ...fields.slice(2)].join(" ");
}

function canonical(value: string): string {
  return value.endsWith(".") ? value : `${value}.`;
}

function stripTrailingDot(value: string): string {
  return value.replace(/\.$/, "");
}
