# Problem Statement Alignment

> **Challenge:** Build a GenAI-enabled solution that enhances stadium operations and the
> overall tournament experience for fans, organizers, volunteers, or venue staff during
> the FIFA World Cup 2026 — improving navigation, crowd management, accessibility,
> transportation, sustainability, multilingual assistance, operational intelligence,
> or real-time decision support.

## The root problem

World Cup 2026 is the largest World Cup ever: 48 teams, 104 matches, 16 stadiums,
an expected 6+ million attendees speaking dozens of languages. Two failure modes
dominate large-venue events:

1. **Fans get lost, stuck, and frustrated.** Unfamiliar venue, foreign language,
   80,000 people moving at once. Signage is static; queues are invisible until you
   are in one; accessible paths are poorly communicated.
2. **Operations teams drown in raw data.** Control rooms see camera feeds and
   turnstile counts, but converting telemetry into *"send four stewards to the
   north concourse now"* takes scarce expert attention — precisely when incidents
   (halftime crush, egress surge) allow the least time to think.

## How StadiumIQ targets it

| Challenge dimension | StadiumIQ feature | Where in code |
|---|---|---|
| **Navigation** | Graph-routed shortest paths between any two venue points, narrated turn-by-turn by GenAI in the fan's language | `app/services/navigation.py`, `/api/navigate` |
| **Accessibility** | Step-free routing constraint (wheelchairs, strollers, injuries); sensory room & accessible restrooms as first-class map nodes; WCAG-conscious UI | `find_route(accessible=True)`, `docs/ACCESSIBILITY.md` |
| **Multilingual assistance** | Fan assistant answers venue questions in 10 languages, grounded in live crowd state so answers are *operationally true* ("Gate E1 has the shortest queue") | `app/services/assistant.py`, `/api/assistant/chat` |
| **Crowd management** | Live zone density, gate queues, automatic congestion alerts with concrete recommendations | `app/services/crowd.py`, `/api/crowd/status` |
| **Operational intelligence / real-time decision support** | One-click GenAI briefing that converts raw telemetry into a prioritized, assignable action list for staff and volunteers — in their language | `app/services/briefing.py`, `/api/ops/briefing` |
| **Transportation** | Transit hub is a routable map node; egress alerts pre-position transit marshals | `stadium.json`, alert engine |

## Who it serves

- **Fans** — chat assistant, quick-asks, narrated accessible routes.
- **Organizers & venue staff** — the control-room console: KPIs with live trends, bowl density map, gate boards, ranked priority actions, alert feed.
- **Volunteers** — briefings written as plain, assignable actions, generated in any supported language (a Spanish-speaking volunteer crew gets their briefing in Spanish).

## Why GenAI (and not just dashboards)

The deterministic layer (routing, telemetry, alert thresholds) produces *facts*.
GenAI is applied exactly where language is the bottleneck:

- translating operational facts into **any fan's language**, conversationally;
- compressing a wall of telemetry into a **prioritized briefing** a volunteer can act on;
- turning a node list into **human directions** ("take the elevator on your right").

Grounding every prompt in live structured state keeps the model factual; the
resilient provider chain (NVIDIA NIM → Gemini → offline mock) keeps the venue
covered even if an upstream API fails mid-match — availability *is* an
operations requirement.

## Honest scope

Crowd telemetry is simulated deterministically (a real deployment would ingest
turnstile/CV feeds through the same `CrowdSnapshot` interface), and the demo maps
one venue. Both are deliberate: they make the full experience reproducible on a
judge's laptop with zero keys, zero network, and one command.
