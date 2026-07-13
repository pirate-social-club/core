import { randomUUID, X509Certificate } from "node:crypto";
import { mkdir, open, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { connect } from "node:tls";

import {
  type PowerDnsApiClient,
  type PowerDnsRrsetMutation,
  type PowerDnsZoneSnapshot,
} from "../../../services/verifier/hns/src/pdns-store";
import {
  buildManagedTlsaRrsets,
  daneEeAssociationFromCertificatePem,
  deriveExplicitWebHosts,
  normalizeDaneEeAssociation,
} from "../../../services/verifier/hns/src/tlsa";

export type TlsaRolloverState = {
  version: 1;
  phase: "prepared" | "retired";
  currentAssociation: string | null;
  nextAssociation: string;
  ttlSeconds: number;
  preparedAt: string;
  readyAt: string;
  zones: string[];
  activatedAt?: string;
  retiredAt?: string;
};

export type TlsaRolloverStore = Pick<
  PowerDnsApiClient,
  "getZoneByName" | "listZoneNames" | "mutateRrsets"
>;

export async function associationFromCertificateFile(path: string): Promise<string> {
  return daneEeAssociationFromCertificatePem(await readFile(path, "utf8"));
}

export async function acquireTlsaStateLock(statePath: string): Promise<() => Promise<void>> {
  await mkdir(dirname(statePath), { recursive: true, mode: 0o700 });
  const lockPath = `${statePath}.lock`;
  let handle: Awaited<ReturnType<typeof open>>;
  try {
    handle = await open(lockPath, "wx", 0o600);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      throw new Error(
        `TLSA rollover is locked by ${lockPath}; verify no operator is running before removing a stale lock`,
      );
    }
    throw error;
  }
  try {
    await handle.writeFile(`${JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() })}\n`);
  } catch (error) {
    await handle.close().catch(() => undefined);
    await rm(lockPath, { force: true });
    throw error;
  }

  return async () => {
    await handle.close();
    await rm(lockPath, { force: true });
  };
}

export function buildConvergentTlsaMutations(input: {
  zone: PowerDnsZoneSnapshot;
  associations: string[];
  ttl: number;
}): PowerDnsRrsetMutation[] {
  const desired = buildManagedTlsaRrsets({
    zoneName: input.zone.name,
    ttl: input.ttl,
    associations: input.associations,
    explicitWebHosts: deriveExplicitWebHosts(input.zone),
  });
  const desiredOwners = new Set(desired.map((rrset) => stripTrailingDot(rrset.name)));
  const stale = input.zone.rrsets
    .filter((rrset) => rrset.type === "TLSA" && isManagedHttpsTlsaOwner(rrset.name, input.zone.name))
    .filter((rrset) => !desiredOwners.has(stripTrailingDot(rrset.name)))
    .map((rrset) => ({
      name: rrset.name,
      type: "TLSA",
      ttl: rrset.ttl ?? input.ttl,
      records: [],
      changetype: "DELETE" as const,
    }));
  return [...desired, ...stale];
}

export function assertSafeExistingTlsa(
  zone: PowerDnsZoneSnapshot,
  allowedAssociations: string[],
): void {
  const allowed = new Set(allowedAssociations.map(normalizeDaneEeAssociation));
  for (const rrset of zone.rrsets) {
    if (rrset.type !== "TLSA" || !isManagedHttpsTlsaOwner(rrset.name, zone.name)) {
      continue;
    }
    for (const record of rrset.records) {
      const association = normalizeDaneEeAssociation(record);
      if (!allowed.has(association)) {
        throw new Error(`zone ${zone.name} has unmanaged TLSA association ${association}`);
      }
    }
  }
}

export async function prepareTlsaRollover(input: {
  store: TlsaRolloverStore;
  statePath: string;
  currentAssociation: string;
  nextAssociation: string;
  configuredAssociations: string[];
  ttlSeconds: number;
  zoneAllowlist?: string[];
  now?: Date;
}): Promise<TlsaRolloverState> {
  const currentAssociation = normalizeDaneEeAssociation(input.currentAssociation);
  const nextAssociation = normalizeDaneEeAssociation(input.nextAssociation);
  if (currentAssociation === nextAssociation) {
    throw new Error("current and next TLSA associations must differ");
  }
  assertExactAssociations(
    input.configuredAssociations,
    [currentAssociation, nextAssociation],
    "verifier environment must publish the old+new overlap before prepare",
  );
  assertTtl(input.ttlSeconds);

  const existingState = await readState(input.statePath);
  if (existingState && existingState.phase !== "retired") {
    if (
      existingState.currentAssociation !== currentAssociation
      || existingState.nextAssociation !== nextAssociation
      || existingState.ttlSeconds !== input.ttlSeconds
    ) {
      throw new Error("a different TLSA rollover is already prepared");
    }
  }

  const zones = await loadZones(input.store, input.zoneAllowlist);
  if (existingState?.phase === "prepared") {
    assertPreparedZonesIncluded(existingState, zones);
  }
  for (const zone of zones) {
    assertSafeExistingTlsa(zone, [currentAssociation, nextAssociation]);
    assertCanPublishAtTtl(zone, input.ttlSeconds);
  }
  for (const zone of zones) {
    await input.store.mutateRrsets(zone.name, buildConvergentTlsaMutations({
      zone,
      associations: [currentAssociation, nextAssociation],
      ttl: input.ttlSeconds,
    }));
  }

  const preparedAt = existingState?.phase === "prepared"
    ? new Date(existingState.preparedAt)
    : (input.now ?? new Date());
  const state: TlsaRolloverState = {
    version: 1,
    phase: "prepared",
    currentAssociation,
    nextAssociation,
    ttlSeconds: input.ttlSeconds,
    preparedAt: preparedAt.toISOString(),
    // Two TTLs cover authoritative propagation plus resolver caches. The
    // gateway certificate must not change before this instant.
    readyAt: new Date(preparedAt.getTime() + input.ttlSeconds * 2_000).toISOString(),
    zones: zones.map((zone) => zone.name).sort(),
  };
  await writeState(input.statePath, state);
  return state;
}

export async function prepareInitialTlsa(input: {
  store: TlsaRolloverStore;
  statePath: string;
  association: string;
  configuredAssociations: string[];
  ttlSeconds: number;
  zoneAllowlist?: string[];
  now?: Date;
}): Promise<TlsaRolloverState> {
  const nextAssociation = normalizeDaneEeAssociation(input.association);
  assertExactAssociations(
    input.configuredAssociations,
    [nextAssociation],
    "verifier environment must publish the initial association before bootstrap",
  );
  assertTtl(input.ttlSeconds);
  const existingState = await readState(input.statePath);
  if (existingState && existingState.phase !== "retired" && (
    existingState.currentAssociation !== null
    || existingState.nextAssociation !== nextAssociation
    || existingState.ttlSeconds !== input.ttlSeconds
  )) {
    throw new Error("a different TLSA rollout is already prepared");
  }

  const zones = await loadZones(input.store, input.zoneAllowlist);
  if (existingState?.phase === "prepared") {
    assertPreparedZonesIncluded(existingState, zones);
  }
  for (const zone of zones) {
    assertSafeExistingTlsa(zone, [nextAssociation]);
    assertCanPublishAtTtl(zone, input.ttlSeconds);
  }
  for (const zone of zones) {
    await input.store.mutateRrsets(zone.name, buildConvergentTlsaMutations({
      zone,
      associations: [nextAssociation],
      ttl: input.ttlSeconds,
    }));
  }

  const preparedAt = existingState?.phase === "prepared"
    ? new Date(existingState.preparedAt)
    : (input.now ?? new Date());
  const state: TlsaRolloverState = {
    version: 1,
    phase: "prepared",
    currentAssociation: null,
    nextAssociation,
    ttlSeconds: input.ttlSeconds,
    preparedAt: preparedAt.toISOString(),
    readyAt: new Date(preparedAt.getTime() + input.ttlSeconds * 2_000).toISOString(),
    zones: zones.map((zone) => zone.name).sort(),
  };
  await writeState(input.statePath, state);
  return state;
}

export async function assertTlsaRolloverReady(input: {
  store: TlsaRolloverStore;
  statePath: string;
  zoneAllowlist?: string[];
  configuredAssociations: string[];
  now?: Date;
}): Promise<TlsaRolloverState> {
  const state = await requirePreparedState(input.statePath);
  assertExactAssociations(
    input.configuredAssociations,
    preparedAssociations(state),
    "verifier environment must retain the prepared overlap until the gateway swap",
  );
  const now = input.now ?? new Date();
  if (now.getTime() < Date.parse(state.readyAt)) {
    throw new Error(`TLSA rollover is not ready before ${state.readyAt}`);
  }
  const zones = await loadZones(input.store, input.zoneAllowlist);
  assertPreparedZonesIncluded(state, zones);
  for (const zone of zones) {
    assertZoneHasAssociations(zone, preparedAssociations(state), state.ttlSeconds);
  }
  return { ...state, zones: zones.map((zone) => zone.name).sort() };
}

export async function recordTlsaGatewayActivation(input: {
  store: TlsaRolloverStore;
  statePath: string;
  servedAssociation: string;
  configuredAssociations: string[];
  zoneAllowlist?: string[];
  now?: Date;
}): Promise<TlsaRolloverState> {
  const state = await assertTlsaRolloverReady(input);
  if (normalizeDaneEeAssociation(input.servedAssociation) !== state.nextAssociation) {
    throw new Error("gateway is not serving the prepared next TLSA association");
  }
  const activated = { ...state, activatedAt: (input.now ?? new Date()).toISOString() };
  await writeState(input.statePath, activated);
  return activated;
}

export async function retireTlsaRollover(input: {
  store: TlsaRolloverStore;
  statePath: string;
  servedAssociation: string;
  configuredAssociations: string[];
  zoneAllowlist?: string[];
  now?: Date;
}): Promise<TlsaRolloverState> {
  const state = await requirePreparedState(input.statePath);
  if (!state.activatedAt) {
    throw new Error("gateway activation has not been proven while the prepared association set is active");
  }
  const now = input.now ?? new Date();
  if (now.getTime() < Date.parse(state.readyAt)) {
    throw new Error(`TLSA rollover is not ready before ${state.readyAt}`);
  }
  assertExactAssociations(
    input.configuredAssociations,
    [state.nextAssociation],
    "verifier environment must contain only the next association before retire",
  );
  const servedAssociation = normalizeDaneEeAssociation(input.servedAssociation);
  if (servedAssociation !== state.nextAssociation) {
    throw new Error("gateway is not serving the prepared next TLSA association");
  }

  const zones = await loadZones(input.store, input.zoneAllowlist);
  assertPreparedZonesIncluded(state, zones);
  for (const zone of zones) {
    assertZoneHasOneOfAssociationSets(zone, [
      preparedAssociations(state),
      [state.nextAssociation],
    ], state.ttlSeconds);
  }
  for (const zone of zones) {
    await input.store.mutateRrsets(zone.name, buildConvergentTlsaMutations({
      zone,
      associations: [state.nextAssociation],
      ttl: state.ttlSeconds,
    }));
  }

  const retired: TlsaRolloverState = {
    ...state,
    phase: "retired",
    zones: zones.map((zone) => zone.name).sort(),
    retiredAt: now.toISOString(),
  };
  await writeState(input.statePath, retired);
  return retired;
}

export async function readServedDaneEeAssociation(input: {
  address: string;
  servername: string;
  port?: number;
  timeoutMs?: number;
}): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = connect({
      host: input.address,
      port: input.port ?? 443,
      servername: input.servername,
      rejectUnauthorized: false,
    });
    const timeout = setTimeout(() => {
      socket.destroy();
      reject(new Error("TLS probe timed out"));
    }, input.timeoutMs ?? 5_000);
    socket.once("secureConnect", () => {
      try {
        const certificate = socket.getPeerCertificate(true);
        if (!certificate.raw) {
          throw new Error("gateway did not present a leaf certificate");
        }
        resolve(daneEeAssociationFromCertificatePem(new X509Certificate(certificate.raw).toString()));
      } catch (error) {
        reject(error);
      } finally {
        clearTimeout(timeout);
        socket.end();
      }
    });
    socket.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });
}

async function loadZones(store: TlsaRolloverStore, allowlist?: string[]): Promise<PowerDnsZoneSnapshot[]> {
  const available = await store.listZoneNames();
  const requested = allowlist?.length
    ? [...new Set(allowlist.map(canonical))].sort()
    : available;
  const missing = requested.filter((zone) => !available.includes(zone));
  if (missing.length > 0) {
    throw new Error(`configured TLSA zones do not exist: ${missing.join(", ")}`);
  }

  const zones: PowerDnsZoneSnapshot[] = [];
  for (const zoneName of requested) {
    const zone = await store.getZoneByName(zoneName);
    if (!zone) {
      throw new Error(`zone ${zoneName} disappeared during TLSA rollout`);
    }
    if (!zone.dnssec) {
      throw new Error(`refusing TLSA rollout for unsigned zone ${zoneName}`);
    }
    zones.push(zone);
  }
  if (zones.length === 0) {
    throw new Error("no PowerDNS zones selected for TLSA rollout");
  }
  return zones;
}

function assertZoneHasAssociations(
  zone: PowerDnsZoneSnapshot,
  associations: string[],
  ttlSeconds: number,
): void {
  assertSafeExistingTlsa(zone, associations);
  const desired = buildManagedTlsaRrsets({
    zoneName: zone.name,
    ttl: ttlSeconds,
    associations,
    explicitWebHosts: deriveExplicitWebHosts(zone),
  });
  const desiredOwners = desired.map((rrset) => stripTrailingDot(rrset.name)).sort();
  const actualOwners = zone.rrsets
    .filter((rrset) => rrset.type === "TLSA" && isManagedHttpsTlsaOwner(rrset.name, zone.name))
    .map((rrset) => stripTrailingDot(rrset.name))
    .sort();
  if (JSON.stringify(actualOwners) !== JSON.stringify(desiredOwners)) {
    throw new Error(`zone ${zone.name} has an unexpected managed TLSA owner set`);
  }
  for (const rrset of desired) {
    const actual = zone.rrsets.find((entry) => (
      entry.type === "TLSA" && stripTrailingDot(entry.name) === stripTrailingDot(rrset.name)
    ));
    if (!actual) {
      throw new Error(`zone ${zone.name} is missing ${rrset.name} TLSA`);
    }
    if (actual.ttl !== ttlSeconds) {
      throw new Error(`zone ${zone.name} has unexpected TLSA TTL at ${rrset.name}`);
    }
    const actualRecords = [...actual.records.map(normalizeDaneEeAssociation)].sort();
    const expectedRecords = [...rrset.records].sort();
    if (JSON.stringify(actualRecords) !== JSON.stringify(expectedRecords)) {
      throw new Error(`zone ${zone.name} has unexpected TLSA records at ${rrset.name}`);
    }
  }
}

function assertZoneHasOneOfAssociationSets(
  zone: PowerDnsZoneSnapshot,
  associationSets: string[][],
  ttlSeconds: number,
): void {
  const errors: unknown[] = [];
  for (const associations of associationSets) {
    try {
      assertZoneHasAssociations(zone, associations, ttlSeconds);
      return;
    } catch (error) {
      errors.push(error);
    }
  }
  throw new Error(`zone ${zone.name} is neither fully prepared nor already retired`, { cause: errors[0] });
}

function assertCanPublishAtTtl(zone: PowerDnsZoneSnapshot, ttlSeconds: number): void {
  for (const rrset of zone.rrsets) {
    if (rrset.type !== "TLSA" || !isManagedHttpsTlsaOwner(rrset.name, zone.name)) {
      continue;
    }
    if (rrset.ttl === null || rrset.ttl > ttlSeconds) {
      throw new Error(
        `zone ${zone.name} has a managed TLSA TTL longer than ${ttlSeconds}; `
        + "use at least the existing TTL so cached old associations expire before activation",
      );
    }
  }
}

function assertPreparedZonesIncluded(
  state: TlsaRolloverState,
  zones: PowerDnsZoneSnapshot[],
): void {
  const selected = new Set(zones.map((zone) => canonical(zone.name)));
  const omitted = state.zones.map(canonical).filter((zone) => !selected.has(zone));
  if (omitted.length > 0) {
    throw new Error(`selected zones omit previously prepared zones: ${omitted.join(", ")}`);
  }
}

function isManagedHttpsTlsaOwner(nameInput: string, zoneInput: string): boolean {
  const name = stripTrailingDot(nameInput);
  const zone = stripTrailingDot(zoneInput);
  return name === `*.${zone}`
    || name === `_443._tcp.${zone}`
    || (name.startsWith("_443._tcp.") && name.endsWith(`.${zone}`));
}

function assertTtl(value: number): void {
  if (!Number.isSafeInteger(value) || value < 60 || value > 86_400) {
    throw new Error("TLSA TTL must be an integer between 60 and 86400 seconds");
  }
}

function preparedAssociations(state: TlsaRolloverState): string[] {
  return state.currentAssociation
    ? [state.currentAssociation, state.nextAssociation]
    : [state.nextAssociation];
}

function assertExactAssociations(actualInput: string[], expectedInput: string[], message: string): void {
  const actual = [...new Set(actualInput.map(normalizeDaneEeAssociation))].sort();
  const expected = [...new Set(expectedInput.map(normalizeDaneEeAssociation))].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(message);
  }
}

async function requirePreparedState(path: string): Promise<TlsaRolloverState> {
  const state = await readState(path);
  if (!state || state.phase !== "prepared") {
    throw new Error("no prepared TLSA rollover state exists");
  }
  return state;
}

async function readState(path: string): Promise<TlsaRolloverState | null> {
  try {
    return validateState(JSON.parse(await readFile(path, "utf8")));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

function validateState(value: unknown): TlsaRolloverState {
  if (!value || typeof value !== "object") {
    throw new Error("invalid TLSA rollover state");
  }
  const state = value as Partial<TlsaRolloverState>;
  if (state.version !== 1) {
    throw new Error("unsupported TLSA rollover state version");
  }
  if (state.phase !== "prepared" && state.phase !== "retired") {
    throw new Error("invalid TLSA rollover phase");
  }
  if (typeof state.nextAssociation !== "string"
    || normalizeDaneEeAssociation(state.nextAssociation) !== state.nextAssociation) {
    throw new Error("invalid next TLSA association in rollover state");
  }
  if (state.currentAssociation !== null && (
    typeof state.currentAssociation !== "string"
    || normalizeDaneEeAssociation(state.currentAssociation) !== state.currentAssociation
  )) {
    throw new Error("invalid current TLSA association in rollover state");
  }
  if (state.currentAssociation === state.nextAssociation) {
    throw new Error("rollover state cannot use the same current and next association");
  }
  assertTtl(state.ttlSeconds as number);
  const preparedAt = requireStateDate(state.preparedAt, "preparedAt");
  const readyAt = requireStateDate(state.readyAt, "readyAt");
  if (readyAt < preparedAt + (state.ttlSeconds as number) * 2_000) {
    throw new Error("rollover state readyAt does not preserve the two-TTL overlap");
  }
  if (!Array.isArray(state.zones) || state.zones.length === 0
    || state.zones.some((zone) => typeof zone !== "string" || zone.trim() === "")) {
    throw new Error("invalid zone inventory in rollover state");
  }
  if (new Set(state.zones.map(canonical)).size !== state.zones.length) {
    throw new Error("duplicate zone inventory in rollover state");
  }
  const activatedAt = state.activatedAt === undefined
    ? null
    : requireStateDate(state.activatedAt, "activatedAt");
  if (activatedAt !== null && activatedAt < readyAt) {
    throw new Error("rollover state activation predates readiness");
  }
  if (state.phase === "retired") {
    if (activatedAt === null) {
      throw new Error("retired rollover state lacks activation proof");
    }
    const retiredAt = requireStateDate(state.retiredAt, "retiredAt");
    if (retiredAt < activatedAt) {
      throw new Error("rollover state retirement predates activation");
    }
  } else if (state.retiredAt !== undefined) {
    throw new Error("prepared rollover state cannot have a retirement timestamp");
  }
  return state as TlsaRolloverState;
}

function requireStateDate(value: unknown, field: string): number {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) {
    throw new Error(`invalid ${field} in TLSA rollover state`);
  }
  return Date.parse(value);
}

async function writeState(path: string, state: TlsaRolloverState): Promise<void> {
  const validated = validateState(state);
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(validated, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, path);
}

function canonical(value: string): string {
  return value.endsWith(".") ? value : `${value}.`;
}

function stripTrailingDot(value: string): string {
  return value.replace(/\.$/u, "");
}
