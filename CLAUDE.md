# CLAUDE.md — project control file

StadiumIQ is a hackathon submission judged on six criteria. **Every change to
this repo must hold or raise all six scores — never improve one by degrading
another.** Each criterion has a dedicated doc that states what we claim and
where the code backs it; keep code and docs in lockstep.

## Judging criteria → controlling doc

| Criterion | Impact | Doc | Non-negotiables when editing |
|---|---|---|---|
| Problem statement fit | **High** | [docs/PROBLEM_STATEMENT.md](docs/PROBLEM_STATEMENT.md) | Every feature maps to a challenge dimension (navigation, crowd, accessibility, multilingual, ops intelligence); GenAI stays central, grounded in live venue state |
| Code quality | **High** | [docs/CODE_QUALITY.md](docs/CODE_QUALITY.md) | Layering `routes → services → providers` (deps point one way); typed frozen dataclasses in the domain; DI over globals; comments explain *why* |
| Security | Medium | [docs/SECURITY.md](docs/SECURITY.md) | Pydantic bounds on all input; **no `innerHTML` ever** (textContent only); keys as `SecretStr`, never in URLs or logs; CSP + security headers stay on every response; fan text stays fenced in prompts |
| Efficiency | Medium | [docs/EFFICIENCY.md](docs/EFFICIENCY.md) | Async I/O with the shared httpx client; LLM calls cached (briefings) and rate-limited; dashboard polls only unmetered endpoints; no framework/bundle added to the frontend |
| Testing | Low | [docs/TESTING.md](docs/TESTING.md) | Suite stays offline (mock provider path); new features land with tests; the gate→seat step-free reachability test must keep passing |
| Accessibility | Low | [docs/ACCESSIBILITY.md](docs/ACCESSIBILITY.md) | Status never color-alone (dot + icon + text); aria-live on dynamic regions; table alternative for charts; `prefers-reduced-motion` respected; step-free routing guarantee intact |

## Commands

```bash
uvicorn app.main:app --reload    # run (http://localhost:8000)
pytest                           # 41 offline tests, ~0.3s, no keys needed
docker compose up --build        # containerized run
```

## Architecture in one breath

FastAPI app (`app/main.py` factory) → thin routes (`app/routes/api.py`) →
services (navigation graph, deterministic crowd simulator, GenAI orchestration)
→ provider chain (`NVIDIA NIM → Gemini → offline mock`, `app/providers/`).
Venue map is data (`app/data/stadium.json`). UI is three static files
(`static/`), no build step, CSP-strict (no inline script/style — dynamic styling
goes through CSSOM property assignment in JS).

## Working rules

- Conventional commits (`feat:`, `test:`, `chore:`, `docs:`); one commit per
  coherent feature; imperative subject + body explaining what and why.
- The zero-key path is sacred: everything must work with no env vars set
  (mock provider, simulated telemetry). Never make a key mandatory.
- `.env`, `.venv/`, `.claude/` never enter commits.
- Before submitting: run `pytest`, load the dashboard, exercise chat/briefing/
  navigator once, and re-read the six docs against reality.
