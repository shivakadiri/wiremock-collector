import logging

from apscheduler.schedulers.asyncio import AsyncIOScheduler

from app.config import settings
from app.services.collector import collect_all_enabled

logger = logging.getLogger(__name__)

scheduler = AsyncIOScheduler()


async def _scheduled_collect() -> None:
    try:
        results = await collect_all_enabled()
        for r in results:
            if r.error:
                logger.warning("Collect failed for %s: %s", r.instance_name, r.error)
            else:
                logger.info(
                    "Collected %s: fetched=%s inserted=%s",
                    r.instance_name,
                    r.fetched,
                    r.inserted,
                )
    except Exception:
        logger.exception("Scheduled collect failed")


def start_scheduler() -> None:
    if scheduler.running:
        return
    scheduler.add_job(
        _scheduled_collect,
        "interval",
        seconds=settings.collect_interval_seconds,
        id="collect_requests",
        replace_existing=True,
        max_instances=1,
    )
    scheduler.start()
    logger.info("Scheduler started (every %ss)", settings.collect_interval_seconds)


def stop_scheduler() -> None:
    if scheduler.running:
        scheduler.shutdown(wait=False)
