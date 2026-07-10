from __future__ import annotations

import logging
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import httpx

from app.config import settings

logger = logging.getLogger(__name__)

WIREMOCK_IMAGE_HINTS = (
    "wiremock/wiremock",
    "wiremock-studio",
    "holomekc/wiremock",
    "rodolpheche/wiremock",
    "up9inc/wiremock",
)
WIREMOCK_NAME_HINTS = ("wiremock",)
EXCLUDE_HINTS = (
    "wiremock-collector",
)
WIREMOCK_LABEL_KEYS = (
    "wiremock.collector",
    "com.wiremock",
    "org.wiremock",
)
DEFAULT_ADMIN_PORTS = (8080, 8081, 8443, 9000, 9001)
PREFERRED_PUBLIC_PORTS = {8080, 8081, 8443, 9000, 9001, 19000}
MAX_URLS_PER_CONTAINER = 12


@dataclass
class DiscoveredCandidate:
    name: str
    base_url: str
    docker_container_id: str
    docker_name: str
    image: str
    verified: bool
    reason: str


def _looks_like_wiremock(container: dict[str, Any]) -> bool:
    image = str(container.get("Image") or "").lower()
    names = " ".join(container.get("Names") or []).lower()
    labels = container.get("Labels") or {}
    blob = f"{image} {names}"

    if any(ex in blob for ex in EXCLUDE_HINTS):
        return False

    for key in WIREMOCK_LABEL_KEYS:
        if key in labels:
            return True
    if any(hint in image for hint in WIREMOCK_IMAGE_HINTS):
        return True
    # Name token match: wiremock or wiremock-* but not our collector
    if re.search(r"(^|[^a-z])wiremock($|[^a-z])", names) or "wiremock-" in names:
        if "wiremock-collector" not in names:
            return True
    if any(hint in names for hint in WIREMOCK_NAME_HINTS) and "wiremock-collector" not in names:
        # bare "wiremock" image names like library rebuilds
        if "wiremock" in image:
            return True
    return False


def _container_short_name(container: dict[str, Any]) -> str:
    names = container.get("Names") or []
    if names:
        return str(names[0]).lstrip("/")
    return str(container.get("Id", "wiremock")[:12])


def _candidate_urls(container: dict[str, Any]) -> list[str]:
    urls: list[str] = []
    seen: set[str] = set()

    def add(url: str) -> None:
        url = url.rstrip("/")
        if url not in seen:
            seen.add(url)
            urls.append(url)

    ports = container.get("Ports") or []
    preferred: list[tuple[int, int | None]] = []
    others: list[tuple[int, int | None]] = []
    for port in ports:
        public = port.get("PublicPort")
        private = port.get("PrivatePort")
        if not public and not private:
            continue
        bucket = preferred if (public in PREFERRED_PUBLIC_PORTS or private in PREFERRED_PUBLIC_PORTS) else others
        bucket.append((int(public) if public else 0, int(private) if private else None))

    # Prefer common WireMock ports, then a small sample of the rest (Studio publishes huge ranges)
    ordered = preferred + sorted(others, key=lambda x: x[0])[:8]
    for public, private in ordered:
        if public:
            add(f"http://{settings.docker_host_gateway}:{public}")
        if private:
            networks = (container.get("NetworkSettings") or {}).get("Networks") or {}
            for net in networks.values():
                cip = net.get("IPAddress")
                if cip:
                    add(f"http://{cip}:{private}")
        if len(urls) >= MAX_URLS_PER_CONTAINER:
            return urls[:MAX_URLS_PER_CONTAINER]

    if not urls:
        networks = (container.get("NetworkSettings") or {}).get("Networks") or {}
        for net in networks.values():
            cip = net.get("IPAddress")
            if not cip:
                continue
            for p in DEFAULT_ADMIN_PORTS:
                add(f"http://{cip}:{p}")

    return urls[:MAX_URLS_PER_CONTAINER]


async def _probe_wiremock(base_url: str, client: httpx.AsyncClient) -> bool:
    """Require a real WireMock admin JSON response (not an HTML SPA fallback)."""
    url = f"{base_url.rstrip('/')}/__admin/mappings"
    try:
        response = await client.get(url)
    except Exception:  # noqa: BLE001
        return False
    if response.status_code != 200:
        return False
    content_type = response.headers.get("content-type", "").lower()
    if "json" not in content_type:
        return False
    try:
        data = response.json()
    except Exception:  # noqa: BLE001
        return False
    return isinstance(data, dict) and "mappings" in data


async def list_docker_containers() -> list[dict[str, Any]]:
    socket_path = Path(settings.docker_socket)
    if not socket_path.exists():
        raise FileNotFoundError(f"Docker socket not found at {settings.docker_socket}")

    transport = httpx.AsyncHTTPTransport(uds=str(socket_path))
    async with httpx.AsyncClient(transport=transport, base_url="http://localhost", timeout=10.0) as client:
        # Inspect gives NetworkSettings.Networks with IPs; list endpoint includes Ports
        response = await client.get("/containers/json", params={"all": "false"})
        response.raise_for_status()
        containers = response.json()

        detailed: list[dict[str, Any]] = []
        for c in containers:
            cid = c.get("Id")
            if not cid:
                continue
            try:
                insp = await client.get(f"/containers/{cid}/json")
                insp.raise_for_status()
                info = insp.json()
                # Normalize to list-like shape used by helpers
                detailed.append(
                    {
                        "Id": info.get("Id") or cid,
                        "Image": (info.get("Config") or {}).get("Image") or c.get("Image"),
                        "Names": [info.get("Name")] if info.get("Name") else c.get("Names"),
                        "Labels": (info.get("Config") or {}).get("Labels") or c.get("Labels") or {},
                        "Ports": c.get("Ports") or [],
                        "NetworkSettings": info.get("NetworkSettings") or {},
                    }
                )
            except Exception:  # noqa: BLE001
                detailed.append(c)
        return detailed


async def discover_wiremock_candidates() -> list[DiscoveredCandidate]:
    containers = await list_docker_containers()
    candidates: list[DiscoveredCandidate] = []

    async with httpx.AsyncClient(timeout=3.0) as probe_client:
        for container in containers:
            if not _looks_like_wiremock(container):
                continue

            docker_name = _container_short_name(container)
            container_id = str(container.get("Id") or "")[:64]
            image = str(container.get("Image") or "")
            urls = _candidate_urls(container)
            if not urls:
                candidates.append(
                    DiscoveredCandidate(
                        name=docker_name,
                        base_url="",
                        docker_container_id=container_id,
                        docker_name=docker_name,
                        image=image,
                        verified=False,
                        reason="No published or network ports found",
                    )
                )
                continue

            verified_url: str | None = None
            for url in urls:
                if await _probe_wiremock(url, probe_client):
                    verified_url = url
                    break

            if verified_url:
                candidates.append(
                    DiscoveredCandidate(
                        name=docker_name,
                        base_url=verified_url,
                        docker_container_id=container_id,
                        docker_name=docker_name,
                        image=image,
                        verified=True,
                        reason="Verified WireMock admin API",
                    )
                )
            else:
                # Still surface best-guess URL so user can add manually if probe failed
                candidates.append(
                    DiscoveredCandidate(
                        name=docker_name,
                        base_url=urls[0],
                        docker_container_id=container_id,
                        docker_name=docker_name,
                        image=image,
                        verified=False,
                        reason="Matched WireMock image/name but admin probe failed",
                    )
                )

    return candidates


def sanitize_instance_name(name: str) -> str:
    cleaned = re.sub(r"[^a-zA-Z0-9._-]+", "-", name).strip("-._")
    return cleaned[:255] or "wiremock"
