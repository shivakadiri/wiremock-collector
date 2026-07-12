from datetime import datetime, timezone
from typing import Any

from sqlalchemy import select, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import SessionLocal
from app.models.instance import Instance
from app.models.request import CollectedRequest
from app.schemas import ClearJournalResult, CollectResult
from app.services.body_decode import normalize_journal_payload
from app.services.wiremock_client import WireMockClient


def _strip_nulls(value: Any) -> Any:
    """Postgres text/jsonb cannot store NUL (\\u0000); WireMock bodies sometimes include it."""
    if isinstance(value, str):
        return value.replace("\x00", "")
    if isinstance(value, dict):
        return {str(k).replace("\x00", ""): _strip_nulls(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_strip_nulls(v) for v in value]
    return value


def _parse_logged_at(value: Any) -> datetime | None:
    if value is None:
        return None
    if isinstance(value, (int, float)):
        # WireMock often returns epoch millis
        ts = float(value)
        if ts > 1_000_000_000_000:
            ts = ts / 1000.0
        return datetime.fromtimestamp(ts, tz=timezone.utc)
    if isinstance(value, str):
        try:
            return datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            return None
    return None


def _extract_fields(raw: dict[str, Any]) -> dict[str, Any]:
    clean = _strip_nulls(raw)
    if not isinstance(clean, dict):
        clean = {"value": clean}
    clean = normalize_journal_payload(clean)

    request = clean.get("request") or {}
    response = clean.get("response") or {}
    timing = clean.get("timing") or {}
    stub = clean.get("stubMapping") or {}

    absolute_url = request.get("absoluteUrl")
    if absolute_url is not None:
        absolute_url = str(absolute_url)

    stub_id = stub.get("id") or clean.get("stubMappingId")
    if stub_id is not None:
        stub_id = str(stub_id)

    logged_at = _parse_logged_at(
        clean.get("loggedDate")
        or clean.get("loggedDateString")
        or clean.get("loggedDateTime")
    )

    return {
        "wiremock_request_id": str(clean.get("id") or ""),
        "method": str(request.get("method") or "UNKNOWN")[:16],
        "url": str(request.get("url") or request.get("absoluteUrl") or ""),
        "absolute_url": absolute_url,
        "status": response.get("status") if isinstance(response.get("status"), int) else None,
        "was_matched": bool(clean.get("wasMatched", False)),
        "stub_mapping_id": stub_id,
        "logged_at": logged_at or datetime.now(timezone.utc),
        "timing_total": timing.get("totalTime") if isinstance(timing, dict) else None,
        "payload": clean,
    }


async def _mark_instance_error(session: AsyncSession, instance_id: int, error: str) -> None:
    await session.rollback()
    await session.execute(
        update(Instance).where(Instance.id == instance_id).values(last_error=error[:4000])
    )
    await session.commit()


async def collect_instance(
    session: AsyncSession,
    *,
    instance_id: int,
    instance_name: str,
    base_url: str,
    clear_after: bool | None = None,
) -> CollectResult:
    """Collect journals for one instance using only primitives (no live ORM object)."""
    from app.services.runtime_settings import get_clear_journal_after_collect

    do_clear = get_clear_journal_after_collect() if clear_after is None else clear_after
    client = WireMockClient(base_url)
    try:
        raw_requests = await client.get_requests()
    except Exception as exc:  # noqa: BLE001 - surface any poll failure to UI
        await _mark_instance_error(session, instance_id, str(exc))
        return CollectResult(
            instance_id=instance_id,
            instance_name=instance_name,
            fetched=0,
            inserted=0,
            error=str(exc),
        )

    inserted = 0
    try:
        for raw in raw_requests:
            if not isinstance(raw, dict):
                continue
            fields = _extract_fields(raw)
            if not fields["wiremock_request_id"]:
                continue

            stmt = (
                insert(CollectedRequest)
                .values(instance_id=instance_id, **fields)
                .on_conflict_do_nothing(constraint="uq_instance_wiremock_request")
            )
            result = await session.execute(stmt)
            if result.rowcount and result.rowcount > 0:
                inserted += 1

        await session.execute(
            update(Instance)
            .where(Instance.id == instance_id)
            .values(last_collected_at=datetime.now(timezone.utc), last_error=None)
        )
        await session.commit()
    except Exception as exc:  # noqa: BLE001
        await _mark_instance_error(session, instance_id, str(exc))
        return CollectResult(
            instance_id=instance_id,
            instance_name=instance_name,
            fetched=len(raw_requests),
            inserted=0,
            error=str(exc),
        )

    journal_cleared = False
    if do_clear:
        try:
            await client.clear_requests()
            journal_cleared = True
        except Exception as exc:  # noqa: BLE001
            await _mark_instance_error(
                session,
                instance_id,
                f"Collected OK but failed to clear WireMock journal: {exc}",
            )
            return CollectResult(
                instance_id=instance_id,
                instance_name=instance_name,
                fetched=len(raw_requests),
                inserted=inserted,
                error=f"clear journal failed: {exc}",
                journal_cleared=False,
            )

    return CollectResult(
        instance_id=instance_id,
        instance_name=instance_name,
        fetched=len(raw_requests),
        inserted=inserted,
        journal_cleared=journal_cleared,
    )


async def collect_all_enabled(
    _session: AsyncSession | None = None,
    *,
    clear_after: bool | None = None,
) -> list[CollectResult]:
    """Collect from every enabled instance using a fresh session per instance."""
    async with SessionLocal() as list_session:
        result = await list_session.execute(
            select(Instance.id, Instance.name, Instance.base_url).where(Instance.enabled.is_(True))
        )
        rows = list(result.all())

    results: list[CollectResult] = []
    for instance_id, instance_name, base_url in rows:
        async with SessionLocal() as session:
            results.append(
                await collect_instance(
                    session,
                    instance_id=instance_id,
                    instance_name=instance_name,
                    base_url=base_url,
                    clear_after=clear_after,
                )
            )
    return results


async def clear_instance_journal(
    *,
    instance_id: int,
    instance_name: str,
    base_url: str,
) -> ClearJournalResult:
    client = WireMockClient(base_url)
    try:
        await client.clear_requests()
        return ClearJournalResult(
            instance_id=instance_id,
            instance_name=instance_name,
            cleared=True,
        )
    except Exception as exc:  # noqa: BLE001
        return ClearJournalResult(
            instance_id=instance_id,
            instance_name=instance_name,
            cleared=False,
            error=str(exc),
        )


async def clear_all_enabled_journals() -> list[ClearJournalResult]:
    async with SessionLocal() as session:
        result = await session.execute(
            select(Instance.id, Instance.name, Instance.base_url).where(Instance.enabled.is_(True))
        )
        rows = list(result.all())
    return [
        await clear_instance_journal(instance_id=i, instance_name=n, base_url=u) for i, n, u in rows
    ]
