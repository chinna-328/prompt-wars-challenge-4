# ⚽ StadiumIQ — GenAI Operations Copilot for FIFA World Cup 2026

StadiumIQ is a real-time, GenAI-enabled operations platform for World Cup 2026 venues.
It gives **fans** a multilingual assistant and step-by-step accessible navigation, and gives
**organizers, volunteers, and venue staff** live crowd intelligence with AI-generated
operational briefings and decision support.

![Python](https://img.shields.io/badge/python-3.11+-blue) ![FastAPI](https://img.shields.io/badge/FastAPI-0.115-009688) ![Docker](https://img.shields.io/badge/docker-ready-2496ED) ![Tests](https://img.shields.io/badge/tests-pytest-green)

## What it does

| Capability | Who it serves | How GenAI is used |
|---|---|---|
| **Multilingual fan assistant** | Fans (any of 10+ languages) | LLM answers venue questions grounded in live stadium state |
| **Accessible navigation** | Fans, wheelchair users, families | Graph routing + LLM turns routes into friendly natural-language directions |
| **Crowd intelligence** | Organizers, security | Live zone density, gate throughput, congestion detection |
| **AI ops briefings** | Venue staff, volunteers | LLM converts raw telemetry into prioritized, actionable briefings |

## Quick start

### Docker (recommended)

```bash
docker compose up --build
# open http://localhost:8000
```

### Local

```bash
python -m venv .venv && source .venv/bin/activate
pip install -r requirements-dev.txt
uvicorn app.main:app --reload
# open http://localhost:8000
```

**No API keys required** — StadiumIQ degrades gracefully through a provider chain:

```
NVIDIA NIM  →  Google Gemini  →  Offline deterministic mock
(primary)      (backup)          (zero-config demo mode)
```

Add keys via `.env` (see `.env.example`) to enable live GenAI responses.

## Run the tests

```bash
pytest
```

## Architecture

```
static/          Zero-build dashboard UI (semantic HTML, WCAG-conscious)
app/
  main.py        App factory, middleware, static hosting
  config.py      Typed settings (pydantic-settings, env-driven)
  providers/     LLM provider chain: nvidia → gemini → mock
  services/      Domain logic: navigation graph, crowd simulator, briefings
  routes/        Thin REST layer (validation via pydantic schemas)
  data/          Stadium map dataset (zones, gates, POIs, walkway graph)
tests/           Offline pytest suite (no network, no keys needed)
docs/            Per-criterion engineering docs (see CLAUDE.md)
```

## Documentation map

- [docs/PROBLEM_STATEMENT.md](docs/PROBLEM_STATEMENT.md) — the challenge, users, and how StadiumIQ targets it
- [docs/CODE_QUALITY.md](docs/CODE_QUALITY.md) — structure, conventions, design decisions
- [docs/SECURITY.md](docs/SECURITY.md) — threat model and mitigations
- [docs/EFFICIENCY.md](docs/EFFICIENCY.md) — resource usage and performance choices
- [docs/TESTING.md](docs/TESTING.md) — test strategy and how to extend it
- [docs/ACCESSIBILITY.md](docs/ACCESSIBILITY.md) — WCAG practices + accessibility features
