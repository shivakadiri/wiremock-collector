from __future__ import annotations

import logging

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.instance import Instance
from app.schemas import DiscoverResult, DiscoveredInstanceOut
from app.services.docker_discovery import (
    DiscoveredCandidate,
    discover_wiremock_candidates,
    sanitize_instance_name,
)

logger = logging.getLogger(__name__)


async def _unique_name(session: AsyncSession, desired: str, container_id: str) -> str:
    base = sanitize_instance_name(desired)
    candidate = base
    suffix = container_id[:8] if container_id else "1"
    n = 0
    while True:
        existing = await session.execute(select(Instance).where(Instance.name == candidate))
        row = existing.scalar_one_or_none()
        if row is None:
            return candidate
        n += 1
        candidate = f"{base}-{suffix}" if n == 1 else f"{base}-{suffix}-{n}"


async def sync_discovered_instances(session: AsyncSession) -> DiscoverResult:
    try:
        candidates = await discover_wiremock_candidates()
    except FileNotFoundError as exc:
        return DiscoverResult(
            scanned=0,
            added=[],
            updated=[],
            skipped=[],
            errors=[str(exc)],
        )
    except Exception as exc:  # noqa: BLE001
        logger.exception("Docker discovery failed")
        return DiscoverResult(
            scanned=0,
            added=[],
            updated=[],
            skipped=[],
            errors=[str(exc)],
        )

    added: list[DiscoveredInstanceOut] = []
    updated: list[DiscoveredInstanceOut] = []
    skipped: list[DiscoveredInstanceOut] = []

    for cand in candidates:
        out = _to_out(cand)
        if not cand.verified or not cand.base_url:
            skipped.append(out.model_copy(update={"action": "skipped"}))
            continue

        by_docker = None
        if cand.docker_container_id:
            result = await session.execute(
                select(Instance).where(Instance.docker_container_id == cand.docker_container_id)
            )
            by_docker = result.scalar_one_or_none()

        if by_docker:
            changed = False
            if by_docker.base_url != cand.base_url:
                by_docker.base_url = cand.base_url
                changed = True
            if by_docker.docker_name != cand.docker_name:
                by_docker.docker_name = cand.docker_name
                changed = True
            if changed:
                await session.commit()
                await session.refresh(by_docker)
                updated.append(
                    DiscoveredInstanceOut(
                        name=by_docker.name,
                        base_url=by_docker.base_url,
                        docker_container_id=by_docker.docker_container_id,
                        docker_name=by_docker.docker_name,
                        image=cand.image,
                        verified=True,
                        reason="Updated existing Docker instance",
                        action="updated",
                        instance_id=by_docker.id,
                    )
                )
            else:
                skipped.append(
                    DiscoveredInstanceOut(
                        name=by_docker.name,
                        base_url=by_docker.base_url,
                        docker_container_id=by_docker.docker_container_id,
                        docker_name=by_docker.docker_name,
                        image=cand.image,
                        verified=True,
                        reason="Already registered",
                        action="skipped",
                        instance_id=by_docker.id,
                    )
                )
            continue

        by_url = await session.execute(select(Instance).where(Instance.base_url == cand.base_url))
        existing_url = by_url.scalar_one_or_none()
        if existing_url:
            if not existing_url.docker_container_id and cand.docker_container_id:
                existing_url.docker_container_id = cand.docker_container_id
                existing_url.docker_name = cand.docker_name
                existing_url.source = "docker"
                await session.commit()
                await session.refresh(existing_url)
                updated.append(
                    DiscoveredInstanceOut(
                        name=existing_url.name,
                        base_url=existing_url.base_url,
                        docker_container_id=existing_url.docker_container_id,
                        docker_name=existing_url.docker_name,
                        image=cand.image,
                        verified=True,
                        reason="Linked existing URL to Docker container",
                        action="updated",
                        instance_id=existing_url.id,
                    )
                )
            else:
                skipped.append(
                    DiscoveredInstanceOut(
                        name=existing_url.name,
                        base_url=existing_url.base_url,
                        docker_container_id=existing_url.docker_container_id,
                        docker_name=existing_url.docker_name,
                        image=cand.image,
                        verified=True,
                        reason="URL already registered",
                        action="skipped",
                        instance_id=existing_url.id,
                    )
                )
            continue

        name = await _unique_name(session, cand.name, cand.docker_container_id)
        instance = Instance(
            name=name,
            base_url=cand.base_url,
            enabled=True,
            source="docker",
            docker_container_id=cand.docker_container_id,
            docker_name=cand.docker_name,
        )
        session.add(instance)
        await session.commit()
        await session.refresh(instance)
        added.append(
            DiscoveredInstanceOut(
                name=instance.name,
                base_url=instance.base_url,
                docker_container_id=instance.docker_container_id,
                docker_name=instance.docker_name,
                image=cand.image,
                verified=True,
                reason="Added from Docker",
                action="added",
                instance_id=instance.id,
            )
        )

    return DiscoverResult(
        scanned=len(candidates),
        added=added,
        updated=updated,
        skipped=skipped,
        errors=[],
    )


def _to_out(cand: DiscoveredCandidate) -> DiscoveredInstanceOut:
    return DiscoveredInstanceOut(
        name=cand.name,
        base_url=cand.base_url,
        docker_container_id=cand.docker_container_id,
        docker_name=cand.docker_name,
        image=cand.image,
        verified=cand.verified,
        reason=cand.reason,
        action="skipped",
        instance_id=None,
    )
