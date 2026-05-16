import asyncio
import logging

from app.services import bootstrap_service

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


async def _main() -> None:
    await bootstrap_service.ensure_bootstrap_marketplace_data()


if __name__ == "__main__":
    logger.info("Running bootstrap marketplace seed task...")
    asyncio.run(_main())
