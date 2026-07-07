# Code Quality

## Architecture: layered, one direction of dependency

```
routes  →  services  →  providers
   ↘          ↘            ↘
    schemas    domain data   config
```

- **`app/routes/`** — thin HTTP layer. Validates with pydantic schemas, delegates,
  maps domain errors to status codes (`UnknownLocationError → 404`,
  `NoRouteError → 422`). No business logic.
- **`app/services/`** — the domain. Navigation (pure graph algorithm), crowd
  telemetry (pure function of the match clock), GenAI orchestration (prompt
  construction + grounding). No HTTP types anywhere in this layer.
- **`app/providers/`** — one abstraction (`LLMProvider`) with three
  implementations behind a `ProviderChain` facade. Adding a fourth provider is a
  new file + one line in `build_chain()`; nothing else changes.
- **Data as data** — the venue map is `app/data/stadium.json`, not code. Swapping
  stadiums touches zero Python.

## Conventions applied throughout

- **Typed everywhere.** Frozen, slotted dataclasses for domain values
  (`Route`, `CrowdSnapshot`, `Completion`); pydantic models at the boundary.
- **Dependency injection.** Services receive their collaborators
  (`FanAssistant(chain, stadium)`) — nothing reaches into globals, which is what
  makes the test suite trivial to write.
- **Errors are types**, not strings: `ProviderError` drives fallback;
  navigation errors carry meaning to the route layer.
- **Comments explain *why*, not *what*** — e.g. why the API key travels in a
  header, why the mock provider terminates the chain, why blank env keys are
  normalized to unset.
- **Naming is domain language**: `phase_for`, `find_route`, `narrate_route`,
  `active_names` — readable as prose.

## Frontend discipline

- Zero-build vanilla JS: no framework, no bundler, nothing to bit-rot.
- All dynamic content inserted via `textContent`/`createElement` — a deliberate
  rule (see SECURITY.md) that also keeps rendering code uniform.
- CSS custom properties define the design system once (`:root` tokens);
  components consume roles, not raw hex.

## Enforced by CI, not by convention

Quality claims above are machine-checked on every push
(`.github/workflows/ci.yml`):

- **`ruff check`** with correctness, import-order, naming, modernization,
  bug-pattern, and simplification rule sets (`pyproject.toml [tool.ruff.lint]`)
- **`ruff format --check`** — one canonical style, no drift
- **`mypy app`** — the whole application package type-checks clean
- **`pytest`** on Python 3.12 and 3.14 — 41 offline tests
- **`pip-audit`** — no known-vulnerable dependencies
- **Docker build + container health smoke test**

## Design decisions worth defending

- **The mock provider is a feature, not a stub.** It guarantees the demo,
  the tests, and a keyless judge deployment all exercise the *same* code paths
  as production.
- **In-memory rate limiter / cache** — correct for one process per venue node;
  documented as the swap point for Redis in a multi-replica deployment.
- **Simulator behind a real interface.** `CrowdSnapshot` is the contract a
  turnstile/CV ingest would fill; the simulator is an implementation detail.
