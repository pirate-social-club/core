import { describe, expect, test } from "bun:test";

import {
  buildManagedTlsaRrsets,
  deriveExplicitWebHosts,
  normalizeDaneEeAssociation,
  parseDaneEeAssociations,
} from "./tlsa";

const HASH_A = "A".repeat(64);
const HASH_B = "B".repeat(64);

describe("HNS TLSA helpers", () => {
  test("accepts only DANE-EE SPKI SHA-256 associations", () => {
    expect(normalizeDaneEeAssociation(`3 1 1 ${HASH_A.toLowerCase()}`)).toBe(`3 1 1 ${HASH_A}`);
    expect(() => normalizeDaneEeAssociation(`2 0 1 ${HASH_A}`)).toThrow("DANE-EE");
    expect(() => normalizeDaneEeAssociation("3 1 1 short")).toThrow("64 hex");
  });

  test("deduplicates configured associations for rollover overlap", () => {
    expect(parseDaneEeAssociations(`3 1 1 ${HASH_A}, 3 1 1 ${HASH_B}, 3 1 1 ${HASH_A}`)).toEqual([
      `3 1 1 ${HASH_A}`,
      `3 1 1 ${HASH_B}`,
    ]);
  });

  test("publishes apex and wildcard TLSA without inventing explicit host nodes", () => {
    const rrsets = buildManagedTlsaRrsets({
      zoneName: "pirate",
      ttl: 300,
      associations: [`3 1 1 ${HASH_A}`],
    });

    expect(rrsets.map((rrset) => rrset.name)).toEqual([
      "*.pirate.",
      "_443._tcp.pirate.",
    ]);
    expect(rrsets.every((rrset) => rrset.records[0] === `3 1 1 ${HASH_A}`)).toBe(true);
    expect(rrsets.some((rrset) => rrset.name.includes("app.pirate"))).toBe(false);
  });

  test("adds explicit TLSA only for concrete web nodes already in the zone", () => {
    const explicitHosts = deriveExplicitWebHosts({
      name: "pirate",
      serial: 1,
      dnssec: true,
      nameservers: ["ns1.pirate."],
      rrsets: [
        { name: "pirate", type: "A", ttl: 300, records: ["203.0.113.10"] },
        { name: "*.pirate", type: "A", ttl: 300, records: ["203.0.113.10"] },
        { name: "profile.pirate", type: "A", ttl: 300, records: ["203.0.113.10"] },
        { name: "app.pirate", type: "AAAA", ttl: 300, records: ["2001:db8::10"] },
        { name: "ns1.pirate", type: "A", ttl: 300, records: ["203.0.113.53"] },
        { name: "_pirate.pirate", type: "TXT", ttl: 300, records: ['"health"'] },
      ],
    });

    expect(explicitHosts).toEqual(["app.pirate", "profile.pirate"]);
    expect(buildManagedTlsaRrsets({
      zoneName: "pirate.",
      ttl: 300,
      associations: [`3 1 1 ${HASH_A}`],
      explicitWebHosts: explicitHosts,
    }).map((rrset) => rrset.name)).toEqual([
      "*.pirate.",
      "_443._tcp.app.pirate.",
      "_443._tcp.pirate.",
      "_443._tcp.profile.pirate.",
    ]);
  });

  test("rejects explicit hosts outside the zone or wildcard pseudo-hosts", () => {
    expect(() => buildManagedTlsaRrsets({
      zoneName: "pirate",
      ttl: 300,
      associations: [`3 1 1 ${HASH_A}`],
      explicitWebHosts: ["app.example"],
    })).toThrow("inside pirate");
    expect(() => buildManagedTlsaRrsets({
      zoneName: "pirate",
      ttl: 300,
      associations: [`3 1 1 ${HASH_A}`],
      explicitWebHosts: ["*.pirate"],
    })).toThrow("concrete name");
  });
});
