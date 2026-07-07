"""Live-provider HTTP behavior against a mocked transport.

These are the code paths that run when real API keys are configured. A
mocked httpx transport lets us verify request construction (auth headers,
payload shape) and response/error handling with zero network traffic, so
the suite stays offline.
"""

import httpx
import pytest

from app.config import Settings
from app.providers.base import ProviderError
from app.providers.gemini import GeminiProvider
from app.providers.nvidia import NvidiaProvider


def _client(handler) -> httpx.AsyncClient:
    return httpx.AsyncClient(transport=httpx.MockTransport(handler))


def _settings(**overrides) -> Settings:
    return Settings(_env_file=None, **overrides)


# --- NVIDIA NIM (OpenAI-compatible) -----------------------------------------


async def test_nvidia_sends_bearer_auth_and_parses_completion():
    seen: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["url"] = str(request.url)
        seen["auth"] = request.headers.get("authorization")
        return httpx.Response(
            200, json={"choices": [{"message": {"content": "  Gate E2 is clear.  "}}]}
        )

    settings = _settings(nvidia_api_key="test-key")
    provider = NvidiaProvider(settings, _client(handler))
    completion = await provider.complete("system prompt", "user prompt")

    assert seen["url"].endswith("/chat/completions")
    assert seen["auth"] == "Bearer test-key"
    assert completion.text == "Gate E2 is clear."
    assert completion.provider == "nvidia"


async def test_nvidia_http_error_becomes_provider_error():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(500, json={"error": "upstream down"})

    provider = NvidiaProvider(_settings(nvidia_api_key="k"), _client(handler))
    with pytest.raises(ProviderError):
        await provider.complete("s", "u")


async def test_nvidia_malformed_body_becomes_provider_error():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"unexpected": "shape"})

    provider = NvidiaProvider(_settings(nvidia_api_key="k"), _client(handler))
    with pytest.raises(ProviderError):
        await provider.complete("s", "u")


async def test_nvidia_empty_completion_becomes_provider_error():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"choices": [{"message": {"content": "   "}}]})

    provider = NvidiaProvider(_settings(nvidia_api_key="k"), _client(handler))
    with pytest.raises(ProviderError):
        await provider.complete("s", "u")


async def test_nvidia_without_key_is_unavailable_and_refuses():
    provider = NvidiaProvider(_settings(), _client(lambda r: httpx.Response(200)))
    assert provider.available() is False
    with pytest.raises(ProviderError):
        await provider.complete("s", "u")


# --- Google Gemini (generateContent REST) -----------------------------------


async def test_gemini_key_travels_in_header_never_in_url():
    seen: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["url"] = str(request.url)
        seen["key_header"] = request.headers.get("x-goog-api-key")
        return httpx.Response(
            200,
            json={"candidates": [{"content": {"parts": [{"text": "Head to Gate N1."}]}}]},
        )

    settings = _settings(gemini_api_key="gem-secret")
    provider = GeminiProvider(settings, _client(handler))
    completion = await provider.complete("system prompt", "user prompt")

    assert seen["key_header"] == "gem-secret"
    assert "gem-secret" not in seen["url"], "key must never appear in the URL"
    assert seen["url"].endswith(f"models/{settings.gemini_model}:generateContent")
    assert completion.text == "Head to Gate N1."
    assert completion.provider == "gemini"


async def test_gemini_timeout_becomes_provider_error():
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ReadTimeout("upstream too slow", request=request)

    provider = GeminiProvider(_settings(gemini_api_key="k"), _client(handler))
    with pytest.raises(ProviderError):
        await provider.complete("s", "u")


async def test_gemini_http_error_becomes_provider_error():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(429, json={"error": "quota"})

    provider = GeminiProvider(_settings(gemini_api_key="k"), _client(handler))
    with pytest.raises(ProviderError):
        await provider.complete("s", "u")


async def test_gemini_malformed_body_becomes_provider_error():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"candidates": []})

    provider = GeminiProvider(_settings(gemini_api_key="k"), _client(handler))
    with pytest.raises(ProviderError):
        await provider.complete("s", "u")
