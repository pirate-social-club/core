#!/usr/bin/env bun

import { PowerDnsApiClient } from "../../../services/verifier/hns/src/pdns-store";
import { parseDaneEeAssociations } from "../../../services/verifier/hns/src/tlsa";
import {
  associationFromCertificateFile,
  acquireTlsaStateLock,
  assertTlsaRolloverReady,
  prepareInitialTlsa,
  prepareTlsaRollover,
  readServedDaneEeAssociation,
  recordTlsaGatewayActivation,
  retireTlsaRollover,
} from "./tlsa-rollover";

type Options = Record<string, string>;

async function main(): Promise<void> {
  const [command, ...args] = Bun.argv.slice(2);
  const options = parseOptions(args);
  const statePath = options.state ?? Bun.env.HNS_TLSA_STATE_PATH?.trim()
    ?? "/var/lib/pirate-hns/tlsa-rollover.json";
  const ttlSeconds = parsePositiveInteger(
    options.ttl ?? Bun.env.HNS_AUTHORITATIVE_TLSA_TTL ?? "300",
    "TTL",
  );
  const zoneAllowlist = parseCsv(options.zones ?? Bun.env.HNS_TLSA_ZONE_ALLOWLIST);
  const pdnsApiUrl = requireValue(Bun.env.PDNS_API_URL, "PDNS_API_URL");
  const verifierConfig = await readVerifierTlsaConfiguration({
    url: requireValue(Bun.env.HNS_VERIFIER_URL, "HNS_VERIFIER_URL"),
    token: requireValue(Bun.env.HNS_VERIFIER_AUTH_TOKEN, "HNS_VERIFIER_AUTH_TOKEN"),
    expectedPdnsApiUrl: pdnsApiUrl,
  });
  if (verifierConfig.ttlSeconds !== ttlSeconds) {
    throw new Error(
      `operator TLSA TTL ${ttlSeconds} does not match running verifier TTL ${verifierConfig.ttlSeconds}`,
    );
  }
  const configuredAssociations = verifierConfig.associations;
  const store = new PowerDnsApiClient({
    apiUrl: pdnsApiUrl,
    apiKey: requireValue(Bun.env.PDNS_API_KEY, "PDNS_API_KEY"),
    serverId: Bun.env.PDNS_SERVER_ID?.trim() || "localhost",
    defaultSoaContent: "unused.invalid. unused.invalid. 0 3600 900 1209600 300",
    zoneKind: "Master",
  });

  const releaseStateLock = await acquireTlsaStateLock(statePath);
  try {

    if (command === "bootstrap") {
    const association = await associationFromCertificateFile(requireOption(options, "cert"));
    print(await prepareInitialTlsa({
      store,
      statePath,
      association,
      configuredAssociations,
      ttlSeconds,
      zoneAllowlist,
    }));
    return;
  }
    if (command === "prepare") {
    const [currentAssociation, nextAssociation] = await Promise.all([
      associationFromCertificateFile(requireOption(options, "current-cert")),
      associationFromCertificateFile(requireOption(options, "next-cert")),
    ]);
    print(await prepareTlsaRollover({
      store,
      statePath,
      currentAssociation,
      nextAssociation,
      configuredAssociations,
      ttlSeconds,
      zoneAllowlist,
    }));
    return;
  }
    if (command === "ready") {
    print(await assertTlsaRolloverReady({
      store,
      statePath,
      zoneAllowlist,
      configuredAssociations,
    }));
      return;
    }
    if (command === "activated") {
      const servedAssociation = await probeServedAssociation(options);
      print(await recordTlsaGatewayActivation({
        store,
        statePath,
        servedAssociation,
        zoneAllowlist,
        configuredAssociations,
      }));
      return;
    }
    if (command === "retire") {
      const servedAssociation = await probeServedAssociation(options);
    print(await retireTlsaRollover({
      store,
      statePath,
      servedAssociation,
      configuredAssociations,
      zoneAllowlist,
    }));
    return;
  }

    throw new Error(
      "usage: manage-tlsa.ts bootstrap --cert <pem> | prepare --current-cert <pem> --next-cert <pem> | ready | activated --probe-address <ip> --probe-host <host> | retire --probe-address <ip> --probe-host <host>",
    );
  } finally {
    await releaseStateLock();
  }
}

export async function readVerifierTlsaConfiguration(input: {
  url: string;
  token: string;
  expectedPdnsApiUrl: string;
  timeoutMs?: number;
}): Promise<{ associations: string[]; ttlSeconds: number }> {
  const response = await fetch(`${input.url.replace(/\/+$/u, "")}/health`, {
    headers: { authorization: `Bearer ${input.token}` },
    signal: AbortSignal.timeout(input.timeoutMs ?? 5_000),
  });
  if (!response.ok) {
    throw new Error(`running HNS verifier configuration check failed with status ${response.status}`);
  }
  const body = await response.json() as {
    ok?: unknown;
    pdns_api_url?: unknown;
    authoritative_tlsa_associations?: unknown;
    authoritative_tlsa_ttl?: unknown;
    requires_bearer_auth?: unknown;
  };
  if (body.ok !== true) {
    throw new Error("running HNS verifier health response is not healthy");
  }
  if (body.requires_bearer_auth !== true) {
    throw new Error("running HNS verifier is not enforcing bearer authentication");
  }
  if (typeof body.pdns_api_url !== "string"
    || normalizeUrl(body.pdns_api_url) !== normalizeUrl(input.expectedPdnsApiUrl)) {
    throw new Error("running HNS verifier and TLSA operator target different PowerDNS APIs");
  }
  if (!Array.isArray(body.authoritative_tlsa_associations)) {
    throw new Error("running HNS verifier does not expose its active TLSA associations");
  }
  const associations = parseDaneEeAssociations(body.authoritative_tlsa_associations.join(","));
  const ttlSeconds = Number(body.authoritative_tlsa_ttl);
  if (!Number.isSafeInteger(ttlSeconds) || ttlSeconds < 60 || ttlSeconds > 86_400) {
    throw new Error("running HNS verifier exposes an invalid TLSA TTL");
  }
  return { associations, ttlSeconds };
}

function normalizeUrl(value: string): string {
  return value.trim().replace(/\/+$/u, "");
}

async function probeServedAssociation(options: Options): Promise<string> {
  return readServedDaneEeAssociation({
    address: requireOption(options, "probe-address"),
    servername: requireOption(options, "probe-host"),
    port: options["probe-port"] ? parsePositiveInteger(options["probe-port"], "probe port") : 443,
  });
}

function parseOptions(args: string[]): Options {
  const options: Options = {};
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    const value = args[index + 1];
    if (!key?.startsWith("--") || !value || value.startsWith("--")) {
      throw new Error(`invalid option near ${key ?? "end of command"}`);
    }
    options[key.slice(2)] = value;
  }
  return options;
}

function requireOption(options: Options, name: string): string {
  return requireValue(options[name], `--${name}`);
}

function requireValue(value: string | undefined, name: string): string {
  const normalized = value?.trim();
  if (!normalized) {
    throw new Error(`${name} is required`);
  }
  return normalized;
}

function parsePositiveInteger(value: string, name: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}

function parseCsv(value: string | undefined): string[] | undefined {
  const values = value?.split(",").map((entry) => entry.trim()).filter(Boolean) ?? [];
  return values.length > 0 ? values : undefined;
}

function print(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

if (import.meta.main) {
  try {
    await main();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
