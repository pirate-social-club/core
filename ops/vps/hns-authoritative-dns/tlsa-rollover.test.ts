import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type {
  PowerDnsRrsetMutation,
  PowerDnsZoneSnapshot,
} from "../../../services/verifier/hns/src/pdns-store";
import {
  acquireTlsaStateLock,
  assertTlsaRolloverReady,
  buildConvergentTlsaMutations,
  prepareInitialTlsa,
  prepareTlsaRollover,
  recordTlsaGatewayActivation,
  retireTlsaRollover,
  type TlsaRolloverStore,
} from "./tlsa-rollover";

const HASH_A = "A".repeat(64);
const HASH_B = "B".repeat(64);
const ASSOCIATION_A = `3 1 1 ${HASH_A}`;
const ASSOCIATION_B = `3 1 1 ${HASH_B}`;
const cleanupPaths: string[] = [];

afterEach(async () => {
  await Promise.all(cleanupPaths.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

class FakeStore implements TlsaRolloverStore {
  readonly writes: { zone: string; rrsets: PowerDnsRrsetMutation[] }[] = [];

  constructor(readonly zones: Map<string, PowerDnsZoneSnapshot>) {}

  async listZoneNames(): Promise<string[]> {
    return [...this.zones.keys()].sort();
  }

  async getZoneByName(name: string): Promise<PowerDnsZoneSnapshot | null> {
    return this.zones.get(canonical(name)) ?? null;
  }

  async mutateRrsets(name: string, rrsets: PowerDnsRrsetMutation[]): Promise<PowerDnsZoneSnapshot> {
    const zoneName = canonical(name);
    const zone = this.zones.get(zoneName);
    if (!zone) throw new Error("missing fake zone");
    this.writes.push({ zone: zoneName, rrsets });
    for (const mutation of rrsets) {
      const owner = stripDot(mutation.name);
      zone.rrsets = zone.rrsets.filter((entry) => !(entry.type === mutation.type && entry.name === owner));
      if (mutation.changetype !== "DELETE") {
        zone.rrsets.push({
          name: owner,
          type: mutation.type,
          ttl: mutation.ttl,
          records: [...mutation.records],
        });
      }
    }
    return zone;
  }
}

function signedZone(name = "crew."): PowerDnsZoneSnapshot {
  const storageName = stripDot(name);
  return {
    name: storageName,
    serial: 1,
    dnssec: true,
    nameservers: ["ns1.pirate."],
    rrsets: [
      { name: storageName, type: "A", ttl: 300, records: ["203.0.113.10"] },
      { name: `*.${storageName}`, type: "A", ttl: 300, records: ["203.0.113.10"] },
      { name: `profile.${storageName}`, type: "A", ttl: 300, records: ["203.0.113.10"] },
      { name: "ns1.pirate", type: "A", ttl: 300, records: ["203.0.113.53"] },
    ],
  };
}

async function statePath(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "pirate-tlsa-rollover-"));
  cleanupPaths.push(root);
  return join(root, "state.json");
}

describe("TLSA rollover", () => {
  test("serializes operator commands with an exclusive state lock", async () => {
    const path = await statePath();
    const release = await acquireTlsaStateLock(path);
    await expect(acquireTlsaStateLock(path)).rejects.toThrow("TLSA rollover is locked");
    await release();
    const releaseAgain = await acquireTlsaStateLock(path);
    await releaseAgain();
  });

  test("converges derived owners and deletes stale explicit TLSA nodes", () => {
    const zone = signedZone();
    zone.rrsets.push({
      name: "_443._tcp.removed.crew",
      type: "TLSA",
      ttl: 300,
      records: [ASSOCIATION_A],
    });

    const mutations = buildConvergentTlsaMutations({
      zone,
      associations: [ASSOCIATION_A, ASSOCIATION_B],
      ttl: 300,
    });
    expect(mutations.filter((entry) => entry.changetype !== "DELETE").map((entry) => entry.name)).toEqual([
      "*.crew.",
      "_443._tcp.crew.",
      "_443._tcp.profile.crew.",
    ]);
    expect(mutations.find((entry) => entry.changetype === "DELETE")?.name)
      .toBe("_443._tcp.removed.crew");
  });

  test("prepares overlap, enforces two TTLs, proves the served key, then retires", async () => {
    const zone = signedZone();
    zone.rrsets.push(
      { name: "*.crew", type: "TLSA", ttl: 300, records: [ASSOCIATION_A] },
      { name: "_443._tcp.crew", type: "TLSA", ttl: 300, records: [ASSOCIATION_A] },
      { name: "_443._tcp.profile.crew", type: "TLSA", ttl: 300, records: [ASSOCIATION_A] },
    );
    const store = new FakeStore(new Map([["crew.", zone]]));
    const path = await statePath();
    const preparedAt = new Date("2026-07-14T00:00:00.000Z");

    const prepared = await prepareTlsaRollover({
      store,
      statePath: path,
      currentAssociation: ASSOCIATION_A,
      nextAssociation: ASSOCIATION_B,
      configuredAssociations: [ASSOCIATION_A, ASSOCIATION_B],
      ttlSeconds: 300,
      now: preparedAt,
    });
    expect(prepared.readyAt).toBe("2026-07-14T00:10:00.000Z");
    expect(zone.rrsets.find((entry) => entry.name === "*.crew" && entry.type === "TLSA")?.records)
      .toEqual([ASSOCIATION_A, ASSOCIATION_B]);

    await expect(assertTlsaRolloverReady({
      store,
      statePath: path,
      configuredAssociations: [ASSOCIATION_A, ASSOCIATION_B],
      now: new Date("2026-07-14T00:09:59.999Z"),
    })).rejects.toThrow("not ready");

    await expect(assertTlsaRolloverReady({
      store,
      statePath: path,
      configuredAssociations: [ASSOCIATION_B],
      now: new Date("2026-07-14T00:10:00.000Z"),
    })).rejects.toThrow("retain the prepared overlap");

    await expect(retireTlsaRollover({
      store,
      statePath: path,
      servedAssociation: ASSOCIATION_A,
      configuredAssociations: [ASSOCIATION_B],
      now: new Date("2026-07-14T00:10:00.000Z"),
    })).rejects.toThrow("activation has not been proven");

    await expect(recordTlsaGatewayActivation({
      store,
      statePath: path,
      servedAssociation: ASSOCIATION_A,
      configuredAssociations: [ASSOCIATION_A, ASSOCIATION_B],
      now: new Date("2026-07-14T00:10:00.000Z"),
    })).rejects.toThrow("not serving");

    const activated = await recordTlsaGatewayActivation({
      store,
      statePath: path,
      servedAssociation: ASSOCIATION_B,
      configuredAssociations: [ASSOCIATION_A, ASSOCIATION_B],
      now: new Date("2026-07-14T00:10:00.000Z"),
    });
    expect(activated.phase).toBe("prepared");
    expect(activated.activatedAt).toBe("2026-07-14T00:10:00.000Z");

    await expect(retireTlsaRollover({
      store,
      statePath: path,
      servedAssociation: ASSOCIATION_A,
      configuredAssociations: [ASSOCIATION_B],
      now: new Date("2026-07-14T00:10:00.000Z"),
    })).rejects.toThrow("not serving");

    const retired = await retireTlsaRollover({
      store,
      statePath: path,
      servedAssociation: ASSOCIATION_B,
      configuredAssociations: [ASSOCIATION_B],
      now: new Date("2026-07-14T00:10:00.000Z"),
    });
    expect(retired.phase).toBe("retired");
    expect(zone.rrsets.find((entry) => entry.name === "*.crew" && entry.type === "TLSA")?.records)
      .toEqual([ASSOCIATION_B]);
  });

  test("bootstraps a dark edge without fabricating a previous certificate", async () => {
    const zone = signedZone();
    const store = new FakeStore(new Map([["crew.", zone]]));
    const path = await statePath();

    const state = await prepareInitialTlsa({
      store,
      statePath: path,
      association: ASSOCIATION_B,
      configuredAssociations: [ASSOCIATION_B],
      ttlSeconds: 60,
      now: new Date("2026-07-14T00:00:00.000Z"),
    });
    expect(state.currentAssociation).toBeNull();
    expect(state.readyAt).toBe("2026-07-14T00:02:00.000Z");

    await recordTlsaGatewayActivation({
      store,
      statePath: path,
      servedAssociation: ASSOCIATION_B,
      configuredAssociations: [ASSOCIATION_B],
      now: new Date("2026-07-14T00:02:00.000Z"),
    });

    const retired = await retireTlsaRollover({
      store,
      statePath: path,
      servedAssociation: ASSOCIATION_B,
      configuredAssociations: [ASSOCIATION_B],
      now: new Date("2026-07-14T00:02:00.000Z"),
    });
    expect(retired.phase).toBe("retired");
  });

  test("creates a private parent directory for rollover state", async () => {
    const root = await mkdtemp(join(tmpdir(), "pirate-tlsa-parent-"));
    cleanupPaths.push(root);
    const path = join(root, "nested", "state.json");
    const store = new FakeStore(new Map([["crew.", signedZone()]]));

    const state = await prepareInitialTlsa({
      store,
      statePath: path,
      association: ASSOCIATION_A,
      configuredAssociations: [ASSOCIATION_A],
      ttlSeconds: 60,
      now: new Date("2026-07-14T00:00:00.000Z"),
    });

    expect(state.phase).toBe("prepared");
    expect(await Bun.file(path).json()).toEqual(state);
    expect((await stat(join(root, "nested"))).mode & 0o777).toBe(0o700);
    expect((await stat(path)).mode & 0o777).toBe(0o600);
  });

  test("fails closed on malformed state instead of bypassing the overlap deadline", async () => {
    const path = await statePath();
    await writeFile(path, JSON.stringify({
      version: 1,
      phase: "prepared",
      currentAssociation: null,
      nextAssociation: ASSOCIATION_A,
      ttlSeconds: 60,
      preparedAt: "2026-07-14T00:00:00.000Z",
      readyAt: "not-a-date",
      zones: ["crew"],
    }));

    await expect(assertTlsaRolloverReady({
      store: new FakeStore(new Map([["crew.", signedZone()]])),
      statePath: path,
      configuredAssociations: [ASSOCIATION_A],
      now: new Date("2026-07-14T00:00:00.000Z"),
    })).rejects.toThrow("invalid readyAt");
  });

  test("resumes retirement when an earlier attempt already retired one zone", async () => {
    const first = signedZone("crew.");
    const second = signedZone("fleet.");
    for (const zone of [first, second]) {
      zone.rrsets.push(
        { name: `*.${zone.name}`, type: "TLSA", ttl: 60, records: [ASSOCIATION_A] },
        { name: `_443._tcp.${zone.name}`, type: "TLSA", ttl: 60, records: [ASSOCIATION_A] },
        { name: `_443._tcp.profile.${zone.name}`, type: "TLSA", ttl: 60, records: [ASSOCIATION_A] },
      );
    }
    const store = new FakeStore(new Map([["crew.", first], ["fleet.", second]]));
    const path = await statePath();
    await prepareTlsaRollover({
      store,
      statePath: path,
      currentAssociation: ASSOCIATION_A,
      nextAssociation: ASSOCIATION_B,
      configuredAssociations: [ASSOCIATION_A, ASSOCIATION_B],
      ttlSeconds: 60,
      now: new Date("2026-07-14T00:00:00.000Z"),
    });

    await recordTlsaGatewayActivation({
      store,
      statePath: path,
      servedAssociation: ASSOCIATION_B,
      configuredAssociations: [ASSOCIATION_A, ASSOCIATION_B],
      now: new Date("2026-07-14T00:02:00.000Z"),
    });

    await store.mutateRrsets("crew.", buildConvergentTlsaMutations({
      zone: first,
      associations: [ASSOCIATION_B],
      ttl: 60,
    }));

    const result = await retireTlsaRollover({
      store,
      statePath: path,
      servedAssociation: ASSOCIATION_B,
      configuredAssociations: [ASSOCIATION_B],
      now: new Date("2026-07-14T00:02:00.000Z"),
    });
    expect(result.phase).toBe("retired");
    for (const zone of [first, second]) {
      expect(zone.rrsets.find((entry) => entry.name === `*.${zone.name}` && entry.type === "TLSA")?.records)
        .toEqual([ASSOCIATION_B]);
    }
  });

  test("refuses unsigned zones and unknown existing associations before any write", async () => {
    const unsigned = signedZone();
    unsigned.dnssec = false;
    const unsignedStore = new FakeStore(new Map([["crew.", unsigned]]));
    await expect(prepareInitialTlsa({
      store: unsignedStore,
      statePath: await statePath(),
      association: ASSOCIATION_A,
      configuredAssociations: [ASSOCIATION_A],
      ttlSeconds: 300,
    })).rejects.toThrow("unsigned zone");
    expect(unsignedStore.writes).toHaveLength(0);

    const unknown = signedZone();
    unknown.rrsets.push({
      name: "*.crew",
      type: "TLSA",
      ttl: 300,
      records: [`3 1 1 ${"C".repeat(64)}`],
    });
    const unknownStore = new FakeStore(new Map([["crew.", unknown]]));
    await expect(prepareTlsaRollover({
      store: unknownStore,
      statePath: await statePath(),
      currentAssociation: ASSOCIATION_A,
      nextAssociation: ASSOCIATION_B,
      configuredAssociations: [ASSOCIATION_A, ASSOCIATION_B],
      ttlSeconds: 300,
    })).rejects.toThrow("unmanaged TLSA association");
    expect(unknownStore.writes).toHaveLength(0);
  });

  test("refuses to shorten an existing TLSA TTL before old caches can expire", async () => {
    const zone = signedZone();
    zone.rrsets.push(
      { name: "*.crew", type: "TLSA", ttl: 3_600, records: [ASSOCIATION_A] },
      { name: "_443._tcp.crew", type: "TLSA", ttl: 3_600, records: [ASSOCIATION_A] },
      { name: "_443._tcp.profile.crew", type: "TLSA", ttl: 3_600, records: [ASSOCIATION_A] },
    );
    const store = new FakeStore(new Map([["crew.", zone]]));

    await expect(prepareTlsaRollover({
      store,
      statePath: await statePath(),
      currentAssociation: ASSOCIATION_A,
      nextAssociation: ASSOCIATION_B,
      configuredAssociations: [ASSOCIATION_A, ASSOCIATION_B],
      ttlSeconds: 300,
    })).rejects.toThrow("managed TLSA TTL longer than 300");
    expect(store.writes).toHaveLength(0);
  });

  test("readiness rejects omitted zones and concurrent TLSA drift", async () => {
    const first = signedZone("crew.");
    const second = signedZone("fleet.");
    const store = new FakeStore(new Map([["crew.", first], ["fleet.", second]]));
    const path = await statePath();
    await prepareInitialTlsa({
      store,
      statePath: path,
      association: ASSOCIATION_A,
      configuredAssociations: [ASSOCIATION_A],
      ttlSeconds: 60,
      now: new Date("2026-07-14T00:00:00.000Z"),
    });

    await expect(prepareInitialTlsa({
      store,
      statePath: path,
      association: ASSOCIATION_A,
      configuredAssociations: [ASSOCIATION_A],
      ttlSeconds: 60,
      zoneAllowlist: ["crew"],
      now: new Date("2026-07-14T00:01:00.000Z"),
    })).rejects.toThrow("omit previously prepared zones");

    await expect(assertTlsaRolloverReady({
      store,
      statePath: path,
      zoneAllowlist: ["crew"],
      configuredAssociations: [ASSOCIATION_A],
      now: new Date("2026-07-14T00:02:00.000Z"),
    })).rejects.toThrow("omit previously prepared zones");

    first.rrsets.push({
      name: "_443._tcp.removed.crew",
      type: "TLSA",
      ttl: 60,
      records: [ASSOCIATION_A],
    });
    await expect(assertTlsaRolloverReady({
      store,
      statePath: path,
      configuredAssociations: [ASSOCIATION_A],
      now: new Date("2026-07-14T00:02:00.000Z"),
    })).rejects.toThrow("unexpected managed TLSA owner set");

    first.rrsets = first.rrsets.filter((entry) => entry.name !== "_443._tcp.removed.crew");
    const wildcard = first.rrsets.find((entry) => entry.name === "*.crew" && entry.type === "TLSA");
    if (!wildcard) throw new Error("missing fake wildcard TLSA");
    wildcard.ttl = 300;
    await expect(assertTlsaRolloverReady({
      store,
      statePath: path,
      configuredAssociations: [ASSOCIATION_A],
      now: new Date("2026-07-14T00:02:00.000Z"),
    })).rejects.toThrow("unexpected TLSA TTL");

    wildcard.ttl = 60;
    wildcard.records = [`3 1 1 ${"C".repeat(64)}`];
    await expect(assertTlsaRolloverReady({
      store,
      statePath: path,
      configuredAssociations: [ASSOCIATION_A],
      now: new Date("2026-07-14T00:02:00.000Z"),
    })).rejects.toThrow("unmanaged TLSA association");
  });
});

function canonical(value: string): string {
  return value.endsWith(".") ? value : `${value}.`;
}

function stripDot(value: string): string {
  return value.replace(/\.$/u, "");
}
