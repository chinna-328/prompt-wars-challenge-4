"""REST API. Routes stay thin: validate (schemas), delegate (services), shape output."""

from dataclasses import asdict

from fastapi import APIRouter, HTTPException, Query, Request

from app import __version__
from app.schemas import (
    BriefingRequest,
    BriefingResponse,
    ChatRequest,
    ChatResponse,
    HealthResponse,
    RouteRequest,
    RouteResponse,
    RouteStepOut,
)
from app.services.navigation import NoRouteError, UnknownLocationError

router = APIRouter(prefix="/api")


@router.get("/health", response_model=HealthResponse)
async def health(request: Request) -> HealthResponse:
    """Liveness probe, reporting which GenAI providers are configured."""
    return HealthResponse(
        status="ok",
        version=__version__,
        active_providers=request.app.state.chain.active_names,
    )


@router.get("/stadium/map")
async def stadium_map(request: Request) -> dict:
    """Full venue map — zones and routable nodes — for populating the UI."""
    stadium = request.app.state.stadium
    return {
        "venue": stadium.venue,
        "zones": list(stadium.zones.values()),
        "nodes": list(stadium.nodes.values()),
    }


@router.get("/crowd/status")
async def crowd_status(
    request: Request,
    match_minute: int | None = Query(default=None, ge=-90, le=135),
) -> dict:
    """Crowd telemetry snapshot; `match_minute` rewinds the deterministic clock."""
    snapshot = request.app.state.crowd.snapshot(match_minute)
    return asdict(snapshot)


@router.post("/assistant/chat", response_model=ChatResponse)
async def assistant_chat(request: Request, body: ChatRequest) -> ChatResponse:
    """Multilingual fan chat, grounded in the live crowd snapshot."""
    snapshot = request.app.state.crowd.snapshot()
    completion = await request.app.state.assistant.chat(body.message, body.language, snapshot)
    return ChatResponse(
        reply=completion.text,
        provider=completion.provider,
        model=completion.model,
        language=body.language,
    )


@router.post("/navigate", response_model=RouteResponse)
async def navigate(request: Request, body: RouteRequest) -> RouteResponse:
    """Point-to-point route with optional step-free constraint and narration."""
    try:
        route = request.app.state.stadium.find_route(
            body.origin, body.destination, accessible=body.accessible
        )
    except UnknownLocationError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except NoRouteError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    directions = provider = None
    if body.narrate:
        completion = await request.app.state.assistant.narrate_route(route, body.language)
        directions, provider = completion.text, completion.provider

    return RouteResponse(
        steps=[RouteStepOut(**asdict(step)) for step in route.steps],
        total_meters=route.total_meters,
        est_minutes=route.est_minutes,
        accessible=route.accessible,
        directions=directions,
        provider=provider,
    )


@router.post("/ops/briefing", response_model=BriefingResponse)
async def ops_briefing(request: Request, body: BriefingRequest) -> BriefingResponse:
    """Actionable staff briefing generated from the current telemetry."""
    snapshot = request.app.state.crowd.snapshot(body.match_minute)
    completion = await request.app.state.briefing.generate(snapshot, body.language)
    return BriefingResponse(
        briefing=completion.text,
        provider=completion.provider,
        model=completion.model,
        match_minute=snapshot.match_minute,
        phase=snapshot.phase,
    )
