from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncConnection


async def ensure_schema(conn: AsyncConnection) -> None:
    """Apply additive schema changes for existing DBs (create_all won't alter columns)."""
    statements = [
        "ALTER TABLE instances ADD COLUMN IF NOT EXISTS source VARCHAR(32) NOT NULL DEFAULT 'manual'",
        "ALTER TABLE instances ADD COLUMN IF NOT EXISTS docker_container_id VARCHAR(64)",
        "ALTER TABLE instances ADD COLUMN IF NOT EXISTS docker_name VARCHAR(255)",
        "CREATE INDEX IF NOT EXISTS ix_instances_base_url ON instances (base_url)",
    ]
    for stmt in statements:
        await conn.execute(text(stmt))

    # Unique constraint on docker_container_id if missing
    exists = await conn.execute(
        text(
            """
            SELECT 1
            FROM pg_constraint
            WHERE conname = 'uq_instances_docker_container_id'
            """
        )
    )
    if exists.scalar_one_or_none() is None:
        await conn.execute(
            text(
                """
                ALTER TABLE instances
                ADD CONSTRAINT uq_instances_docker_container_id UNIQUE (docker_container_id)
                """
            )
        )
