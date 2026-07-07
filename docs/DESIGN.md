# Design — HLD & LLD

This document is the formal design record for StadiumIQ: the high-level
architecture (system context, components, deployment) and the low-level design
(module contracts, key sequences, data model, error taxonomy). Every element
here maps to code — file references are given throughout.

---

## High-Level Design

### System context

```mermaid
flowchart LR
    Fan(["Fan / Volunteer<br/>(any of 10 languages)"]) -->|browser| UI
    Staff(["Venue staff<br/>(control room)"]) -->|browser| UI
    subgraph StadiumIQ
        UI["Static dashboard<br/>(static/, zero-build)"] -->|JSON /api| API["FastAPI service<br/>(app/)"]
        API --> MAP[("Venue map<br/>app/data/stadium.json")]
    end
    API -->|primary| NIM["NVIDIA NIM<br/>(chat/completions)"]
    API -->|backup| GEM["Google Gemini<br/>(generateContent)"]
    API -->|always available| MOCK["Offline deterministic mock<br/>(in-process)"]
```

The system is a single service with no external state: the venue map is data,
crowd telemetry is simulated deterministically in-process (the contract a real
turnstile/CV feed would fill), and LLM access degrades through a provider
chain that terminates in an offline mock — so the platform runs with **zero
keys and zero network**.

### Component view (layers, one-way dependencies)

```mermaid
flowchart TD
    subgraph HTTP boundary
        MW["Middleware<br/>security headers + rate limit<br/>app/security.py"]
        R["Routes (thin)<br/>app/routes/api.py"]
        S["Schemas (pydantic)<br/>app/schemas.py"]
    end
    subgraph Domain services
        NAV["StadiumMap · Dijkstra routing<br/>app/services/navigation.py"]
        CRO["CrowdService · deterministic telemetry<br/>app/services/crowd.py"]
        AST["FanAssistant · grounded prompts<br/>app/services/assistant.py"]
        BRF["BriefingService · cached ops briefings<br/>app/services/briefing.py"]
    end
    subgraph Providers
        CHAIN["ProviderChain<br/>app/providers/__init__.py"]
        NV["NvidiaProvider"] --- GM["GeminiProvider"] --- MK["MockProvider"]
    end
    CFG["Settings (pydantic-settings)<br/>app/config.py"]

    MW --> R --> S
    R --> NAV & CRO & AST & BRF
    AST --> CHAIN
    BRF --> CHAIN
    AST --> NAV
    CHAIN --> NV & GM & MK
    NV & GM --> CFG
```

Rules the diagram encodes (enforced by review + tests):

- Dependencies point one way: `routes → services → providers`. No service
  imports HTTP types; no provider knows about services.
- All wiring happens once, in the app-factory lifespan (`app/main.py`) —
  dependency injection over globals, which is what makes the suite testable.
- Configuration is typed and centralized (`app/config.py`); secrets are
  `SecretStr` and optional by design.

### Deployment view

| Target | Mechanism | Notes |
|---|---|---|
| Local dev | `uvicorn app.main:app --reload` | zero keys → mock provider |
| Container | multi-stage `Dockerfile`, non-root, read-only fs | health-checked; compose file hardens further |
| Production | Vercel Git integration (`vercel.json`) | CI/CD gates + post-deploy health probe (`.github/workflows/ci.yml`) |

---

## Low-Level Design

### Module contracts

| Module | Public contract | Key invariants |
|---|---|---|
| `providers/base.py` | `LLMProvider.available() -> bool`, `complete(system, user) -> Completion`; frozen `Completion(text, provider, model)` | all failures normalize to `ProviderError` |
| `providers/__init__.py` | `ProviderChain.complete()`, `active_names`; `build_chain(settings, client)` | skips unavailable providers; falls through on `ProviderError`; mock terminates the chain |
| `services/navigation.py` | `StadiumMap.find_route(origin, destination, accessible) -> Route` | `accessible=True` removes every non-step-free edge **before** search — returned routes are verified step-free, not best-effort |
| `services/crowd.py` | `CrowdService.snapshot(match_minute) -> CrowdSnapshot` | pure function of the match clock: same minute ⇒ same telemetry (reproducible fixtures) |
| `services/assistant.py` | `chat(message, language, snapshot)`, `narrate_route(route, language)` | fan text is fenced in `<fan_message>` tags; prompts are grounded in server-generated state only |
| `services/briefing.py` | `generate(snapshot, language)` | cache key `(minute // 5, language)`, 60s TTL — refresh storms cannot fan out into LLM spend |
| `security.py` | `SecurityHeadersMiddleware`, `RateLimitMiddleware` | sliding 60s window per client IP, LLM-backed prefixes only; amortized idle-client pruning |

### Class relationships (providers)

```mermaid
classDiagram
    class LLMProvider {
        <<abstract>>
        +name: str
        +available() bool
        +complete(system, user) Completion
    }
    class ProviderChain {
        +providers: list~LLMProvider~
        +active_names: list~str~
        +complete(system, user) Completion
    }
    class Completion {
        <<frozen>>
        +text: str
        +provider: str
        +model: str
    }
    LLMProvider <|-- NvidiaProvider
    LLMProvider <|-- GeminiProvider
    LLMProvider <|-- MockProvider
    ProviderChain o-- LLMProvider
    LLMProvider ..> Completion
    LLMProvider ..> ProviderError : raises
```

Adding a provider = one new file implementing two methods + one line in
`build_chain()`. Nothing else changes (open/closed).

### Sequence: fan chat with provider fallback

```mermaid
sequenceDiagram
    participant B as Browser (static/app.js)
    participant M as RateLimit + Headers
    participant R as POST /api/assistant/chat
    participant C as CrowdService
    participant A as FanAssistant
    participant P as ProviderChain

    B->>M: JSON {message, language}
    M->>M: sliding-window check (429 if exceeded)
    M->>R: pass
    R->>R: pydantic validation (length, language enum)
    R->>C: snapshot()
    C-->>R: CrowdSnapshot (deterministic)
    R->>A: chat(message, language, snapshot)
    A->>A: ground prompt in venue state,<br/>fence fan text in <fan_message>
    A->>P: complete(system, user)
    P->>P: NVIDIA → ProviderError?<br/>→ Gemini → ProviderError?<br/>→ Mock (always answers)
    P-->>A: Completion(text, provider, model)
    A-->>R: Completion
    R-->>B: {reply, provider, model}
    B->>B: render via textContent only (no innerHTML)
```

### Sequence: step-free navigation

```mermaid
sequenceDiagram
    participant B as Browser
    participant R as POST /api/navigate
    participant S as StadiumMap
    participant A as FanAssistant

    B->>R: {origin, destination, accessible: true, narrate}
    R->>S: find_route(origin, destination, accessible=True)
    S->>S: drop stairs edges, Dijkstra over remainder
    alt unknown node
        S-->>R: UnknownLocationError → 404
    else no step-free path
        S-->>R: NoRouteError → 422
    else route found
        S-->>R: Route (verified step-free)
        opt narrate = true
            R->>A: narrate_route(route, language)
            A-->>R: natural-language directions
        end
        R-->>B: steps + totals + directions
    end
```

### Data model

- **Venue map (`app/data/stadium.json`)** — zones, nodes (gates, seating,
  concessions, restrooms, first aid, elevators, stairs, sensory room, transit),
  and edges `{a, b, meters, step_free}`. The graph is data: a new venue is a
  new JSON file, zero code changes.
- **Domain values** — frozen, slotted dataclasses (`Route`, `RouteStep`,
  `CrowdSnapshot`, `Completion`): immutable, typo-proof, cheap.
- **API boundary** — pydantic models (`app/schemas.py`) bound every input:
  message ≤ 1000 chars, node ids `^[a-z0-9_]+$`, language a closed enum,
  minute range-checked.

### Error taxonomy

| Error | Raised by | Handled as |
|---|---|---|
| `ProviderError` | any provider | chain falls through to the next provider |
| `UnknownLocationError` | navigation | HTTP 404 |
| `NoRouteError` | navigation | HTTP 422 |
| pydantic `ValidationError` | schema boundary | HTTP 422 (FastAPI) |
| rate-limit exceeded | middleware | HTTP 429 + `Retry-After` |

Errors are types, not strings — the type itself carries the handling policy.

### Cross-cutting decisions

- **Async I/O throughout**; one shared `httpx.AsyncClient` (lifespan-managed)
  pools connections across all LLM calls.
- **Caching**: briefings keyed by 5-minute telemetry buckets + language;
  `lru_cache` for settings and the parsed venue map.
- **Observability without leakage**: provider failures are logged by exception
  class only — payloads (which echo user input) and keys never reach logs.
