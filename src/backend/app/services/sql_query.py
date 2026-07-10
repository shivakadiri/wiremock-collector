from __future__ import annotations

import re
from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.schemas import QueryResult

FORBIDDEN = re.compile(
    r"\b(insert|update|delete|drop|alter|create|truncate|grant|revoke|copy|call|do|execute|"
    r"comment|vacuum|analyze|reindex|cluster|refresh|security|set|reset|listen|notify|"
    r"prepare|deallocate|discard|lock|unlock)\b",
    re.IGNORECASE,
)
MULTI_STATEMENT = re.compile(r";\s*\S")


def validate_readonly_sql(sql: str) -> str:
    cleaned = sql.strip().rstrip(";").strip()
    if not cleaned:
        raise ValueError("SQL is empty")
    if MULTI_STATEMENT.search(sql.strip()):
        raise ValueError("Multiple statements are not allowed")
    if FORBIDDEN.search(cleaned):
        raise ValueError("Only read-only SELECT / WITH queries are allowed")
    lowered = cleaned.lstrip("(").lstrip().lower()
    if not (lowered.startswith("select") or lowered.startswith("with") or lowered.startswith("explain")):
        raise ValueError("Query must start with SELECT, WITH, or EXPLAIN")
    return cleaned


def _serialize(value: Any) -> Any:
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    if isinstance(value, (bytes, bytearray)):
        return value.decode("utf-8", errors="replace")
    # datetime, date, Decimal, UUID, dict/list from JSONB, etc.
    if hasattr(value, "isoformat"):
        return value.isoformat()
    if isinstance(value, (dict, list)):
        return value
    return str(value)


async def run_readonly_query(session: AsyncSession, sql: str, limit: int = 200) -> QueryResult:
    cleaned = validate_readonly_sql(sql)
    capped = max(1, min(limit, 1000))

    # Wrap user SELECT/WITH in a subquery with LIMIT unless EXPLAIN
    if cleaned.lstrip().lower().startswith("explain"):
        final_sql = cleaned
    else:
        final_sql = f"SELECT * FROM ({cleaned}) AS q LIMIT {capped}"

    result = await session.execute(text(final_sql))
    columns = list(result.keys())
    rows = [[_serialize(v) for v in row] for row in result.fetchall()]
    return QueryResult(columns=columns, rows=rows, row_count=len(rows), truncated=len(rows) >= capped)
