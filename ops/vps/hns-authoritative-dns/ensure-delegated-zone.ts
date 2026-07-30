import { PowerDnsApiClient } from "../../../services/verifier/hns/src/pdns-store";
import { parseDaneEeAssociations } from "../../../services/verifier/hns/src/tlsa";

function required(name: string): string {
  const value = Bun.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

function canonicalZone(value: string): string {
  const zone = value.trim().toLowerCase().replace(/\.+$/u, "");
  const labels = zone.split(".");
  if (
    labels.length < 2
    || labels.some((label) => (
      !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u.test(label)
    ))
  ) {
    throw new Error("zone must be a canonical delegated DNS name with at least two labels");
  }
  return `${zone}.`;
}

function csv(name: string): string[] {
  return required(name).split(",").map((entry) => entry.trim()).filter(Boolean);
}

const zoneName = canonicalZone(Bun.argv[2] ?? "");
const ttl = Number(Bun.env.HNS_AUTHORITATIVE_TTL || "300");
const tlsaTtl = Number(Bun.env.HNS_AUTHORITATIVE_TLSA_TTL || ttl);
const apexIpv4 = required("HNS_AUTHORITATIVE_APEX_IPV4");

if (!Number.isSafeInteger(ttl) || ttl < 60 || ttl > 86_400) {
  throw new Error("HNS_AUTHORITATIVE_TTL must be between 60 and 86400");
}
if (!Number.isSafeInteger(tlsaTtl) || tlsaTtl < 60 || tlsaTtl > 86_400) {
  throw new Error("HNS_AUTHORITATIVE_TLSA_TTL must be between 60 and 86400");
}

const store = new PowerDnsApiClient({
  apiUrl: required("PDNS_API_URL"),
  apiKey: required("PDNS_API_KEY"),
  defaultSoaContent: required("PDNS_DEFAULT_SOA_CONTENT"),
  zoneKind: Bun.env.PDNS_ZONE_KIND?.trim() === "Native" ? "Native" : "Master",
  axfrTsigKeyName: Bun.env.PDNS_AXFR_TSIG_KEY_NAME?.trim() || null,
  secureNewZones: Bun.env.PDNS_SECURE_NEW_ZONES?.trim().toLowerCase() === "true",
});

const ensured = await store.ensureZone({
  zoneName,
  nameservers: csv("HNS_AUTHORITATIVE_NAMESERVERS"),
  nameserverIpv4: Bun.env.HNS_AUTHORITATIVE_NAMESERVER_IPV4?.trim() || apexIpv4,
  apexIpv4,
  profileIpv4: Bun.env.HNS_AUTHORITATIVE_PROFILE_IPV4?.trim() || apexIpv4,
  wildcardIpv4: Bun.env.HNS_AUTHORITATIVE_WILDCARD_IPV4?.trim() || apexIpv4,
  ttl,
  tlsaAssociations: parseDaneEeAssociations(
    required("HNS_AUTHORITATIVE_TLSA_ASSOCIATIONS"),
  ),
  tlsaTtl,
});

console.log(JSON.stringify({
  zone_name: zoneName,
  zone_created: ensured.created,
  dnssec: ensured.zone.dnssec,
  ds_records: ensured.dsRecords,
  rrsets: ensured.zone.rrsets,
}, null, 2));
