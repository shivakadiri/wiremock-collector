export type MultipartPart = {
  name: string;
  filename?: string;
  contentType?: string;
  /** UTF-8 text when not a binary file */
  text?: string;
  /** Raw bytes for file download/view */
  bytes?: Uint8Array;
  isFile: boolean;
  size: number;
};

function headerMap(rawHeaders: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of rawHeaders.split(/\r?\n/)) {
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    out[line.slice(0, idx).trim().toLowerCase()] = line.slice(idx + 1).trim();
  }
  return out;
}

function parseDisposition(value: string): { name: string; filename?: string } {
  let name = "";
  let filename: string | undefined;
  const nameMatch = /(?:^|;\s*)name="((?:\\.|[^"\\])*)"/i.exec(value);
  const fileMatch = /(?:^|;\s*)filename\*?=(?:UTF-8''|")?([^";]+)"?/i.exec(value);
  if (nameMatch) name = nameMatch[1].replace(/\\"/g, '"');
  if (fileMatch) {
    filename = decodeURIComponent(fileMatch[1].replace(/"/g, "").trim());
  }
  return { name: name || "part", filename };
}

function indexOfBytes(haystack: Uint8Array, needle: Uint8Array, from = 0): number {
  outer: for (let i = from; i <= haystack.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) continue outer;
    }
    return i;
  }
  return -1;
}

export function extractBoundary(contentType: string): string | null {
  const m = /boundary=(?:"([^"]+)"|([^;\s]+))/i.exec(contentType);
  return m ? m[1] || m[2] : null;
}

export function isMultipartContentType(contentType: string): boolean {
  return /multipart\//i.test(contentType);
}

/** Parse multipart body from raw bytes (preferred for files). */
export function parseMultipartBytes(bytes: Uint8Array, contentType: string): MultipartPart[] | null {
  const boundary = extractBoundary(contentType);
  if (!boundary) return null;
  const enc = new TextEncoder();
  const dec = new TextDecoder("utf-8", { fatal: false });
  const delim = enc.encode(`--${boundary}`);
  const parts: MultipartPart[] = [];

  let pos = indexOfBytes(bytes, delim);
  if (pos === -1) return null;
  pos += delim.length;
  // skip optional leading CRLF after first boundary
  if (bytes[pos] === 13 && bytes[pos + 1] === 10) pos += 2;
  else if (bytes[pos] === 10) pos += 1;

  while (pos < bytes.length) {
    // closing boundary --boundary--
    if (bytes[pos] === 45 && bytes[pos + 1] === 45) break;

    const next = indexOfBytes(bytes, delim, pos);
    const end = next === -1 ? bytes.length : next;
    let chunk = bytes.slice(pos, end);
    // trim trailing CRLF before boundary
    if (chunk.length >= 2 && chunk[chunk.length - 2] === 13 && chunk[chunk.length - 1] === 10) {
      chunk = chunk.slice(0, -2);
    } else if (chunk.length >= 1 && chunk[chunk.length - 1] === 10) {
      chunk = chunk.slice(0, -1);
    }

    const sep = indexOfBytes(chunk, enc.encode("\r\n\r\n"));
    const sep2 = sep === -1 ? indexOfBytes(chunk, enc.encode("\n\n")) : sep;
    const sepLen = sep !== -1 ? 4 : sep2 !== -1 ? 2 : -1;
    const headerEnd = sep !== -1 ? sep : sep2;
    if (headerEnd === -1 || sepLen === -1) {
      pos = next === -1 ? bytes.length : next + delim.length;
      if (bytes[pos] === 13 && bytes[pos + 1] === 10) pos += 2;
      continue;
    }

    const headerText = dec.decode(chunk.slice(0, headerEnd));
    const bodyBytes = chunk.slice(headerEnd + sepLen);
    const headers = headerMap(headerText);
    const disp = parseDisposition(headers["content-disposition"] || "");
    const partCt = headers["content-type"];
    const isFile = Boolean(disp.filename);

    if (isFile) {
      parts.push({
        name: disp.name,
        filename: disp.filename,
        contentType: partCt,
        bytes: bodyBytes,
        isFile: true,
        size: bodyBytes.length,
      });
    } else {
      parts.push({
        name: disp.name,
        contentType: partCt,
        text: dec.decode(bodyBytes),
        isFile: false,
        size: bodyBytes.length,
      });
    }

    if (next === -1) break;
    pos = next + delim.length;
    if (bytes[pos] === 13 && bytes[pos + 1] === 10) pos += 2;
    else if (bytes[pos] === 10) pos += 1;
  }

  return parts.length ? parts : null;
}
