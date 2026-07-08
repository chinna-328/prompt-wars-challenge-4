"""Google Gemini provider — backup GenAI backend (REST generateContent API)."""

import logging

import httpx

from app.config import Settings
from app.providers.base import Completion, LLMProvider, ProviderError

logger = logging.getLogger(__name__)


class GeminiProvider(LLMProvider):
    """Backup provider: Gemini's REST generateContent endpoint."""

    name = "gemini"

    def __init__(self, settings: Settings, client: httpx.AsyncClient) -> None:
        self._settings = settings
        self._client = client

    def available(self) -> bool:
        """Configured iff GEMINI_API_KEY is set (blank values count as unset)."""
        return self._settings.gemini_api_key is not None

    async def complete(self, system: str, user: str) -> Completion:
        """POST a generateContent request; any failure becomes ProviderError."""
        # Narrow the optional key locally so the None case is handled
        # explicitly instead of being silenced with a suppression comment.
        api_key = self._settings.gemini_api_key
        if api_key is None:
            raise ProviderError("GEMINI_API_KEY not configured")
        key = api_key.get_secret_value()
        url = (
            f"{self._settings.gemini_base_url}/models/{self._settings.gemini_model}:generateContent"
        )
        try:
            response = await self._client.post(
                url,
                # Key travels in a header, not the query string, so it can
                # never leak into access logs or proxies.
                headers={"x-goog-api-key": key},
                json={
                    "system_instruction": {"parts": [{"text": system}]},
                    "contents": [{"role": "user", "parts": [{"text": user}]}],
                    "generationConfig": {
                        "temperature": 0.4,
                        "maxOutputTokens": self._settings.llm_max_output_tokens,
                    },
                },
                timeout=self._settings.llm_timeout_seconds,
            )
            response.raise_for_status()
            data = response.json()
            text = data["candidates"][0]["content"]["parts"][0]["text"].strip()
        except (httpx.HTTPError, KeyError, IndexError, ValueError) as exc:
            logger.warning("Gemini provider failed: %s", type(exc).__name__)
            raise ProviderError("Gemini request failed") from exc
        if not text:
            raise ProviderError("Gemini returned an empty completion")
        return Completion(text=text, provider=self.name, model=self._settings.gemini_model)
