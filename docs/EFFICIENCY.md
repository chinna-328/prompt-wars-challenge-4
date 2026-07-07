# Efficiency

## Compute & memory

- **Fully async I/O path.** FastAPI + one shared `httpx.AsyncClient` (created in
  the app lifespan) gives connection pooling and non-blocking LLM calls — one
  worker serves many concurrent fans while requests wait on upstream models.
- **O(E log V) routing.** Dijkstra with a binary heap over a graph loaded and
  indexed **once** per process (`@lru_cache` on `get_stadium_map`); adjacency
  lists precomputed at load. Route queries allocate only the path they return.
- **Crowd snapshots are pure functions** of the match minute — no background
  tasks, no polling loops, no stored time series. Cost per request: a few dozen
  sine evaluations. Memory: effectively zero.
- **Frozen `slots=True` dataclasses** for all domain values — smaller and faster
  than dict-shaped objects, and immutable by construction.

## LLM spend (the real resource)

- **Caching where telemetry repeats:** briefings are cached per (5-minute match
  bucket × language) with a 60s TTL, with stale entries evicted on write, so ten
  staff dashboards refreshing produce one upstream call, not ten
  (`app/services/briefing.py`).
- **Rate limiting** caps worst-case spend per client (`app/security.py`).
- **`narrate=false`** lets programmatic callers get routes without paying for
  narration; `max_tokens` is capped in config.
- **Fallback is cheaper than retry storms:** a failing provider is skipped after
  one attempt per request, with hard timeouts, rather than hammered.

## Network & frontend

- Zero-build static UI: three files, no framework, no bundle — first paint is
  one HTML + one CSS + one JS fetch on a venue's congested Wi-Fi.
- Dashboard polls only the **unmetered, computation-cheap** telemetry endpoint
  (every 10s); LLM endpoints fire only on explicit user action.
- DOM updates use `replaceChildren` on scoped containers — no full re-renders.

## Image & startup

- Multi-stage Docker build: compilers and pip caches stay in the builder layer;
  the runtime layer is python-slim + wheels + ~50 KB of application code.
- Cold start is sub-second: no migrations, no model weights, map parse of a
  30-node JSON.

## Measured

Test suite: 54 tests in ~0.4s — the entire request path (routing + telemetry +
prompt building + mock completion) runs in well under a millisecond per call,
leaving upstream LLM latency as the only meaningful cost, which is why the
caching and rate limiting above target exactly that.
