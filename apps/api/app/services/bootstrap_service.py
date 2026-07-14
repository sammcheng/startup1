import logging
from decimal import Decimal

from sqlalchemy import select

from app.config import settings
from app.dependencies import AsyncSessionLocal
from app.models import (
    InputType,
    OutputType,
    OwnershipType,
    Tool,
    ToolCategory,
    ToolStatus,
    User,
    UserRole,
)

logger = logging.getLogger(__name__)

CURATED_SELLER_EMAIL = "curated@hackmarket.local"
CURATED_SELLER_CLERK_ID = "system_curated_seller"
CURATED_SELLER_USERNAME = "hackmarket_curated"
CURATED_TOOL_SLUG = "home-accessibility-checker"


async def ensure_bootstrap_marketplace_data() -> None:
    if not settings.enable_bootstrap_tool_seed:
        return

    async with AsyncSessionLocal() as session:
        seller = await session.scalar(select(User).where(User.email == CURATED_SELLER_EMAIL))

        if seller is None:
            seller = User(
                clerk_id=CURATED_SELLER_CLERK_ID,
                email=CURATED_SELLER_EMAIL,
                username=CURATED_SELLER_USERNAME,
                display_name="Hackmarket Curated",
                role=UserRole.seller,
                is_active=True,
            )
            session.add(seller)
            await session.flush()
            logger.info("Created curated seller account for marketplace bootstrap.")

        tool = await session.scalar(select(Tool).where(Tool.slug == CURATED_TOOL_SLUG))
        if tool is None:
            tool = Tool(
                seller_id=seller.id,
                name="Home Accessibility Checker",
                slug=CURATED_TOOL_SLUG,
                tagline="Analyze Zillow links or home photos for accessibility barriers and renovation recommendations.",
                description=(
                    "Submit a Zillow-style listing URL or upload home images to detect accessibility "
                    "barriers, estimate an overall accessibility score, and receive practical "
                    "recommendations for safer navigation."
                ),
                category=ToolCategory.computer_vision,
                status=ToolStatus.live,
                ownership_type=OwnershipType.royalty,
                input_type=InputType.json,
                output_type=OutputType.json,
                input_schema={
                    "example_input": {
                        "url": "https://www.zillow.com/homedetails/example-listing",
                        "maxImages": 5,
                    },
                    "fields": [
                        {
                            "name": "url",
                            "type": "url",
                            "required": False,
                            "placeholder": "https://www.zillow.com/homedetails/...",
                        },
                        {
                            "name": "images",
                            "type": "file",
                            "required": False,
                            "placeholder": "Upload listing photos instead of a URL",
                        },
                        {
                            "name": "maxImages",
                            "type": "number",
                            "required": False,
                            "placeholder": "5",
                        },
                    ],
                },
                output_schema={
                    "example_output": {
                        "success": True,
                        "analysis": {
                            "overall_score": 78,
                            "summary": "Two accessibility barriers found near the entry path.",
                        },
                        "source": {
                            "type": "url",
                            "url": "https://www.zillow.com/homedetails/example-listing",
                            "scraped_images": 5,
                        },
                        "timestamp": "2026-05-01T00:00:00Z",
                    },
                    "type": "json",
                    "properties": {
                        "success": {"type": "boolean"},
                        "analysis": {"type": "object"},
                        "source": {"type": "object"},
                        "timestamp": {"type": "string"},
                    },
                },
                price_per_request=Decimal("0.050000"),
                api_endpoint=settings.bootstrap_tool_api_endpoint or None,
                entry_command="node server.js",
                port=3000,
                github_url="https://github.com/sammcheng/start",
                documentation=(
                    "Submit either a property listing `url` or an `images` array of processed image "
                    "payloads. Listing URLs are best-effort because some sites block automated "
                    "scraping in production, so direct photo uploads are the most reliable path. "
                    "The service returns accessibility findings, an overall score, and recommendations."
                ),
                is_featured=True,
            )
            session.add(tool)
            logger.info("Created curated marketplace tool seed: %s", CURATED_TOOL_SLUG)
        else:
            tool.status = ToolStatus.live
            tool.is_featured = True
            tool.api_endpoint = settings.bootstrap_tool_api_endpoint or tool.api_endpoint
            tool.input_type = InputType.json
            tool.output_type = OutputType.json
            tool.input_schema = {
                "example_input": {
                    "url": "https://www.zillow.com/homedetails/example-listing",
                    "maxImages": 5,
                },
                "fields": [
                    {
                        "name": "url",
                        "type": "url",
                        "required": False,
                        "placeholder": "https://www.zillow.com/homedetails/...",
                    },
                    {
                        "name": "images",
                        "type": "file",
                        "required": False,
                        "placeholder": "Upload listing photos instead of a URL",
                    },
                    {
                        "name": "maxImages",
                        "type": "number",
                        "required": False,
                        "placeholder": "5",
                    },
                ],
            }
            tool.output_schema = {
                "example_output": {
                    "success": True,
                    "analysis": {
                        "overall_score": 78,
                        "summary": "Two accessibility barriers found near the entry path.",
                    },
                    "source": {
                        "type": "url",
                        "url": "https://www.zillow.com/homedetails/example-listing",
                        "scraped_images": 5,
                    },
                    "timestamp": "2026-05-01T00:00:00Z",
                },
                "type": "json",
                "properties": {
                    "success": {"type": "boolean"},
                    "analysis": {"type": "object"},
                    "source": {"type": "object"},
                    "timestamp": {"type": "string"},
                },
            }
            tool.price_per_request = Decimal("0.050000")
            tool.entry_command = "node server.js"
            tool.port = 3000
            tool.tagline = "Analyze Zillow links or home photos for accessibility barriers and renovation recommendations."
            tool.description = (
                "Submit a Zillow-style listing URL or upload home images to detect accessibility "
                "barriers, estimate an overall accessibility score, and receive practical "
                "recommendations for safer navigation."
            )
            tool.documentation = (
                "Submit either a property listing `url` or an `images` array of processed image "
                "payloads. Listing URLs are best-effort because some sites block automated "
                "scraping in production, so direct photo uploads are the most reliable path. "
                "The service returns accessibility findings, an overall score, and recommendations."
            )

        await session.commit()
