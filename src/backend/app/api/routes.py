from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.instance import Instance
from app.models.request import CollectedRequest
from app.schemas import (
    CollectResult,
    DiscoverResult,
    InstanceCreate,
    InstanceOut,
    InstanceUpdate,
    QueryRequest,
    QueryResult,
    RequestListOut,
    RequestOut,
)
from app.services.collector import collect_all_enabled, collect_instance
from app.services.discovery import sync_discovered_instances
from app.services.sql_query import run_readonly_query
from app.services.wiremock_client import WireMockClient

router = APIRouter(prefix="/api")


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


@router.post("/collect", response_model=list[CollectResult])
async def trigger_collect(db: AsyncSession = Depends(get_db)) -> list[CollectResult]:
    return await collect_all_enabled(db)


@router.post("/instances/{instance_id}/collect", response_model=CollectResult)
async def trigger_collect_one(instance_id: int, db: AsyncSession = Depends(get_db)) -> CollectResult:
    instance = await db.get(Instance, instance_id)
    if not instance:
        raise HTTPException(status_code=404, detail="Instance not found")
    return await collect_instance(
        db,
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
    limit: int = Query(default=50, ge=1, le=500),
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
    list_stmt = select(CollectedRequest)
    method_stmt = select(CollectedRequest.method, func.count()).select_from(CollectedRequest)
    if filters:
        count_stmt = count_stmt.where(*filters)
        list_stmt = list_stmt.where(*filters)
    if base_filters:
        method_stmt = method_stmt.where(*base_filters)
    method_stmt = method_stmt.group_by(CollectedRequest.method).order_by(func.count().desc())

    total = (await db.execute(count_stmt)).scalar_one()
    method_rows = (await db.execute(method_stmt)).all()
    method_counts = {str(m): int(c) for m, c in method_rows if m}
    list_stmt = (
        list_stmt.order_by(
            func.coalesce(CollectedRequest.logged_at, CollectedRequest.collected_at).desc(),
            CollectedRequest.id.desc(),
        )
        .limit(limit)
        .offset(offset)
    )
    rows = (await db.execute(list_stmt)).scalars().all()
    return RequestListOut(
        items=[RequestOut.model_validate(r) for r in rows],
        total=total,
        limit=limit,
        offset=offset,
        method_counts=method_counts,
    )


@router.get("/requests/{request_id}", response_model=RequestOut)
async def get_request(request_id: int, db: AsyncSession = Depends(get_db)) -> CollectedRequest:
    row = await db.get(CollectedRequest, request_id)
    if not row:
        raise HTTPException(status_code=404, detail="Request not found")
    return row


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
