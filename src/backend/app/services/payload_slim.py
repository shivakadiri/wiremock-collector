"""Helpers to slim journal payloads for list responses."""

from __future__ import annotations

import copy
import json
from typing import Any

# Bodies larger than this are omitted from list/detail-until-fetch responses.
BODY_FETCH_THRESHOLD = 8_192


def estimate_section_body_size(section: dict[str, Any]) -> int:
    b64 = section.get("bodyAsBase64")
    if isinstance(b64, str) and b64:
        # base64 is ~4/3 of raw bytes; use encoded length as conservative size
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
    keep_keys = ("id", "name", "uuid", "priority", "metadata", "scenarioName", "requiredScenarioState", "newScenarioState")
    return {k: stub[k] for k in keep_keys if k in stub}


def strip_large_bodies(payload: dict[str, Any] | None) -> dict[str, Any]:
    """Return a copy of payload with oversized request/response bodies removed."""
    if not payload or not isinstance(payload, dict):
        return {}
    out = copy.deepcopy(payload)
    if "stubMapping" in out:
        out["stubMapping"] = slim_stub_mapping(out.get("stubMapping"))

    for key in ("request", "response"):
        section = out.get(key)
        if not isinstance(section, dict):
            continue
        size = estimate_section_body_size(section)
        if size <= BODY_FETCH_THRESHOLD:
            continue
        section.pop("body", None)
        section.pop("bodyAsBase64", None)
        section["_bodyTruncated"] = True
        section["_bodySize"] = size
        out[key] = section
    return out
