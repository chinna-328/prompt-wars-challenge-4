"""NVIDIA NIM provider — primary GenAI backend (OpenAI-compatible API)."""

import logging

import httpx

from app.config import Settings
from app.providers.base import Completion, LLMProvider, ProviderError

logger = logging.getLogger(__name__)


class NvidiaProvider(LLMProvider):
    name = "nvidia"

    def __init__(self, settings: Settings, client: httpx.AsyncClient) -> None:
        self._settings = settings
        self._client = client

    def available(self) -> bool:
        return self._settings.nvidia_api_key is not None

    async def complete(self, system: str, user: str) -> Completion:
        if not self.available():
            raise ProviderError("NVIDIA_API_KEY not configured")
        key = self._settings.nvidia_api_key.get_secret_value()  # type: ignore[union-attr]
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
