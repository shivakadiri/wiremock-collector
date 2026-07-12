from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.instance import Instance
from app.models.request import CollectedRequest
from app.schemas import (
    AppSettingsOut,
    AppSettingsUpdate,
    ClearJournalResult,
    CollectResult,
    DiscoverResult,
    InstanceCreate,
    InstanceOut,
    InstanceUpdate,
    QueryRequest,
    QueryResult,
    RequestBodyOut,
    RequestListOut,
    RequestOut,
)
from app.services.collector import (
    clear_all_enabled_journals,
    clear_instance_journal,
    collect_all_enabled,
    collect_instance,
)
from app.services.discovery import sync_discovered_instances
from app.services.payload_slim import (
    extract_stub_name,
    list_payload_stub,
    section_only,
    slim_payload_meta,
)
from app.services.runtime_settings import (
    get_clear_journal_after_collect,
    set_clear_journal_after_collect,
)
from app.services.sql_query import run_readonly_query
from app.services.wiremock_client import WireMockClient
from app.config import settings

router = APIRouter(prefix="/api")


def _json_text(*path: str):
    """Extract nested JSONB text without loading the full document into the ORM."""
    return func.jsonb_extract_path_text(CollectedRequest.payload, *path)


def _request_out(row: CollectedRequest, *, full_payload: bool) -> RequestOut:
    payload = row.payload if isinstance(row.payload, dict) else {}
    stub_name = extract_stub_name(payload, row.stub_mapping_id)
    if full_payload:
        slim = payload
        req_trunc = False
        res_trunc = False
    else:
        slim = slim_payload_meta(payload, keep_headers=True)
        req = slim.get("request") if isinstance(slim.get("request"), dict) else {}
        res = slim.get("response") if isinstance(slim.get("response"), dict) else {}
        req_trunc = bool(req.get("_bodyTruncated"))
        res_trunc = bool(res.get("_bodyTruncated"))
    return RequestOut(
        id=row.id,
        instance_id=row.instance_id,
        wiremock_request_id=row.wiremock_request_id,
        method=row.method,
        url=row.url,
        absolute_url=row.absolute_url,
        status=row.status,
        was_matched=row.was_matched,
        stub_mapping_id=row.stub_mapping_id,
        stub_name=stub_name,
        logged_at=row.logged_at,
        timing_total=row.timing_total,
        payload=slim,
        collected_at=row.collected_at,
        request_body_truncated=req_trunc,
        response_body_truncated=res_trunc,
    )

@router.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@router.get("/instances", response_model=list[InstanceOut])
async def list_instances(db: AsyncSession = Depends(get_db)) -> list[Instance]:
    result = await db.execute(select(Instance).order_by(Instance.name))
    return list(result.scalars().all())


@router.post("/instances", response_model=InstanceOut, status_code=status.HTTP_201_CREATED)
async def create_instance(body: InstanceCreate, db: AsyncSession = Depends(get_db)) -> Instance:
    existing = await db.execute(select(Instance).where(Instance.name == body.name))
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="Instance name already exists")

    by_url = await db.execute(select(Instance).where(Instance.base_url == body.base_url.rstrip("/")))
    if by_url.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="Instance URL already exists")

    instance = Instance(
        name=body.name,
        base_url=body.base_url.rstrip("/"),
        enabled=body.enabled,
        source="manual",
    )
    db.add(instance)
    await db.commit()
    await db.refresh(instance)
    return instance


@router.post("/instances/discover", response_model=DiscoverResult)
async def discover_instances(db: AsyncSession = Depends(get_db)) -> DiscoverResult:
    """Scan Docker for WireMock containers and register new ones."""
    return await sync_discovered_instances(db)


@router.patch("/instances/{instance_id}", response_model=InstanceOut)
async def update_instance(
    instance_id: int, body: InstanceUpdate, db: AsyncSession = Depends(get_db)
) -> Instance:
    instance = await db.get(Instance, instance_id)
    if not instance:
        raise HTTPException(status_code=404, detail="Instance not found")

    data = body.model_dump(exclude_unset=True)
    if "base_url" in data and data["base_url"]:
        data["base_url"] = data["base_url"].rstrip("/")
    for key, value in data.items():
        setattr(instance, key, value)

    await db.commit()
    await db.refresh(instance)
    return instance


@router.delete("/instances/{instance_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_instance(instance_id: int, db: AsyncSession = Depends(get_db)) -> None:
    instance = await db.get(Instance, instance_id)
    if not instance:
        raise HTTPException(status_code=404, detail="Instance not found")
    await db.delete(instance)
    await db.commit()


@router.get("/settings", response_model=AppSettingsOut)
async def get_settings() -> AppSettingsOut:
    return AppSettingsOut(
        clear_journal_after_collect=get_clear_journal_after_collect(),
        collect_interval_seconds=settings.collect_interval_seconds,
    )


@router.patch("/settings", response_model=AppSettingsOut)
async def patch_settings(body: AppSettingsUpdate) -> AppSettingsOut:
    if body.clear_journal_after_collect is not None:
        set_clear_journal_after_collect(body.clear_journal_after_collect)
    return AppSettingsOut(
        clear_journal_after_collect=get_clear_journal_after_collect(),
        collect_interval_seconds=settings.collect_interval_seconds,
    )


@router.post("/collect", response_model=list[CollectResult])
async def trigger_collect(
    clear_after: bool | None = Query(
        default=None,
        description="Clear WireMock journals after collect; omit to use app setting",
    ),
    db: AsyncSession = Depends(get_db),
) -> list[CollectResult]:
    return await collect_all_enabled(db, clear_after=clear_after)


@router.post("/instances/{instance_id}/collect", response_model=CollectResult)
async def trigger_collect_one(
    instance_id: int,
    clear_after: bool | None = Query(default=None),
    db: AsyncSession = Depends(get_db),
) -> CollectResult:
    instance = await db.get(Instance, instance_id)
    if not instance:
        raise HTTPException(status_code=404, detail="Instance not found")
    return await collect_instance(
        db,
        instance_id=instance.id,
        instance_name=instance.name,
        base_url=instance.base_url,
        clear_after=clear_after,
    )


@router.post("/clear-journals", response_model=list[ClearJournalResult])
async def clear_journals() -> list[ClearJournalResult]:
    """Clear request journals on all enabled WireMock instances (does not delete Postgres rows)."""
    return await clear_all_enabled_journals()


@router.post("/instances/{instance_id}/clear-journal", response_model=ClearJournalResult)
async def clear_journal_one(instance_id: int, db: AsyncSession = Depends(get_db)) -> ClearJournalResult:
    instance = await db.get(Instance, instance_id)
    if not instance:
        raise HTTPException(status_code=404, detail="Instance not found")
    return await clear_instance_journal(
        instance_id=instance.id,
        instance_name=instance.name,
        base_url=instance.base_url,
    )


@router.get("/requests", response_model=RequestListOut)
async def list_requests(
    instance_id: int | None = None,
    method: str | None = None,
    matched: bool | None = None,
    q: str | None = None,
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    db: AsyncSession = Depends(get_db),
) -> RequestListOut:
    filters = []
    # Filters applied to method breakdown (exclude method itself so counts stay visible)
    base_filters = []
    if instance_id is not None:
        filters.append(CollectedRequest.instance_id == instance_id)
        base_filters.append(CollectedRequest.instance_id == instance_id)
    if method:
        filters.append(CollectedRequest.method == method.upper())
    if matched is not None:
        filters.append(CollectedRequest.was_matched.is_(matched))
        base_filters.append(CollectedRequest.was_matched.is_(matched))
    if q:
        filters.append(CollectedRequest.url.ilike(f"%{q}%"))
        base_filters.append(CollectedRequest.url.ilike(f"%{q}%"))

    count_stmt = select(func.count()).select_from(CollectedRequest)
    method_stmt = select(CollectedRequest.method, func.count()).select_from(CollectedRequest)
    if filters:
        count_stmt = count_stmt.where(*filters)
    if base_filters:
        method_stmt = method_stmt.where(*base_filters)
    method_stmt = method_stmt.group_by(CollectedRequest.method).order_by(func.count().desc())

    total = (await db.execute(count_stmt)).scalar_one()
    method_rows = (await db.execute(method_stmt)).all()
    method_counts = {str(m): int(c) for m, c in method_rows if m}

    # Never load full JSONB payload for the list — only indexed cols + cheap JSON path sizes.
    stub_name_expr = func.coalesce(
        _json_text("stubMapping", "name"),
        _json_text("stubMapping", "metadata", "name"),
        CollectedRequest.stub_mapping_id,
    )
    req_size_expr = func.greatest(
        func.coalesce(func.length(_json_text("request", "bodyAsBase64")), 0),
        func.coalesce(func.length(_json_text("request", "body")), 0),
    )
    res_size_expr = func.greatest(
        func.coalesce(func.length(_json_text("response", "bodyAsBase64")), 0),
        func.coalesce(func.length(_json_text("response", "body")), 0),
    )

    list_stmt = select(
        CollectedRequest.id,
        CollectedRequest.instance_id,
        CollectedRequest.wiremock_request_id,
        CollectedRequest.method,
        CollectedRequest.url,
        CollectedRequest.absolute_url,
        CollectedRequest.status,
        CollectedRequest.was_matched,
        CollectedRequest.stub_mapping_id,
        CollectedRequest.logged_at,
        CollectedRequest.timing_total,
        CollectedRequest.collected_at,
        stub_name_expr.label("stub_name"),
        req_size_expr.label("req_size"),
        res_size_expr.label("res_size"),
    )
    if filters:
        list_stmt = list_stmt.where(*filters)
    list_stmt = (
        list_stmt.order_by(
            func.coalesce(CollectedRequest.logged_at, CollectedRequest.collected_at).desc(),
            CollectedRequest.id.desc(),
        )
        .limit(limit)
        .offset(offset)
    )
    rows = (await db.execute(list_stmt)).all()
    items: list[RequestOut] = []
    for row in rows:
        req_size = int(row.req_size or 0)
        res_size = int(row.res_size or 0)
        stub_name = row.stub_name
        items.append(
            RequestOut(
                id=row.id,
                instance_id=row.instance_id,
                wiremock_request_id=row.wiremock_request_id,
                method=row.method,
                url=row.url,
                absolute_url=row.absolute_url,
                status=row.status,
                was_matched=row.was_matched,
                stub_mapping_id=row.stub_mapping_id,
                stub_name=stub_name,
                logged_at=row.logged_at,
                timing_total=row.timing_total,
                payload=list_payload_stub(
                    stub_name=stub_name,
                    stub_mapping_id=row.stub_mapping_id,
                    req_size=req_size,
                    res_size=res_size,
                ),
                collected_at=row.collected_at,
                request_body_truncated=req_size > 0,
                response_body_truncated=res_size > 0,
            )
        )
    return RequestListOut(
        items=items,
        total=total,
        limit=limit,
        offset=offset,
        method_counts=method_counts,
    )


@router.get("/requests/{request_id}", response_model=RequestOut)
async def get_request(
    request_id: int,
    full: bool = Query(
        default=False,
        description="If true, include full bodies; default is headers/meta only",
    ),
    db: AsyncSession = Depends(get_db),
) -> RequestOut:
    row = await db.get(CollectedRequest, request_id)
    if not row:
        raise HTTPException(status_code=404, detail="Request not found")
    return _request_out(row, full_payload=full)


@router.get("/requests/{request_id}/body", response_model=RequestBodyOut)
async def get_request_body(
    request_id: int,
    part: str = Query(..., pattern="^(request|response)$"),
    db: AsyncSession = Depends(get_db),
) -> RequestBodyOut:
    """Fetch a single HTTP section (with body) — avoids loading both huge sides into the UI."""
    row = await db.get(CollectedRequest, request_id)
    if not row:
        raise HTTPException(status_code=404, detail="Request not found")
    section = section_only(row.payload if isinstance(row.payload, dict) else {}, part)
    return RequestBodyOut(id=request_id, part=part, section=section)

@router.get("/instances/{instance_id}/stubs")
async def get_stubs(instance_id: int, db: AsyncSession = Depends(get_db)) -> dict:
    instance = await db.get(Instance, instance_id)
    if not instance:
        raise HTTPException(status_code=404, detail="Instance not found")
    try:
        mappings = await WireMockClient(instance.base_url).get_mappings()
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"Failed to fetch stubs: {exc}") from exc
    return {"mappings": mappings}


@router.get("/instances/{instance_id}/scenarios")
async def get_scenarios(instance_id: int, db: AsyncSession = Depends(get_db)) -> dict:
    instance = await db.get(Instance, instance_id)
    if not instance:
        raise HTTPException(status_code=404, detail="Instance not found")
    try:
        scenarios = await WireMockClient(instance.base_url).get_scenarios()
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"Failed to fetch scenarios: {exc}") from exc
    return {"scenarios": scenarios}


@router.get("/query/schema")
async def query_schema() -> dict:
    """Document available tables/columns for the Query UI."""
    return {
        "tables": [
            {
                "name": "instances",
                "columns": [
                    "id",
                    "name",
                    "base_url",
                    "enabled",
                    "source",
                    "docker_container_id",
                    "docker_name",
                    "last_collected_at",
                    "last_error",
                    "created_at",
                ],
            },
            {
                "name": "requests",
                "columns": [
                    "id",
                    "instance_id",
                    "wiremock_request_id",
                    "method",
                    "url",
                    "absolute_url",
                    "status",
                    "was_matched",
                    "stub_mapping_id",
                    "logged_at",
                    "timing_total",
                    "payload",
                    "collected_at",
                ],
            },
        ]
    }


@router.post("/query", response_model=QueryResult)
async def run_query(body: QueryRequest, db: AsyncSession = Depends(get_db)) -> QueryResult:
    try:
        return await run_readonly_query(db, body.sql, body.limit)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=f"Query failed: {exc}") from exc
