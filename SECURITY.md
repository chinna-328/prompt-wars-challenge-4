# Security policy

## Reporting a vulnerability

Please report suspected vulnerabilities privately via
[GitHub's private vulnerability reporting](../../security/advisories/new)
on this repository — do **not** open a public issue for security problems.
You can expect an acknowledgement within 48 hours.

## Scope

The deployed demo handles no personal data and requires no accounts, but we
treat the following as security-relevant and in scope:

- Prompt-injection paths from fan input into the GenAI providers
- XSS via LLM or API output reaching the DOM
- API-key exposure through logs, URLs, or error messages
- Bypass of the rate limiting on LLM-backed endpoints

## Design documentation

The full threat model and the mitigations for each surface (input validation,
prompt fencing, CSP and response headers, secret handling, abuse control,
supply chain, container hardening) are documented in
[docs/SECURITY.md](docs/SECURITY.md).
