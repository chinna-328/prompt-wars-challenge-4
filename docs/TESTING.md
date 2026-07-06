# Testing & Maintainability

## Run it

```bash
pip install -r requirements-dev.txt
pytest          # 41 tests, ~0.3s, zero network, zero keys
```

## Strategy

The suite is **offline by construction**: the conftest blanks provider keys, so
the chain terminates at the deterministic mock — the exact configuration a
keyless judge deployment runs. No mocking frameworks, no network flakiness, no
secrets in CI.

| Layer | File | What is proven |
|---|---|---|
| Provider chain | `tests/test_providers.py` | Ordering, unavailable-skip, fallback on failure, empty-chain guard, mock task recognition |
| Navigation | `tests/test_navigation.py` | Shortest paths, **step-free reachability of every seat from every gate** (the accessibility guarantee, enforced as a test), error types |
| Crowd engine | `tests/test_crowd.py` | Phase mapping, determinism, density bounds, halftime > play load, alerts reference real zones and carry actions |
| API | `tests/test_api.py` | Contracts, validation rejects (size/pattern/enum), 404-vs-422 mapping, security headers on every response, rate limit trips at N+1 and spares unmetered routes |

## Why the design is testable

- **Dependency injection** — every service takes its collaborators as
  constructor args, so tests compose real objects (`ProviderChain([_Failing(),
  MockProvider()])`) instead of patching internals.
- **Determinism as a feature** — crowd telemetry is a pure function of the match
  minute; any moment of the match day is a reproducible fixture
  (`snapshot(52)` is always halftime congestion).
- **The mock provider doubles as the test provider**, so tests exercise
  production code paths, not test-only stubs.

## Extending

- New venue: drop a new `stadium.json`; the gate→seat reachability test
  automatically verifies its accessible-route guarantee.
- New provider: implement `LLMProvider` (2 methods), add to `build_chain`,
  and the existing chain tests cover its fallback behavior.
- Verified UI flows: `selenium` script drives chat, briefing, and routing in
  headless Firefox (used during development for visual regression).
