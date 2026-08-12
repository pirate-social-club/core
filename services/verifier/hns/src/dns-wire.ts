const DNS_TYPES = { A: 1, TLSA: 52 } as const;

export function buildDnsQuery(name: string, type: keyof typeof DNS_TYPES, id = 0x2a2a): Uint8Array {
  const labels = name.split(".").filter(Boolean);
  const encodedLabels = labels.flatMap((label) => {
    const bytes = [...new TextEncoder().encode(label)];
    if (bytes.length > 63) throw new Error("DNS label exceeds 63 bytes");
    return [bytes.length, ...bytes];
  });
  const buffer = new Uint8Array(12 + encodedLabels.length + 1 + 4);
  const view = new DataView(buffer.buffer);
  view.setUint16(0, id);
  view.setUint16(2, 0x0100);
  view.setUint16(4, 1);
  buffer.set(encodedLabels, 12);
  const questionEnd = 12 + encodedLabels.length;
  buffer[questionEnd] = 0;
  view.setUint16(questionEnd + 1, DNS_TYPES[type]);
  view.setUint16(questionEnd + 3, 1);
  return buffer;
}

function skipName(bytes: Uint8Array, initialOffset: number): number {
  let offset = initialOffset;
  while (offset < bytes.length) {
    const length = bytes[offset]!;
    if (length === 0) return offset + 1;
    if ((length & 0xc0) === 0xc0) return offset + 2;
    offset += 1 + length;
  }
  throw new Error("truncated DNS name");
}

export function parseDnsAnswers(bytes: Uint8Array, expectedId: number): { rcode: number; records: string[] } {
  if (bytes.length < 12) throw new Error("truncated DNS response");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint16(0) !== expectedId) throw new Error("DNS response id mismatch");
  const rcode = view.getUint16(2) & 0x0f;
  const questions = view.getUint16(4);
  const answers = view.getUint16(6);
  let offset = 12;
  for (let index = 0; index < questions; index += 1) offset = skipName(bytes, offset) + 4;
  const records: string[] = [];
  for (let index = 0; index < answers; index += 1) {
    offset = skipName(bytes, offset);
    if (offset + 10 > bytes.length) throw new Error("truncated DNS answer header");
    const type = view.getUint16(offset);
    const length = view.getUint16(offset + 8);
    const dataOffset = offset + 10;
    if (dataOffset + length > bytes.length) throw new Error("truncated DNS answer data");
    if (type === DNS_TYPES.A && length === 4) {
      records.push([...bytes.slice(dataOffset, dataOffset + 4)].join("."));
    } else if (type === DNS_TYPES.TLSA && length >= 3) {
      const prefix = [...bytes.slice(dataOffset, dataOffset + 3)].join(" ");
      const association = [...bytes.slice(dataOffset + 3, dataOffset + length)]
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join("")
        .toUpperCase();
      records.push(`${prefix} ${association}`);
    }
    offset = dataOffset + length;
  }
  return { rcode, records };
}
