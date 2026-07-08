"""NVIDIA NIM provider — primary GenAI backend (OpenAI-compatible API)."""

import logging

import httpx

from app.config import Settings
from app.providers.base import Completion, LLMProvider, ProviderError

logger = logging.getLogger(__name__)


class NvidiaProvider(LLMProvider):
    """Primary provider: chat completions against NVIDIA NIM."""

    name = "nvidia"

    def __init__(self, settings: Settings, client: httpx.AsyncClient) -> None:
        self._settings = settings
        self._client = client

    def available(self) -> bool:
        """Configured iff NVIDIA_API_KEY is set (blank values count as unset)."""
        return self._settings.nvidia_api_key is not None

    async def complete(self, system: str, user: str) -> Completion:
        """POST an OpenAI-style chat completion; any failure becomes ProviderError."""
        # Narrow the optional key locally so the None case is handled
        # explicitly instead of being silenced with a suppression comment.
        api_key = self._settings.nvidia_api_key
        if api_key is None:
            raise ProviderError("NVIDIA_API_KEY not configured")
        key = api_key.get_secret_value()
        try:
            response = await self._client.post(
                f"{self._settings.nvidia_base_url}/chat/completions",
                headers={"Authorization": f"Bearer {key}"},
                json={
                    "model": self._settings.nvidia_model,
                    "messages": [
                        {"role": "system", "content": system},
                        {"role": "user", "content": user},
                    ],
                    "temperature": 0.4,
                    "max_tokens": self._settings.llm_max_output_tokens,
                },
                timeout=self._settings.llm_timeout_seconds,
            )
            response.raise_for_status()
            text = response.json()["choices"][0]["message"]["content"].strip()
        except (httpx.HTTPError, KeyError, IndexError, ValueError) as exc:
            # Log the class only — never the payload, which may echo user input.
            logger.warning("NVIDIA provider failed: %s", type(exc).__name__)
            raise ProviderError("NVIDIA NIM request failed") from exc
        if not text:
            raise ProviderError("NVIDIA NIM returned an empty completion")
        return Completion(text=text, provider=self.name, model=self._settings.nvidia_model)
