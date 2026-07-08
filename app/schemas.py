"""Request/response contracts. Every inbound field is validated and bounded
here so nothing unconstrained ever reaches a service or an LLM prompt."""

from typing import Literal

from pydantic import BaseModel, Field

LanguageCode = Literal["en", "es", "fr", "pt", "de", "ar", "hi", "ja", "zh", "it"]


class ChatRequest(BaseModel):
    """Fan chat input: bounded message length, closed language enum."""

    message: str = Field(min_length=1, max_length=1000)
    language: LanguageCode = "en"


class ChatResponse(BaseModel):
    """Assistant reply with attribution of which provider/model answered."""

    reply: str
    provider: str
    model: str
    language: LanguageCode


class RouteRequest(BaseModel):
    """Routing input: node ids are pattern-locked to slug form."""

    origin: str = Field(min_length=1, max_length=64, pattern=r"^[a-z0-9_]+$")
    destination: str = Field(min_length=1, max_length=64, pattern=r"^[a-z0-9_]+$")
    accessible: bool = False
    narrate: bool = True
    language: LanguageCode = "en"


class RouteStepOut(BaseModel):
    """One waypoint of a returned route (mirrors the domain RouteStep)."""

    node_id: str
    name: str
    kind: str
    meters_from_previous: int


class RouteResponse(BaseModel):
    """Computed route; `directions` present only when narration was requested."""

    steps: list[RouteStepOut]
    total_meters: int
    est_minutes: int
    accessible: bool
    directions: str | None = None
    provider: str | None = None


class BriefingRequest(BaseModel):
    """Briefing input: match minute is range-checked to the match timeline."""

    language: LanguageCode = "en"
    match_minute: int | None = Field(default=None, ge=-90, le=135)


class BriefingResponse(BaseModel):
    """Generated staff briefing plus the telemetry context it was built from."""

    briefing: str
    provider: str
    model: str
    match_minute: int
    phase: str


class HealthResponse(BaseModel):
    """Liveness payload: version and the currently configured provider names."""

    status: Literal["ok"]
    version: str
    active_providers: list[str]
