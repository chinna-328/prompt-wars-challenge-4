# Security

## Threat model

Public-facing fan endpoints + LLM backends + a control-room UI. The interesting
surfaces: untrusted fan text flowing into prompts, LLM text flowing into the DOM,
API keys, and abuse of the (expensive) GenAI endpoints.

## Mitigations, by surface

### Input validation (every endpoint)
- Pydantic schemas bound everything: message length ≤ 1000, node ids must match
  `^[a-z0-9_]+$`, languages are a closed enum, match minute is range-checked
  (`app/schemas.py`). Malformed input dies at the boundary with a 422.

### Prompt injection (fan text → LLM)
- User text is fenced in `<fan_message>` tags and the system prompt explicitly
  instructs the model to treat it as data, never as instructions, and to refuse
  role/rule changes (`app/services/assistant.py`).
- The model is grounded in server-generated state only; it has no tools, no
  memory, and no access beyond the completion call — worst case is a bad answer,
  never a bad action.

### XSS (LLM text → DOM)
- The frontend never uses `innerHTML`. Every dynamic string — including all LLM
  output — is rendered via `textContent`/`createElement` (`static/app.js`), so
  model output cannot inject markup even if a provider is compromised.
- Strict `Content-Security-Policy` (no inline script/style, `frame-ancestors
  'none'`) plus `nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy:
  no-referrer` on **every** response (`app/security.py`).

### Secrets
- Keys live only in environment variables, typed as `SecretStr` so they can't
  appear in reprs or logs (`app/config.py`); blank values are normalized to
  "unset" so an empty `.env` line can't half-configure a provider.
- Gemini key is sent as a header, not a query parameter — keys never enter URLs,
  access logs, or proxies (`app/providers/gemini.py`).
- Provider failures are logged by exception class only — payloads (which echo
  user input) and keys never reach logs.
- `.env` is gitignored; `.env.example` ships empty placeholders.

### Abuse / cost control
- Sliding-window rate limit per client IP on all LLM-backed routes
  (429 + `Retry-After`); telemetry reads stay unmetered (`app/security.py`).
- Upstream timeouts on every provider call; briefings are cached (TTL) so a
  refresh-spamming dashboard cannot fan out into duplicate LLM spend.

### Container
- Multi-stage image, non-root user (uid 10001), read-only root filesystem,
  `cap_drop: ALL`, `no-new-privileges` (Dockerfile, docker-compose.yml).
- Only `app/` and `static/` are shipped; tests, docs, git history excluded via
  `.dockerignore`.

## Known limits (deliberate, documented)

- No authentication: the demo is a single-tenant kiosk/control-room app. The
  drop-in point for a real deployment is FastAPI dependency middleware (venue
  SSO for staff routes).
- Rate-limiter state is per-process; multi-replica deployments would back it
  with Redis.
