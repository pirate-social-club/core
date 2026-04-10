function normalizeText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

function joinClaimKeyParts(parts: string[]): string {
  return parts
    .map((part) => normalizeText(part))
    .filter(Boolean)
    .join("|");
}

export async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const array = Array.from(new Uint8Array(digest));
  return array.map((valuePart) => valuePart.toString(16).padStart(2, "0")).join("");
}

export async function createNormalizedClaimHash(input: {
  normalizedClaimText: string;
  timeframeLabel: string;
  entities: string[];
}): Promise<string> {
  const payload = joinClaimKeyParts([
    input.normalizedClaimText,
    input.timeframeLabel,
    ...input.entities.slice(0, 5),
  ]);

  return sha256Hex(payload);
}

