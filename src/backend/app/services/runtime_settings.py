"""Runtime collector preferences (in-memory, seeded from env)."""

from __future__ import annotations

from app.config import settings

_clear_journal_after_collect: bool | None = None


def get_clear_journal_after_collect() -> bool:
    if _clear_journal_after_collect is not None:
        return _clear_journal_after_collect
    return bool(settings.clear_journal_after_collect)


def set_clear_journal_after_collect(value: bool) -> bool:
    global _clear_journal_after_collect
    _clear_journal_after_collect = bool(value)
    return _clear_journal_after_collect
