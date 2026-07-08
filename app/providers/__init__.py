"""GenAI provider chain: NVIDIA NIM → Google Gemini → offline mock.

The chain tries each configured provider in order and falls through on
failure, so a venue never loses assistant coverage because one upstream
API is down — a hard requirement for live match-day operations.
"""

import logging

import httpx

from app.config import Settings
from app.providers.base import Completion, LLMProvider, ProviderError
from app.providers.gemini import GeminiProvider
from app.providers.mock import MockProvider
from app.providers.nvidia import NvidiaProvider

logger = logging.getLogger(__name__)


class ProviderChain:
    """Resilient facade over an ordered list of providers."""

    def __init__(self, providers: list[LLMProvider]) -> None:
        if not providers:
            raise ValueError("ProviderChain needs at least one provider")
        self._providers = providers

    @property
    def active_names(self) -> list[str]:
        """Names of the providers currently configured, in fallback order."""
        return [p.name for p in self._providers if p.available()]

    async def complete(self, system: str, user: str) -> Completion:
        """Try each available provider in order; return the first completion."""
        last_error: ProviderError | None = None
        for provider in self._providers:
            if not provider.available():
                continue
            try:
                return await provider.complete(system, user)
            except ProviderError as exc:
                logger.warning("Provider '%s' failed, falling back", provider.name)
                last_error = exc
        # Unreachable while MockProvider terminates the chain, but kept so the
        # chain stays correct if someone reconfigures it without a terminator.
        raise last_error or ProviderError("No GenAI provider available")


def build_chain(settings: Settings, client: httpx.AsyncClient) -> ProviderChain:
    """Assemble the production chain: NVIDIA → Gemini → offline mock."""
    return ProviderChain(
        [
            NvidiaProvider(settings, client),
            GeminiProvider(settings, client),
            MockProvider(),
        ]
    )
