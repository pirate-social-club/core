type PowerDnsRecord = {
  content: string;
  disabled?: boolean;
};

type PowerDnsRrset = {
  name: string;
  type: string;
  ttl?: number;
  changetype?: "REPLACE" | "DELETE" | "EXTEND" | "PRUNE";
  records?: PowerDnsRecord[];
};

export type PowerDnsZone = {
  id: string;
  name: string;
  kind: string;
  nameservers?: string[];
  rrsets?: PowerDnsRrset[];
};

type PowerDnsError = {
  error?: string;
  errors?: string[];
  message?: string;
};

export type EnsureZoneInput = {
  zoneName: string;
  nameservers: string[];
  apexIpv4?: string | null;
  profileIpv4?: string | null;
  wildcardIpv4?: string | null;
  ttl: number;
};

export type EnsureZoneResult = {
  zone: PowerDnsZone;
  created: boolean;
};

export class PowerDnsClient {
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
    private readonly serverId: string,
  ) {}

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetch(`${this.baseUrl}/servers/${encodeURIComponent(this.serverId)}${path}`, {
      ...init,
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        "x-api-key": this.apiKey,
        ...(init?.headers ?? {}),
      },
    });

    if (response.status === 204) {
      return undefined as T;
    }

    const text = await response.text();
    const parsed = text.length > 0 ? JSON.parse(text) as T | PowerDnsError : null;

    if (!response.ok) {
      const body = parsed as PowerDnsError | null;
      const message = body?.error
        ?? body?.message
        ?? body?.errors?.join("; ")
        ?? `PowerDNS API request failed with status ${response.status}`;
      throw new Error(message);
    }

    return parsed as T;
  }

  async getZoneByName(zoneName: string): Promise<PowerDnsZone | null> {
    const zones = await this.request<PowerDnsZone[]>(`/zones?zone=${encodeURIComponent(zoneName)}`);
    return zones[0] ?? null;
  }

  async getZone(zoneId: string, options?: { rrsetName?: string; rrsetType?: string }): Promise<PowerDnsZone> {
    const params = new URLSearchParams({ rrsets: "true" });
    if (options?.rrsetName) {
      params.set("rrset_name", options.rrsetName);
    }
    if (options?.rrsetType) {
      params.set("rrset_type", options.rrsetType);
    }
    return this.request<PowerDnsZone>(`/zones/${encodeURIComponent(zoneId)}?${params.toString()}`);
  }

  async createZone(zoneName: string, nameservers: string[]): Promise<PowerDnsZone> {
    return this.request<PowerDnsZone>("/zones", {
      method: "POST",
      body: JSON.stringify({
        name: zoneName,
        kind: "Native",
        masters: [],
        nameservers,
      }),
    });
  }

  async patchZone(zoneId: string, rrsets: PowerDnsRrset[]): Promise<void> {
    await this.request<void>(`/zones/${encodeURIComponent(zoneId)}`, {
      method: "PATCH",
      body: JSON.stringify({ rrsets }),
    });
  }

  async replaceRecordSet(zoneId: string, name: string, type: string, ttl: number, contents: string[]): Promise<void> {
    await this.patchZone(zoneId, [
      {
        name,
        type,
        ttl,
        changetype: "REPLACE",
        records: contents.map((content) => ({ content, disabled: false })),
      },
    ]);
  }

  async ensureZone(input: EnsureZoneInput): Promise<EnsureZoneResult> {
    let zone = await this.getZoneByName(input.zoneName);
    let created = false;

    if (!zone) {
      zone = await this.createZone(input.zoneName, input.nameservers);
      created = true;
    }

    const rrsets: PowerDnsRrset[] = [];
    if (input.apexIpv4) {
      rrsets.push(recordSet(input.zoneName, "A", input.ttl, [input.apexIpv4]));
    }
    if (input.profileIpv4) {
      rrsets.push(recordSet(`profile.${input.zoneName}`, "A", input.ttl, [input.profileIpv4]));
    }
    if (input.wildcardIpv4) {
      rrsets.push(recordSet(`*.${input.zoneName}`, "A", input.ttl, [input.wildcardIpv4]));
    }

    if (rrsets.length > 0) {
      await this.patchZone(zone.id, rrsets);
      zone = await this.getZone(zone.id);
    }

    return { zone, created };
  }
}

function recordSet(name: string, type: string, ttl: number, contents: string[]): PowerDnsRrset {
  return {
    name,
    type,
    ttl,
    changetype: "REPLACE",
    records: contents.map((content) => ({ content, disabled: false })),
  };
}
