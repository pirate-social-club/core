import { writeFile } from "node:fs/promises";

import { PowerDnsApiClient } from "../../../services/verifier/hns/src/pdns-store";

const phase = process.argv[2];
if (phase !== "initial" && phase !== "update") {
  throw new Error("usage: bun provision-zone.ts initial|update");
}

const apiKey = Bun.env.PDNS_API_KEY?.trim() || "local-pdns-api-key";
const client = new PowerDnsApiClient({
  apiUrl: Bun.env.PDNS_API_URL?.trim() || "http://primary:8081",
  apiKey,
  defaultSoaContent: "ns1.pirate. dns.pirate. 0 3600 900 1209600 300",
  zoneKind: "Master",
  axfrTsigKeyName: "pirate-axfr",
  secureNewZones: true,
});

const result = await client.ensureZone({
  zoneName: "crew.",
  nameservers: ["ns1.pirate.", "ns2.pirate."],
  apexIpv4: "192.0.2.80",
  profileIpv4: "192.0.2.80",
  wildcardIpv4: "192.0.2.80",
  ttl: 60,
  extraRrsets: [
    {
      name: "_pirate.crew.",
      type: "TXT",
      ttl: 60,
      records: [`"local-replication=${phase}"`],
    },
    { name: "app.crew.", type: "A", ttl: 60, records: ["192.0.2.80"] },
    { name: "api.crew.", type: "A", ttl: 60, records: ["192.0.2.80"] },
  ],
});

if (!result.zone.dnssec || result.dsRecords.length === 0) {
  throw new Error("local zone was not DNSSEC-signed or did not return DS material");
}

console.log(JSON.stringify({
  phase,
  created: result.created,
  serial: result.zone.serial,
  ds_records: result.dsRecords,
}));

const dsPath = Bun.env.HNS_LOCAL_DS_PATH?.trim();
if (dsPath) {
  // DS records are public parent-zone material; keep the harness artifact
  // host-readable even when the Bun container uid differs from the runner.
  await writeFile(dsPath, `${result.dsRecords.join("\n")}\n`, { mode: 0o644 });
}
