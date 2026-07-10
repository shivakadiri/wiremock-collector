"""add docker discovery fields

Revision ID: 002_docker_fields
Revises: 001_initial
Create Date: 2026-07-10

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "002_docker_fields"
down_revision: Union[str, None] = "001_initial"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("instances", sa.Column("source", sa.String(length=32), nullable=False, server_default="manual"))
    op.add_column("instances", sa.Column("docker_container_id", sa.String(length=64), nullable=True))
    op.add_column("instances", sa.Column("docker_name", sa.String(length=255), nullable=True))
    op.create_index("ix_instances_base_url", "instances", ["base_url"])
    op.create_unique_constraint("uq_instances_docker_container_id", "instances", ["docker_container_id"])


def downgrade() -> None:
    op.drop_constraint("uq_instances_docker_container_id", "instances", type_="unique")
    op.drop_index("ix_instances_base_url", table_name="instances")
    op.drop_column("instances", "docker_name")
    op.drop_column("instances", "docker_container_id")
    op.drop_column("instances", "source")
