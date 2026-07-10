from datetime import datetime

from sqlalchemy import BigInteger, Boolean, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class CollectedRequest(Base):
    __tablename__ = "requests"
    __table_args__ = (
        UniqueConstraint("instance_id", "wiremock_request_id", name="uq_instance_wiremock_request"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    instance_id: Mapped[int] = mapped_column(ForeignKey("instances.id", ondelete="CASCADE"), nullable=False, index=True)
    wiremock_request_id: Mapped[str] = mapped_column(String(64), nullable=False)
    method: Mapped[str] = mapped_column(String(16), nullable=False, index=True)
    url: Mapped[str] = mapped_column(Text, nullable=False)
    absolute_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[int | None] = mapped_column(Integer, nullable=True, index=True)
    was_matched: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False, index=True)
    stub_mapping_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    logged_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True, index=True)
    timing_total: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    payload: Mapped[dict] = mapped_column(JSONB, nullable=False)
    collected_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    instance = relationship("Instance", back_populates="requests")
