import base64
import gzip
from typing import Any


def _header_value(headers: Any, name: str) -> str:
    if not isinstance(headers, dict):
        return ""
    target = name.lower()
    for key, value in headers.items():
        if str(key).lower() == target:
            if isinstance(value, list):
                return str(value[0]) if value else ""
            return str(value or "")
    return ""


def decode_http_section(section: Any) -> Any:
    """Decode WireMock request/response bodies (base64 + gzip) into readable UTF-8 text."""
    if not isinstance(section, dict):
        return section

    headers = section.get("headers") or {}
    encoding = _header_value(headers, "Content-Encoding").lower()
    raw: bytes | None = None

    b64 = section.get("bodyAsBase64")
    if isinstance(b64, str) and b64:
        try:
            raw = base64.b64decode(b64)
        except Exception:  # noqa: BLE001
            raw = None

    body = section.get("body")
    # Prefer base64 bytes when body looks like binary/gzip mojibake
    if raw is None and isinstance(body, str) and body:
        if "gzip" in encoding or (body and body[0] == "\x1f"):
            try:
                raw = body.encode("latin-1")
            except UnicodeEncodeError:
                raw = None
        else:
            return section

    if raw is None:
        return section

    if "gzip" in encoding or raw[:2] == b"\x1f\x8b":
        try:
            raw = gzip.decompress(raw)
        except Exception:  # noqa: BLE001
            pass

    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError:
        text = raw.decode("utf-8", errors="replace")

    updated = dict(section)
    updated["body"] = text.replace("\x00", "")
    # Body is now plain text; drop encoding so viewers don't try to gunzip again
    if isinstance(headers, dict) and encoding:
        new_headers = {
            k: v
            for k, v in headers.items()
            if str(k).lower() != "content-encoding"
        }
        updated["headers"] = new_headers
        updated["_decodedContentEncoding"] = encoding
    return updated


def normalize_journal_payload(payload: dict[str, Any]) -> dict[str, Any]:
    out = dict(payload)
    if "request" in out:
        out["request"] = decode_http_section(out.get("request"))
    if "response" in out:
        out["response"] = decode_http_section(out.get("response"))
    return out
