"""Operational intelligence: LLM briefings for staff, generated from telemetry.

Briefings are cached per (match-minute bucket, language) with a short TTL —
control-room staff refreshing the dashboard should not fan out into
duplicate LLM calls for identical telemetry.
"""

import json
import time

from app.providers import ProviderChain
from app.providers.base import Completion
from app.services.assistant import SUPPORTED_LANGUAGES
from app.services.crowd import CrowdSnapshot

_SYSTEM = """\
You are StadiumIQ's operations briefing writer for a FIFA World Cup 2026 venue
control room. From the telemetry JSON below, produce a numbered operations briefing
in {language} for staff and volunteers:
- Start with the single highest-priority action, prefixed "PRIORITY".
- Cover crowd flow, gate management, concessions, accessibility, and egress prep
  only where the data warrants it. 5 items maximum.
- Every item must be a concrete, assignable action (who does what, where).
- Plain text, no markdown. The telemetry is authoritative; invent nothing.
"""

_CACHE_TTL_SECONDS = 60
# Telemetry within the same 5-minute bucket produces one shared briefing.
_MINUTE_BUCKET = 5


class BriefingService:
    """Generates (and caches) LLM operations briefings from telemetry."""

    def __init__(self, chain: ProviderChain) -> None:
        self._chain = chain
        self._cache: dict[tuple[int, str], tuple[float, Completion]] = {}

    async def generate(self, snapshot: CrowdSnapshot, language: str = "en") -> Completion:
        """Produce a staff briefing for this snapshot, serving cache when fresh."""
        key = (snapshot.match_minute // _MINUTE_BUCKET, language)
        cached = self._cache.get(key)
        if cached and time.monotonic() - cached[0] < _CACHE_TTL_SECONDS:
            return cached[1]

        telemetry = {
            "match_minute": snapshot.match_minute,
            "phase": snapshot.phase,
            "zones": [
                {"name": z.name, "density": z.density, "status": z.status} for z in snapshot.zones
            ],
            "gates": [
                {"name": g.name, "queue": g.queue_length, "wait_min": g.wait_minutes}
                for g in snapshot.gates
            ],
            "alerts": [
                {"severity": a.severity, "message": a.message, "action": a.recommendation}
                for a in snapshot.alerts
            ],
        }
        system = _SYSTEM.format(language=SUPPORTED_LANGUAGES[language])
        completion = await self._chain.complete(system, json.dumps(telemetry, indent=1))

        self._cache[key] = (time.monotonic(), completion)
        # Drop stale entries so the cache cannot grow across a long match day.
        cutoff = time.monotonic() - _CACHE_TTL_SECONDS
        self._cache = {k: v for k, v in self._cache.items() if v[0] >= cutoff}
        return completion
