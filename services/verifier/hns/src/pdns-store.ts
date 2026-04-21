import { Database } from "bun:sqlite";

type DomainRow = {
  id: number;
  name: string;
  type: string;
};

type RecordRow = {
  id: number;
  name: string;
  type: string;
  content: string;
  ttl: number | null;
};

export type PowerDnsRrsetSummary = {
  name: string;
  type: string;
  ttl: number | null;
  records: string[];
};

export type PowerDnsZoneSnapshot = {
  domain: DomainRow;
  nameservers: string[];
  rrsets: PowerDnsRrsetSummary[];
};

export type EnsureZoneInput = {
  zoneName: string;
  nameservers: string[];
  nameserverIpv4?: string | null;
  apexIpv4?: string | null;
  profileIpv4?: string | null;
  wildcardIpv4?: string | null;
  ttl: number;
};

export type EnsureZoneResult = {
  zone: PowerDnsZoneSnapshot;
  created: boolean;
};

export class PowerDnsStore {
  constructor(
    private readonly databasePath: string,
    private readonly defaultSoaContent: string,
  ) {}

  getZoneByName(zoneName: string): PowerDnsZoneSnapshot | null {
    const db = this.open();
    try {
      return this.getZoneSnapshot(db, zoneName);
    } finally {
      db.close();
    }
  }

  ensureZone(input: EnsureZoneInput): EnsureZoneResult {
    const db = this.open();
    try {
      let snapshot = this.getZoneSnapshot(db, input.zoneName);
      let created = false;

      if (!snapshot) {
        this.insertDomain(db, input.zoneName);
        created = true;
      }

      const domain = this.requireDomain(db, input.zoneName);

      this.replaceRecordSetForDomain(db, domain.id, input.zoneName, "SOA", input.ttl, [this.defaultSoaContent]);
      this.replaceRecordSetForDomain(db, domain.id, input.zoneName, "NS", input.ttl, input.nameservers);

      if (input.nameserverIpv4) {
        const zoneStorageName = toStorageName(input.zoneName);
        for (const nameserver of input.nameservers) {
          const normalizedNameserver = toStorageName(nameserver);
          if (normalizedNameserver === zoneStorageName || normalizedNameserver.endsWith(`.${zoneStorageName}`)) {
            this.replaceRecordSetForDomain(db, domain.id, normalizedNameserver, "A", input.ttl, [input.nameserverIpv4]);
          }
        }
      }

      if (input.apexIpv4) {
        this.replaceRecordSetForDomain(db, domain.id, input.zoneName, "A", input.ttl, [input.apexIpv4]);
      }
      if (input.profileIpv4) {
        this.replaceRecordSetForDomain(db, domain.id, `profile.${input.zoneName}`, "A", input.ttl, [input.profileIpv4]);
      }
      if (input.wildcardIpv4) {
        this.replaceRecordSetForDomain(db, domain.id, `*.${input.zoneName}`, "A", input.ttl, [input.wildcardIpv4]);
      }

      snapshot = this.requireZoneSnapshot(db, input.zoneName);
      return { zone: snapshot, created };
    } finally {
      db.close();
    }
  }

  replaceRecordSet(zoneName: string, name: string, type: string, ttl: number, contents: string[]) {
    const db = this.open();
    try {
      const domain = this.requireDomain(db, zoneName);
      this.replaceRecordSetForDomain(db, domain.id, name, type, ttl, contents);
    } finally {
      db.close();
    }
  }

  private open(): Database {
    return new Database(this.databasePath, {
      create: false,
      strict: true,
    });
  }

  private insertDomain(db: Database, zoneName: string) {
    db.query(
      `INSERT INTO domains (name, type) VALUES (?, 'NATIVE')`,
    ).run(toStorageName(zoneName));
  }

  private requireDomain(db: Database, zoneName: string): DomainRow {
    const domain = db.query(
      `SELECT id, name, type FROM domains WHERE name = ? COLLATE NOCASE LIMIT 1`,
    ).get(toStorageName(zoneName)) as DomainRow | null;

    if (!domain) {
      throw new Error(`zone not found: ${zoneName}`);
    }

    return domain;
  }

  private getZoneSnapshot(db: Database, zoneName: string): PowerDnsZoneSnapshot | null {
    const domain = db.query(
      `SELECT id, name, type FROM domains WHERE name = ? COLLATE NOCASE LIMIT 1`,
    ).get(toStorageName(zoneName)) as DomainRow | null;

    if (!domain) {
      return null;
    }

    const records = db.query(
      `SELECT id, name, type, content, ttl
       FROM records
       WHERE domain_id = ?
       ORDER BY name ASC, type ASC, id ASC`,
    ).all(domain.id) as RecordRow[];

    const grouped = new Map<string, PowerDnsRrsetSummary>();
    for (const record of records) {
      const key = `${record.name}|${record.type}`;
      const existing = grouped.get(key);
      if (existing) {
        existing.records.push(record.content);
        continue;
      }
      grouped.set(key, {
        name: record.name,
        type: record.type,
        ttl: record.ttl ?? null,
        records: [record.content],
      });
    }

    const rrsets = [...grouped.values()];
    const nameservers = rrsets
      .filter((rrset) => rrset.name === toStorageName(zoneName) && rrset.type === "NS")
      .flatMap((rrset) => rrset.records);

    return {
      domain,
      nameservers,
      rrsets,
    };
  }

  private requireZoneSnapshot(db: Database, zoneName: string): PowerDnsZoneSnapshot {
    const snapshot = this.getZoneSnapshot(db, zoneName);
    if (!snapshot) {
      throw new Error(`zone not found: ${zoneName}`);
    }
    return snapshot;
  }

  private replaceRecordSetForDomain(db: Database, domainId: number, name: string, type: string, ttl: number, contents: string[]) {
    const normalizedName = toStorageName(name);
    const normalizedContents = contents.map((content) => type === "NS" ? toStorageName(content) : content);

    const replace = db.transaction((currentDomainId: number, currentName: string, currentType: string, currentTtl: number, currentContents: string[]) => {
      db.query(
        `DELETE FROM records WHERE domain_id = ? AND name = ? AND type = ?`,
      ).run(currentDomainId, currentName, currentType);

      const insert = db.query(
        `INSERT INTO records (domain_id, name, type, content, ttl, prio, disabled, ordername, auth)
         VALUES (?, ?, ?, ?, ?, NULL, 0, NULL, 1)`,
      );

      for (const content of currentContents) {
        insert.run(currentDomainId, currentName, currentType, content, currentTtl);
      }
    });

    replace(domainId, normalizedName, type, ttl, normalizedContents);
  }
}

function toStorageName(value: string): string {
  return value.replace(/\.$/, "");
}
