"""Application factory: wiring, lifecycle, middleware, and static hosting."""

import logging
from contextlib import asynccontextmanager
from pathlib import Path

import httpx
from fastapi import FastAPI
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from app import __version__
from app.config import get_settings
from app.providers import build_chain
from app.routes.api import router
from app.security import RateLimitMiddleware, SecurityHeadersMiddleware
from app.services.assistant import FanAssistant
from app.services.briefing import BriefingService
from app.services.crowd import CrowdService
from app.services.navigation import get_stadium_map

_STATIC_DIR = Path(__file__).resolve().parent.parent / "static"


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    logging.basicConfig(level=settings.log_level)

    # One shared HTTP client: connection pooling across all LLM calls.
    async with httpx.AsyncClient() as client:
        stadium = get_stadium_map()
        chain = build_chain(settings, client)
        app.state.stadium = stadium
        app.state.chain = chain
        app.state.crowd = CrowdService(stadium)
        app.state.assistant = FanAssistant(chain, stadium)
        app.state.briefing = BriefingService(chain)
        logging.getLogger(__name__).info(
            "StadiumIQ %s up — providers: %s", __version__, ", ".join(chain.active_names)
        )
        yield


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(
        title="StadiumIQ",
        version=__version__,
        description="GenAI operations copilot for FIFA World Cup 2026 venues",
        lifespan=lifespan,
    )
    app.add_middleware(SecurityHeadersMiddleware)
    app.add_middleware(RateLimitMiddleware, requests_per_minute=settings.rate_limit_per_minute)
    app.include_router(router)

    app.mount("/static", StaticFiles(directory=_STATIC_DIR), name="static")

    @app.get("/", include_in_schema=False)
    async def index() -> FileResponse:
        return FileResponse(_STATIC_DIR / "index.html")

    return app


app = create_app()
