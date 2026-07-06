"""Contract shared by every GenAI provider in the fallback chain."""

from abc import ABC, abstractmethod
from dataclasses import dataclass


class ProviderError(Exception):
    """Raised when a provider cannot produce a completion (triggers fallback)."""


@dataclass(frozen=True, slots=True)
class Completion:
    """A single LLM answer plus which provider produced it."""

    text: str
    provider: str
    model: str


class LLMProvider(ABC):
    """One backend capable of turning (system, user) prompts into text."""

    name: str = "base"

    @abstractmethod
    def available(self) -> bool:
        """Cheap, local check — is this provider configured to even try?"""

    @abstractmethod
    async def complete(self, system: str, user: str) -> Completion:
        """Generate a completion. Must raise ProviderError on any failure."""
