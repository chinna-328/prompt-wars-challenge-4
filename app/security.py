"""HTTP hardening: per-client rate limiting and security response headers."""

import time
from collections import defaultdict, deque

from fastapi import Request
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware

_WINDOW_SECONDS = 60

# Conservative headers for an app that serves its own static UI and JSON API.
SECURITY_HEADERS = {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    # Browsers ignore HSTS over plain http (local dev); it takes effect on
    # the TLS-terminated production deployment.
    "Strict-Transport-Security": "max-age=63072000; includeSubDomains",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
    "Content-Security-Policy": (
        "default-src 'self'; img-src 'self' data:; style-src 'self'; "
        "script-src 'self'; connect-src 'self'; frame-ancestors 'none'"
    ),
}


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        response = await call_next(request)
        response.headers.update(SECURITY_HEADERS)
        return response


class RateLimitMiddleware(BaseHTTPMiddleware):
    """Sliding-window limiter over the GenAI-backed endpoints.

    LLM calls are the expensive resource here; map/health/crowd reads stay
    unmetered. In-memory state is intentional — one process per venue node,
    and the limiter guards cost, not authentication.
    """

    LIMITED_PREFIXES = ("/api/assistant", "/api/navigate", "/api/ops")

    _PRUNE_EVERY = 1000  # amortized cleanup of idle clients' empty windows

    def __init__(self, app, requests_per_minute: int) -> None:
        super().__init__(app)
        self._limit = requests_per_minute
        self._hits: dict[str, deque[float]] = defaultdict(deque)
        self._requests_seen = 0

    def _prune_idle_clients(self, now: float) -> None:
        stale = [
            client
            for client, hits in self._hits.items()
            if not hits or now - hits[-1] > _WINDOW_SECONDS
        ]
        for client in stale:
            del self._hits[client]

    async def dispatch(self, request: Request, call_next):
        if not request.url.path.startswith(self.LIMITED_PREFIXES):
            return await call_next(request)

        client = request.client.host if request.client else "unknown"
        now = time.monotonic()
        self._requests_seen += 1
        if self._requests_seen % self._PRUNE_EVERY == 0:
            self._prune_idle_clients(now)
        hits = self._hits[client]
        while hits and now - hits[0] > _WINDOW_SECONDS:
            hits.popleft()
        if len(hits) >= self._limit:
            return JSONResponse(
                status_code=429,
                content={"detail": "Rate limit exceeded — please retry shortly."},
                headers={"Retry-After": "30", **SECURITY_HEADERS},
            )
        hits.append(now)
        return await call_next(request)
