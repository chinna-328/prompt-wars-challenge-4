"""Request/response contracts. Every inbound field is validated and bounded
here so nothing unconstrained ever reaches a service or an LLM prompt."""

from typing import Literal

from pydantic import BaseModel, Field

LanguageCode = Literal["en", "es", "fr", "pt", "de", "ar", "hi", "ja", "zh", "it"]


class ChatRequest(BaseModel):
    message: str = Field(min_length=1, max_length=1000)
    language: LanguageCode = "en"


class ChatResponse(BaseModel):
    reply: str
    provider: str
    model: str
    language: LanguageCode


class RouteRequest(BaseModel):
    origin: str = Field(min_length=1, max_length=64, pattern=r"^[a-z0-9_]+$")
    destination: str = Field(min_length=1, max_length=64, pattern=r"^[a-z0-9_]+$")
    accessible: bool = False
    narrate: bool = True
    language: LanguageCode = "en"


class RouteStepOut(BaseModel):
    node_id: str
    name: str
    kind: str
    meters_from_previous: int


class RouteResponse(BaseModel):
    steps: list[RouteStepOut]
    total_meters: int
    est_minutes: int
    accessible: bool
    directions: str | None = None
    provider: str | None = None


class BriefingRequest(BaseModel):
    language: LanguageCode = "en"
    match_minute: int | None = Field(default=None, ge=-90, le=135)


class BriefingResponse(BaseModel):
    briefing: str
    provider: str
    model: str
    match_minute: int
    phase: str


class HealthResponse(BaseModel):
    status: Literal["ok"]
    version: str
    active_providers: list[str]
