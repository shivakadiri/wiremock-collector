"""Helpers to slim journal payloads for list/detail responses."""

from __future__ import annotations

import copy
import json
from typing import Any


def estimate_section_body_size(section: dict[str, Any]) -> int:
    b64 = section.get("bodyAsBase64")
    if isinstance(b64, str) and b64:
        return len(b64)
    body = section.get("body")
    if isinstance(body, str):
        return len(body)
    if body is None:
        return 0
    try:
        return len(json.dumps(body, default=str))
    except TypeError:
        return len(str(body))


def extract_stub_name(payload: dict[str, Any] | None, stub_mapping_id: str | None = None) -> str | None:
    if not payload or not isinstance(payload, dict):
        return stub_mapping_id
    stub = payload.get("stubMapping")
    if isinstance(stub, dict):
        name = stub.get("name")
        if name:
            return str(name)
        meta = stub.get("metadata")
        if isinstance(meta, dict) and meta.get("name"):
            return str(meta["name"])
        stub_id = stub.get("id")
        if stub_id:
            return str(stub_id)
    return stub_mapping_id


def slim_stub_mapping(stub: Any) -> Any:
    """Keep identity fields; drop nested request/response templates that can be huge."""
    if not isinstance(stub, dict):
        return stub
    keep_keys = (
        "id",
        "name",
        "uuid",
        "priority",
        "metadata",
        "scenarioName",
        "requiredScenarioState",
        "newScenarioState",
    )
    return {k: stub[k] for k in keep_keys if k in stub}


def _slim_http_section(section: Any, *, keep_headers: bool) -> dict[str, Any]:
    if not isinstance(section, dict):
        return {"_bodyTruncated": False, "_bodySize": 0}
    size = estimate_section_body_size(section)
    out: dict[str, Any] = {
        "_bodyTruncated": size > 0,
        "_bodySize": size,
    }
    # Keep small identity fields for the detail chrome without bodies.
    for key in ("url", "absoluteUrl", "method", "status"):
        if key in section:
            out[key] = section[key]
    if keep_headers and "headers" in section:
        out["headers"] = section["headers"]
    return out


def slim_payload_meta(payload: dict[str, Any] | None, *, keep_headers: bool = True) -> dict[str, Any]:
    """Drop all bodies; keep headers/url/stub identity for a lightweight detail view."""
    if not payload or not isinstance(payload, dict):
        return {
            "request": {"_bodyTruncated": False, "_bodySize": 0},
            "response": {"_bodyTruncated": False, "_bodySize": 0},
        }
    out: dict[str, Any] = {
        "request": _slim_http_section(payload.get("request"), keep_headers=keep_headers),
        "response": _slim_http_section(payload.get("response"), keep_headers=keep_headers),
    }
    if "stubMapping" in payload:
        out["stubMapping"] = slim_stub_mapping(payload.get("stubMapping"))
    for key in ("id", "wasMatched", "timing", "loggedDate", "loggedDateString"):
        if key in payload:
            out[key] = payload[key]
    return out


def list_payload_stub(
    *,
    stub_name: str | None,
    stub_mapping_id: str | None,
    req_size: int,
    res_size: int,
) -> dict[str, Any]:
    """Minimal payload for list rows — never includes bodies or headers."""
    stub: dict[str, Any] = {}
    if stub_mapping_id:
        stub["id"] = stub_mapping_id
    if stub_name and stub_name != stub_mapping_id:
        stub["name"] = stub_name
    return {
        "request": {"_bodyTruncated": req_size > 0, "_bodySize": req_size},
        "response": {"_bodyTruncated": res_size > 0, "_bodySize": res_size},
        "stubMapping": stub or None,
    }


def section_only(payload: dict[str, Any] | None, part: str) -> dict[str, Any]:
    if not payload or not isinstance(payload, dict):
        return {}
    section = payload.get(part)
    return copy.deepcopy(section) if isinstance(section, dict) else {}
