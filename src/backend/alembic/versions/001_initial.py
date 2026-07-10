"""initial schema

Revision ID: 001_initial
Revises:
Create Date: 2026-07-10

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "001_initial"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "instances",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("base_url", sa.String(length=512), nullable=False),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("last_collected_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_error", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.UniqueConstraint("name"),
    )
    op.create_table(
        "requests",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("instance_id", sa.Integer(), sa.ForeignKey("instances.id", ondelete="CASCADE"), nullable=False),
        sa.Column("wiremock_request_id", sa.String(length=64), nullable=False),
        sa.Column("method", sa.String(length=16), nullable=False),
        sa.Column("url", sa.Text(), nullable=False),
        sa.Column("absolute_url", sa.Text(), nullable=True),
        sa.Column("status", sa.Integer(), nullable=True),
        sa.Column("was_matched", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("stub_mapping_id", sa.String(length=64), nullable=True),
        sa.Column("logged_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("timing_total", sa.BigInteger(), nullable=True),
        sa.Column("payload", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("collected_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.UniqueConstraint("instance_id", "wiremock_request_id", name="uq_instance_wiremock_request"),
    )
    op.create_index("ix_requests_instance_id", "requests", ["instance_id"])
    op.create_index("ix_requests_method", "requests", ["method"])
    op.create_index("ix_requests_status", "requests", ["status"])
    op.create_index("ix_requests_was_matched", "requests", ["was_matched"])
    op.create_index("ix_requests_logged_at", "requests", ["logged_at"])


def downgrade() -> None:
    op.drop_table("requests")
    op.drop_table("instances")
