import { normalizeRootLabel } from "./labels";

export type PublishedFallbackTarget = {
  rootPubkey: string;
  webUrl: string;
  freedomUrl: string;
};

type ParsedTarget = {
  root_pubkey?: unknown;
  web_url?: unknown;
  freedom_url?: unknown;
};

function parseHttpsUrl(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${field} must be a non-empty HTTPS URL`);
  }
  const url = new URL(value.trim());
  if (url.protocol !== "https:" || !url.hostname || url.username || url.password) {
    throw new Error(`${field} must be an HTTPS URL without credentials`);
  }
  return url.toString();
}

export function parsePublishedFallbackTargets(raw: string): Map<string, PublishedFallbackTarget> {
  if (!raw.trim()) return new Map();

  const parsed = JSON.parse(raw) as Record<string, ParsedTarget>;
  const targets = new Map<string, PublishedFallbackTarget>();
  for (const [handle, value] of Object.entries(parsed)) {
    const rootLabel = normalizeRootLabel(handle);
    if (!rootLabel || value == null || typeof value !== "object") {
      throw new Error(`invalid published fallback entry for ${handle}`);
    }
    const rootPubkey = typeof value.root_pubkey === "string"
      ? value.root_pubkey.trim().toLowerCase()
      : "";
    if (!/^[0-9a-f]{64}$/.test(rootPubkey)) {
      throw new Error(`invalid root_pubkey for @${rootLabel}`);
    }
    targets.set(`@${rootLabel}`, {
      rootPubkey,
      webUrl: parseHttpsUrl(value.web_url, `web_url for @${rootLabel}`),
      freedomUrl: parseHttpsUrl(value.freedom_url, `freedom_url for @${rootLabel}`),
    });
  }
  return targets;
}

export class PublishedFallbackRegistry {
  private readonly disagreements = new Map<string, string>();

  constructor(private readonly targets: Map<string, PublishedFallbackTarget>) {}

  targetFor(handle: string, liveRootPubkey: string | null): PublishedFallbackTarget | null {
    const target = this.targets.get(handle) ?? null;
    return target && liveRootPubkey?.toLowerCase() === target.rootPubkey ? target : null;
  }

  observeNative(
    handle: string,
    native: { webUrl: string | null; freedomUrl: string | null },
  ): void {
    const fallback = this.targets.get(handle);
    if (!fallback || (!native.webUrl && !native.freedomUrl)) return;

    const fields = [
      native.webUrl && native.webUrl !== fallback.webUrl ? "web_url" : null,
      native.freedomUrl && native.freedomUrl !== fallback.freedomUrl ? "freedom_url" : null,
    ].filter((field): field is string => field != null);
    if (fields.length > 0) {
      this.disagreements.set(handle, fields.join(","));
    } else {
      this.disagreements.delete(handle);
    }
  }

  disagreementSnapshot(): { count: number; handles: string[] } {
    return {
      count: this.disagreements.size,
      handles: [...this.disagreements.keys()].sort(),
    };
  }
}
