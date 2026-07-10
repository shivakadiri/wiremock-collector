from typing import Any

import httpx


class WireMockClient:
    def __init__(self, base_url: str, timeout: float = 15.0):
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout

    def _url(self, path: str) -> str:
        return f"{self.base_url}{path}"

    async def get_requests(self) -> list[dict[str, Any]]:
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            response = await client.get(self._url("/__admin/requests"))
            response.raise_for_status()
            data = response.json()
            return data.get("requests", [])

    async def get_mappings(self) -> list[dict[str, Any]]:
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            response = await client.get(self._url("/__admin/mappings"))
            response.raise_for_status()
            data = response.json()
            return data.get("mappings", [])

    async def get_scenarios(self) -> list[dict[str, Any]]:
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            response = await client.get(self._url("/__admin/scenarios"))
            response.raise_for_status()
            data = response.json()
            return data.get("scenarios", [])
