import { describe, expect, test } from "bun:test";
import {
  buildTrustAnchorFile,
  observeRootAuthority,
  parseDigSoaSerial,
  parseValidatedDelvOutput,
  type CommandRunner,
} from "./root-authority-observation";

describe("HNS root authority observation", () => {
  test("parses fully validated RRSIG expirations", () => {
    expect(parseValidatedDelvOutput(`
; fully validated
pirate. 300 IN SOA ns1.pirate. dns.pirate. 42 3600 900 1209600 300
pirate. 300 IN RRSIG SOA 13 1 300 20260823010000 20260723010000 12345 pirate. signature
pirate. 300 IN RRSIG SOA 13 1 300 20260822010000 20260723010000 54321 pirate. signature
    `)).toEqual({
      fullyValidated: true,
      rrsigExpirations: [
        "2026-08-22T01:00:00.000Z",
        "2026-08-23T01:00:00.000Z",
      ],
    });
  });

  test("does not promote signed output without delv validation", () => {
    expect(parseValidatedDelvOutput(`
; unsigned answer
pirate. 300 IN RRSIG SOA 13 1 300 20260823010000 20260723010000 12345 pirate. signature
    `).fullyValidated).toBe(false);
  });

  test("builds a root-scoped static DS trust anchor", () => {
    expect(buildTrustAnchorFile("pirate", [{
      key_tag: 12345,
      algorithm: 13,
      digest_type: 2,
      digest: "aa".repeat(32),
    }])).toBe(`trust-anchors {
  "pirate." static-ds 12345 13 2 "${"AA".repeat(32)}";
};
`);
  });

  test("parses SOA serials and ignores empty answers", () => {
    expect(parseDigSoaSerial(
      "pirate. 300 IN SOA ns1.pirate. dns.pirate. 2026072301 3600 900 1209600 300\n",
    )).toBe("2026072301");
    expect(parseDigSoaSerial("; no answer\n")).toBeNull();
  });

  test("requires validated RRsets and two reachable serial-matched authorities", async () => {
    const calls: string[][] = [];
    const runner: CommandRunner = async (command, args) => {
      calls.push([command, ...args]);
      if (command === "/usr/bin/delv") {
        const type = args.at(-2);
        return {
          exitCode: 0,
          stderr: "",
          stdout: `; fully validated
pirate. 300 IN ${type} value
pirate. 300 IN RRSIG ${type} 13 1 300 20260823010000 20260723010000 12345 pirate. signature
`,
        };
      }
      return {
        exitCode: 0,
        stderr: "",
        stdout: "pirate. 300 IN SOA ns1.pirate. dns.pirate. 42 3600 900 1209600 300\n",
      };
    };

    const result = await observeRootAuthority({
      rootLabel: "pirate",
      anchors: [{
        key_tag: 12345,
        algorithm: 13,
        digest_type: 2,
        digest: "aa".repeat(32),
      }],
      requiredRrsets: [
        { name: "pirate.", type: "DNSKEY" },
        { name: "pirate.", type: "SOA" },
      ],
      authorities: [
        { nameserver: "ns1.pirate.", addresses: ["192.0.2.1"] },
        { nameserver: "ns2.pirate.", addresses: ["192.0.2.2"] },
      ],
      config: {
        delvBin: "/usr/bin/delv",
        digBin: "/usr/bin/dig",
        resolverAddress: "127.0.0.1",
        resolverPort: 5350,
        timeoutMs: 10_000,
      },
    }, runner);

    expect(result.authoritative_dnssec_valid).toBe(true);
    expect(result.earliest_rrsig_expires_at).toBe("2026-08-23T01:00:00.000Z");
    expect(result.authority_redundancy_ok).toBe(true);
    expect(result.authorities).toEqual([
      {
        nameserver: "ns1.pirate.",
        reachable: true,
        soa_serial: "42",
        failure_code: null,
        serial_in_sync: true,
      },
      {
        nameserver: "ns2.pirate.",
        reachable: true,
        soa_serial: "42",
        failure_code: null,
        serial_in_sync: true,
      },
    ]);
    expect(calls.filter(([command]) => command === "/usr/bin/delv")).toHaveLength(2);
    expect(calls.filter(([command]) => command === "/usr/bin/dig")).toHaveLength(2);
  });

  test("reports missing glue as unhealthy redundancy without inventing a DNSSEC result", async () => {
    const runner: CommandRunner = async (command) => command.endsWith("delv")
      ? {
          exitCode: 0,
          stderr: "",
          stdout: `; fully validated
pirate. 300 IN RRSIG SOA 13 1 300 20260823010000 20260723010000 12345 pirate. signature
`,
        }
      : { exitCode: 1, stdout: "", stderr: "unreachable" };
    const result = await observeRootAuthority({
      rootLabel: "pirate",
      anchors: [{ key_tag: 12345, algorithm: 13, digest_type: 2, digest: "aa".repeat(32) }],
      requiredRrsets: [{ name: "pirate.", type: "SOA" }],
      authorities: [
        { nameserver: "ns1.pirate.", addresses: ["192.0.2.1"] },
        { nameserver: "ns2.pirate.", addresses: [] },
      ],
      config: {
        delvBin: "/usr/bin/delv",
        digBin: "/usr/bin/dig",
        resolverAddress: "127.0.0.1",
        resolverPort: 5350,
        timeoutMs: 10_000,
      },
    }, runner);

    expect(result.authoritative_dnssec_valid).toBe(true);
    expect(result.authority_redundancy_ok).toBe(false);
    expect(result.authorities[1]).toMatchObject({
      reachable: false,
      failure_code: "missing_parent_glue",
      serial_in_sync: null,
    });
  });
});
