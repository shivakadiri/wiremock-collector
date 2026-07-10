export type BodyFormat = "json" | "markdown" | "text";

export const PREVIEW_LIMIT = 140;

export function tryParseJson(text: string): unknown | undefined {
  const trimmed = text.trim();
  if (!trimmed) return undefined;

  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      return JSON.parse(trimmed);
    } catch {
      // Slash-escaped JSON blob: {\"a\":1} or {\n  \"a\": 1\n}
      if (trimmed.includes('\\"') || trimmed.includes("\\n")) {
        try {
          const loose = trimmed
            .replace(/\\"/g, '"')
            .replace(/\\n/g, "\n")
            .replace(/\\r/g, "\r")
            .replace(/\\t/g, "\t")
            .replace(/\\\\/g, "\\");
          return JSON.parse(loose);
        } catch {
          return undefined;
        }
      }
      return undefined;
    }
  }

  // Double-encoded JSON string literal: "{\"a\":1}"
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    try {
      const inner = JSON.parse(trimmed);
      if (typeof inner === "string") {
        const nested = tryParseJson(inner);
        return nested !== undefined ? nested : undefined;
      }
    } catch {
      return undefined;
    }
  }
  return undefined;
}

/** Unwrap JSON-encoded strings (Anthropic `text`, etc.) up to maxDepth times. */
export function unwrapJsonValue(value: unknown, maxDepth = 4): unknown {
  let current = value;
  for (let i = 0; i < maxDepth; i++) {
    if (typeof current !== "string") return current;
    const parsed = tryParseJson(current);
    if (parsed === undefined) return current;
    current = parsed;
  }
  return current;
}

export function isJsonEncodableString(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const parsed = tryParseJson(value);
  return parsed !== undefined && parsed !== null && typeof parsed === "object";
}

export function isNestableValue(value: unknown): boolean {
  if (value !== null && typeof value === "object") return true;
  return isJsonEncodableString(value);
}

export function childrenOf(value: unknown): unknown {
  if (value !== null && typeof value === "object") return value;
  if (typeof value === "string") {
    const parsed = tryParseJson(value);
    if (parsed !== null && typeof parsed === "object") return parsed;
  }
  return null;
}

export function asString(raw: unknown): string {
  if (raw == null) return "";
  if (typeof raw === "string") return raw;
  try {
    return JSON.stringify(raw, null, 2);
  } catch {
    return String(raw);
  }
}

export function formatAsJson(raw: unknown): string {
  if (raw == null || raw === "") return "";
  const unwrapped = unwrapJsonValue(raw);
  if (typeof unwrapped === "string") return unwrapped;
  try {
    return JSON.stringify(unwrapped, null, 2);
  } catch {
    return String(unwrapped);
  }
}

export function formatAsMarkdownSource(raw: unknown): string {
  if (raw == null || raw === "") return "";
  const unwrapped = unwrapJsonValue(raw);
  if (typeof unwrapped === "string") return unwrapped;
  return "```json\n" + JSON.stringify(unwrapped, null, 2) + "\n```";
}

export function truncateText(text: string, limit = PREVIEW_LIMIT): { text: string; truncated: boolean } {
  if (text.length <= limit) return { text, truncated: false };
  return { text: text.slice(0, limit) + "…", truncated: true };
}

export function previewValue(value: unknown): { text: string; truncated: boolean; kind: string } {
  if (value === null) return { text: "null", truncated: false, kind: "null" };
  if (value === undefined) return { text: "undefined", truncated: false, kind: "undefined" };
  if (typeof value === "boolean" || typeof value === "number") {
    return { text: String(value), truncated: false, kind: typeof value };
  }
  if (typeof value === "string") {
    const parsed = tryParseJson(value);
    if (parsed !== undefined && parsed !== null && typeof parsed === "object") {
      const full = JSON.stringify(parsed);
      const t = truncateText(full);
      if (Array.isArray(parsed)) {
        return { ...t, kind: `json→array[${parsed.length}]` };
      }
      return { ...t, kind: `json→object{${Object.keys(parsed).length}}` };
    }
    const t = truncateText(value);
    return { ...t, kind: "string" };
  }
  if (Array.isArray(value)) {
    const full = JSON.stringify(value);
    const t = truncateText(full);
    return { ...t, kind: `array[${value.length}]` };
  }
  if (typeof value === "object") {
    const keys = Object.keys(value as object);
    const full = JSON.stringify(value);
    const t = truncateText(full);
    return { ...t, kind: `object{${keys.length}}` };
  }
  const t = truncateText(String(value));
  return { ...t, kind: "value" };
}

export type PropertyNode = {
  path: string;
  key: string;
  value: unknown;
};
