/** Decode WireMock journal bodies (bodyAsBase64 + gzip) for display. */

export type DecodedBody = {
  text: string;
  bytes: Uint8Array | null;
  contentType: string;
};

function headerValue(headers: unknown, name: string): string {
  if (!headers || typeof headers !== "object") return "";
  const target = name.toLowerCase();
  for (const [key, value] of Object.entries(headers as Record<string, unknown>)) {
    if (key.toLowerCase() === target) {
      return Array.isArray(value) ? String(value[0] ?? "") : String(value ?? "");
    }
  }
  return "";
}

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function gunzip(bytes: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream === "undefined") {
    throw new Error("DecompressionStream not supported");
  }
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
  const buf = await new Response(stream).arrayBuffer();
  return new Uint8Array(buf);
}

function looksBinaryText(text: string): boolean {
  if (!text) return false;
  if (text.includes("\uFFFD")) return true;
  if (text.charCodeAt(0) === 0x1f) return true;
  let bad = 0;
  const n = Math.min(text.length, 200);
  for (let i = 0; i < n; i++) {
    const c = text.charCodeAt(i);
    if (c < 9 || (c > 13 && c < 32)) bad++;
  }
  return bad > 5;
}

export async function decodeWireMockBodyFull(section: Record<string, unknown>): Promise<DecodedBody> {
  const encoding = headerValue(section.headers, "Content-Encoding").toLowerCase();
  const decodedFlag = String(section._decodedContentEncoding ?? "");
  const contentType = headerValue(section.headers, "Content-Type");
  const body = section.body;
  const b64 = section.bodyAsBase64;

  let bytes: Uint8Array | null = null;
  if (typeof b64 === "string" && b64) {
    try {
      bytes = b64ToBytes(b64);
    } catch {
      bytes = null;
    }
  }

  if (bytes) {
    const isGzip =
      encoding.includes("gzip") ||
      decodedFlag.includes("gzip") ||
      (bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b);
    try {
      if (isGzip) bytes = await gunzip(bytes);
    } catch {
      // keep raw
    }
    const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
    return { text, bytes, contentType };
  }

  if (typeof body === "string") {
    return {
      text: body,
      bytes: looksBinaryText(body) ? null : new TextEncoder().encode(body),
      contentType,
    };
  }
  if (body == null) return { text: "", bytes: null, contentType };
  try {
    const text = JSON.stringify(body, null, 2);
    return { text, bytes: new TextEncoder().encode(text), contentType };
  } catch {
    const text = String(body);
    return { text, bytes: new TextEncoder().encode(text), contentType };
  }
}

export async function decodeWireMockBody(section: Record<string, unknown>): Promise<string> {
  return (await decodeWireMockBodyFull(section)).text;
}
