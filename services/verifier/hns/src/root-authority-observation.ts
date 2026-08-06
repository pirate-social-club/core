import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export type DsTrustAnchor = {
  key_tag: number;
  algorithm: number;
  digest_type: number;
  digest: string;
};

export type RequiredRrset = {
  name: string;
  type: "A" | "SOA" | "TLSA" | "DNSKEY";
};

export type AuthorityTarget = {
  nameserver: string;
  addresses: string[];
  missing_address_failure_code?: "missing_parent_glue" | "nameserver_address_resolution_failed";
};

export type AuthorityResult = {
  nameserver: string;
  reachable: boolean;
  soa_serial: string | null;
  failure_code: string | null;
};

type CommandResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

export type CommandRunner = (
  command: string,
  args: string[],
  timeoutMs: number,
) => Promise<CommandResult>;

export type RootAuthorityObservationConfig = {
  delvBin: string;
  digBin: string;
  resolverAddress: string;
  resolverPort: number;
  timeoutMs: number;
};

const DNSSEC_TIMESTAMP = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/u;

function canonicalName(value: string): string {
  return value.endsWith(".") ? value.toLowerCase() : `${value.toLowerCase()}.`;
}

function dnssecTimestamp(value: string): string | null {
  const match = DNSSEC_TIMESTAMP.exec(value);
  if (!match) return null;
  const [, year, month, day, hour, minute, second] = match;
  const timestamp = Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second),
  );
  return Number.isNaN(timestamp) ? null : new Date(timestamp).toISOString();
}

export function parseValidatedDelvOutput(output: string): {
  fullyValidated: boolean;
  rrsigExpirations: string[];
} {
  const fullyValidated = output
    .split("\n")
    .some((line) => line.trim().toLowerCase() === "; fully validated");
  const expirations: string[] = [];
  for (const rawLine of output.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith(";")) continue;
    const fields = line.split(/\s+/u);
    const rrsigIndex = fields.findIndex((field) => field.toUpperCase() === "RRSIG");
    if (rrsigIndex < 0) continue;
    const expiration = dnssecTimestamp(fields[rrsigIndex + 5] ?? "");
    if (expiration) expirations.push(expiration);
  }
  return {
    fullyValidated,
    rrsigExpirations: [...new Set(expirations)].sort(),
  };
}

export function parseDigSoaSerial(output: string): string | null {
  for (const rawLine of output.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith(";")) continue;
    const fields = line.split(/\s+/u);
    const soaIndex = fields.findIndex((field) => field.toUpperCase() === "SOA");
    const serial = fields[soaIndex + 3];
    if (soaIndex >= 0 && serial && /^\d+$/u.test(serial)) return serial;
  }
  return null;
}

export function parseValidatedAddressOutput(
  output: string,
  recordType: "A" | "AAAA",
): string[] {
  const validation = parseValidatedDelvOutput(output);
  if (!validation.fullyValidated || validation.rrsigExpirations.length === 0) return [];
  const addresses: string[] = [];
  for (const rawLine of output.split("\n")) {
    const fields = rawLine.trim().split(/\s+/u);
    const typeIndex = fields.findIndex((field) => field.toUpperCase() === recordType);
    const address = fields[typeIndex + 1];
    if (typeIndex > 0 && fields[typeIndex - 1]?.toUpperCase() === "IN" && address) {
      addresses.push(address);
    }
  }
  return [...new Set(addresses)].sort();
}

export async function resolveValidatedAuthorityAddresses(
  input: {
    nameserver: string;
    anchorRoot: string;
    anchors: DsTrustAnchor[];
    config: RootAuthorityObservationConfig;
  },
  runner: CommandRunner = runCommand,
): Promise<string[]> {
  const usableAnchors = input.anchors.filter(isUsableTrustAnchor);
  if (usableAnchors.length === 0) return [];
  const anchorDirectory = await mkdtemp(join(tmpdir(), "pirate-hns-ns-anchor-"));
  const anchorPath = join(anchorDirectory, "trust-anchors.conf");
  try {
    await writeFile(anchorPath, buildTrustAnchorFile(input.anchorRoot, usableAnchors), {
      encoding: "utf8",
      mode: 0o600,
    });
    await chmod(anchorPath, 0o600);
    const results = await Promise.all((["A", "AAAA"] as const).map(async (recordType) => {
      const result = await runner(input.config.delvBin, [
        `@${input.config.resolverAddress}`,
        "-p",
        String(input.config.resolverPort),
        "-a",
        anchorPath,
        `+root=${canonicalName(input.anchorRoot)}`,
        canonicalName(input.nameserver),
        recordType,
        "+rtrace",
      ], input.config.timeoutMs);
      return result.exitCode === 0
        ? parseValidatedAddressOutput(result.stdout, recordType)
        : [];
    }));
    return [...new Set(results.flat())].sort();
  } finally {
    await rm(anchorDirectory, { recursive: true, force: true });
  }
}

export function buildTrustAnchorFile(rootLabel: string, anchors: DsTrustAnchor[]): string {
  const root = canonicalName(rootLabel);
  const usableAnchors = anchors.filter(isUsableTrustAnchor);
  if (usableAnchors.length === 0) {
    throw new Error("parent DS has no supported SHA-256 or SHA-384 trust anchor");
  }
  const records = usableAnchors.map((anchor) =>
    `  "${root}" static-ds ${anchor.key_tag} ${anchor.algorithm} ${anchor.digest_type} "${anchor.digest.toUpperCase()}";`
  );
  return `trust-anchors {\n${records.join("\n")}\n};\n`;
}

function isUsableTrustAnchor(anchor: DsTrustAnchor): boolean {
  return (anchor.digest_type === 2 && /^[0-9a-f]{64}$/iu.test(anchor.digest))
    || (anchor.digest_type === 4 && /^[0-9a-f]{96}$/iu.test(anchor.digest));
}

export async function runCommand(
  command: string,
  args: string[],
  timeoutMs: number,
): Promise<CommandResult> {
  const process = Bun.spawn([command, ...args], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const timeout = setTimeout(() => process.kill(), timeoutMs);
  try {
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(process.stdout).text(),
      new Response(process.stderr).text(),
      process.exited,
    ]);
    return { stdout, stderr, exitCode };
  } finally {
    clearTimeout(timeout);
  }
}

async function observeAuthority(
  input: {
    rootLabel: string;
    authority: AuthorityTarget;
    config: RootAuthorityObservationConfig;
  },
  runner: CommandRunner,
): Promise<AuthorityResult> {
  if (input.authority.addresses.length === 0) {
    return {
      nameserver: canonicalName(input.authority.nameserver),
      reachable: false,
      soa_serial: null,
      failure_code: input.authority.missing_address_failure_code ?? "missing_parent_glue",
    };
  }

  for (const address of input.authority.addresses) {
    const result = await runner(input.config.digBin, [
      `@${address}`,
      canonicalName(input.rootLabel),
      "SOA",
      "+dnssec",
      "+noall",
      "+answer",
      "+time=2",
      "+tries=1",
    ], input.config.timeoutMs);
    const serial = result.exitCode === 0 ? parseDigSoaSerial(result.stdout) : null;
    if (serial) {
      return {
        nameserver: canonicalName(input.authority.nameserver),
        reachable: true,
        soa_serial: serial,
        failure_code: null,
      };
    }
  }

  return {
    nameserver: canonicalName(input.authority.nameserver),
    reachable: false,
    soa_serial: null,
    failure_code: "soa_unreachable",
  };
}

export async function observeRootAuthority(
  input: {
    rootLabel: string;
    observedAt?: string;
    anchors: DsTrustAnchor[];
    requiredRrsets: RequiredRrset[];
    authorities: AuthorityTarget[];
    config: RootAuthorityObservationConfig;
  },
  runner: CommandRunner = runCommand,
) {
  const observedAt = input.observedAt ?? new Date().toISOString();
  if (input.requiredRrsets.length === 0) {
    throw new Error("required authoritative RRset inventory is empty");
  }

  const anchorDirectory = await mkdtemp(join(tmpdir(), "pirate-hns-anchor-"));
  const anchorPath = join(anchorDirectory, "trust-anchors.conf");
  try {
    const usableAnchors = input.anchors.filter(isUsableTrustAnchor);
    if (usableAnchors.length > 0) {
      await writeFile(anchorPath, buildTrustAnchorFile(input.rootLabel, usableAnchors), {
        encoding: "utf8",
        mode: 0o600,
      });
      await chmod(anchorPath, 0o600);
    }

    const anchorResults = await Promise.all(input.anchors.map(async (anchor, index) => {
      if (!isUsableTrustAnchor(anchor)) {
        return {
          ...anchor,
          supported: false,
          matches_live_dnskey: null,
          failure_code: "unsupported_ds_digest",
        };
      }
      const singleAnchorPath = join(anchorDirectory, `trust-anchor-${index}.conf`);
      await writeFile(singleAnchorPath, buildTrustAnchorFile(input.rootLabel, [anchor]), {
        encoding: "utf8",
        mode: 0o600,
      });
      await chmod(singleAnchorPath, 0o600);
      const result = await runner(input.config.delvBin, [
        `@${input.config.resolverAddress}`,
        "-p",
        String(input.config.resolverPort),
        "-a",
        singleAnchorPath,
        `+root=${canonicalName(input.rootLabel)}`,
        canonicalName(input.rootLabel),
        "DNSKEY",
        "+rtrace",
      ], input.config.timeoutMs);
      const parsed = parseValidatedDelvOutput(result.stdout);
      const matchesLiveDnskey = result.exitCode === 0
        && parsed.fullyValidated
        && parsed.rrsigExpirations.length > 0;
      return {
        ...anchor,
        supported: true,
        matches_live_dnskey: matchesLiveDnskey,
        failure_code: matchesLiveDnskey ? null : "ds_does_not_anchor_live_dnskey",
      };
    }));

    const rrsets = usableAnchors.length === 0
      ? input.requiredRrsets.map((rrset) => ({
          name: canonicalName(rrset.name),
          type: rrset.type,
          validated: false,
          rrsig_expirations: [] as string[],
          failure_code: "parent_ds_trust_anchor_unavailable",
        }))
      : await Promise.all(input.requiredRrsets.map(async (rrset) => {
      const result = await runner(input.config.delvBin, [
        `@${input.config.resolverAddress}`,
        "-p",
        String(input.config.resolverPort),
        "-a",
        anchorPath,
        `+root=${canonicalName(input.rootLabel)}`,
        canonicalName(rrset.name),
        rrset.type,
        "+rtrace",
      ], input.config.timeoutMs);
      const parsed = parseValidatedDelvOutput(result.stdout);
      const validated = result.exitCode === 0
        && parsed.fullyValidated
        && parsed.rrsigExpirations.length > 0;
      return {
        name: canonicalName(rrset.name),
        type: rrset.type,
        validated,
        rrsig_expirations: parsed.rrsigExpirations,
        failure_code: validated
          ? null
          : result.exitCode === 0
            ? "dnssec_not_fully_validated"
            : "dnssec_validation_failed",
      };
        }));

    const authorities = await Promise.all(input.authorities.map(
      (authority) => observeAuthority({
        rootLabel: input.rootLabel,
        authority,
        config: input.config,
      }, runner),
    ));
    const reachableSerials = authorities
      .filter((authority) => authority.reachable)
      .map((authority) => authority.soa_serial)
      .filter((serial): serial is string => serial != null);
    const authorityRedundancyOk = new Set(authorities.map((authority) => authority.nameserver)).size >= 2
      && authorities.every((authority) => authority.reachable)
      && new Set(reachableSerials).size === 1;
    const expirations = rrsets
      .flatMap((rrset) => rrset.rrsig_expirations)
      .sort();

    return {
      provider: "bind_delv_with_hsd_ds_anchor",
      observed_at: observedAt,
      authoritative_dnssec_valid: rrsets.every((rrset) => rrset.validated),
      parent_ds_matches_live_dnskey: anchorResults.some(
        (anchor) => anchor.matches_live_dnskey === true,
      ),
      parent_ds_results: anchorResults,
      earliest_rrsig_expires_at: expirations[0] ?? null,
      required_rrsets: rrsets,
      authority_redundancy_ok: authorityRedundancyOk,
      authorities: authorities.map((authority) => ({
        ...authority,
        serial_in_sync: authority.reachable
          ? reachableSerials.length === authorities.length
            && new Set(reachableSerials).size === 1
          : null,
      })),
    };
  } finally {
    await rm(anchorDirectory, { recursive: true, force: true });
  }
}
