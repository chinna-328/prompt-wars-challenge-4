"""Rate-limiter internals: sliding-window expiry and idle-client pruning."""

import time

from fastapi.responses import JSONResponse
from starlette.requests import Request

from app.security import RateLimitMiddleware


def _request(path: str = "/api/navigate", host: str = "1.2.3.4") -> Request:
    return Request(
        {
            "type": "http",
            "method": "POST",
            "path": path,
            "client": (host, 1234),
            "headers": [],
            "query_string": b"",
            "scheme": "http",
            "server": ("testserver", 80),
        }
    )


async def _ok(request: Request) -> JSONResponse:
    return JSONResponse({"ok": True})


def _middleware(limit: int = 1) -> RateLimitMiddleware:
    return RateLimitMiddleware(None, requests_per_minute=limit)


async def test_hits_older_than_the_window_are_expired():
    mw = _middleware(limit=1)
    assert (await mw.dispatch(_request(), _ok)).status_code == 200
    assert (await mw.dispatch(_request(), _ok)).status_code == 429

    # Age the recorded hit past the 60s window; the client is admitted again.
    mw._hits["1.2.3.4"][0] -= 61
    assert (await mw.dispatch(_request(), _ok)).status_code == 200


def test_prune_drops_idle_and_empty_clients_only():
    mw = _middleware()
    now = time.monotonic()
    mw._hits["idle"].append(now - 120)
    mw._hits["empty"]  # defaultdict access creates an empty window
    mw._hits["active"].append(now)

    mw._prune_idle_clients(now)
    assert set(mw._hits) == {"active"}


async def test_prune_runs_on_the_amortization_boundary():
    mw = _middleware(limit=100)
    mw._hits["stale"].append(time.monotonic() - 300)
    mw._requests_seen = mw._PRUNE_EVERY - 1  # next request crosses the boundary

    await mw.dispatch(_request(host="9.9.9.9"), _ok)
    assert "stale" not in mw._hits
    assert "9.9.9.9" in mw._hits


async def test_unmetered_paths_record_nothing():
    mw = _middleware()
    response = await mw.dispatch(_request(path="/api/crowd/status"), _ok)
    assert response.status_code == 200
    assert not mw._hits
