from datetime import datetime

from pydantic import BaseModel, Field


class InstanceCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    base_url: str = Field(min_length=1, max_length=512)
    enabled: bool = True


class InstanceUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=255)
    base_url: str | None = Field(default=None, min_length=1, max_length=512)
    enabled: bool | None = None


class InstanceOut(BaseModel):
    id: int
    name: str
    base_url: str
    enabled: bool
    source: str
    docker_container_id: str | None
    docker_name: str | None
    last_collected_at: datetime | None
    last_error: str | None
    created_at: datetime

    model_config = {"from_attributes": True}


class RequestOut(BaseModel):
    id: int
    instance_id: int
    wiremock_request_id: str
    method: str
    url: str
    absolute_url: str | None
    status: int | None
    was_matched: bool
    stub_mapping_id: str | None
    stub_name: str | None = None
    logged_at: datetime | None
    timing_total: int | None
    payload: dict
    collected_at: datetime
    request_body_truncated: bool = False
    response_body_truncated: bool = False

    model_config = {"from_attributes": True}


class RequestBodyOut(BaseModel):
    id: int
    part: str
    section: dict


class RequestListOut(BaseModel):
    items: list[RequestOut]
    total: int
    limit: int
    offset: int
    method_counts: dict[str, int] = {}


class CollectResult(BaseModel):
    instance_id: int
    instance_name: str
    fetched: int
    inserted: int
    error: str | None = None
    journal_cleared: bool = False


class ClearJournalResult(BaseModel):
    instance_id: int
    instance_name: str
    cleared: bool
    error: str | None = None


class AppSettingsOut(BaseModel):
    clear_journal_after_collect: bool
    collect_interval_seconds: int


class AppSettingsUpdate(BaseModel):
    clear_journal_after_collect: bool | None = None


class DiscoveredInstanceOut(BaseModel):
    name: str
    base_url: str
    docker_container_id: str | None
    docker_name: str | None
    image: str
    verified: bool
    reason: str
    action: str
    instance_id: int | None = None


class DiscoverResult(BaseModel):
    scanned: int
    added: list[DiscoveredInstanceOut]
    updated: list[DiscoveredInstanceOut]
    skipped: list[DiscoveredInstanceOut]
    errors: list[str]


class QueryRequest(BaseModel):
    sql: str = Field(min_length=1, max_length=20_000)
    limit: int = Field(default=200, ge=1, le=1000)


class QueryResult(BaseModel):
    columns: list[str]
    rows: list[list]
    row_count: int
    truncated: bool
