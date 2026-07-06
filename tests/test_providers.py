"""Provider chain: ordering, fallback on failure, and the offline terminator."""

import pytest

from app.providers import ProviderChain
from app.providers.base import Completion, LLMProvider, ProviderError
from app.providers.mock import MockProvider


class _Unavailable(LLMProvider):
    name = "unavailable"

    def available(self) -> bool:
        return False

    async def complete(self, system: str, user: str) -> Completion:  # pragma: no cover
        raise AssertionError("must never be called")


class _Failing(LLMProvider):
    name = "failing"

    def __init__(self) -> None:
        self.calls = 0

    def available(self) -> bool:
        return True

    async def complete(self, system: str, user: str) -> Completion:
        self.calls += 1
        raise ProviderError("upstream down")


async def test_chain_skips_unconfigured_and_falls_back_on_failure():
    failing = _Failing()
    chain = ProviderChain([_Unavailable(), failing, MockProvider()])
    result = await chain.complete("You are an assistant.", "hello")
    assert failing.calls == 1, "configured provider must be tried first"
    assert result.provider == "mock"
    assert result.text


async def test_chain_raises_when_every_provider_fails():
    chain = ProviderChain([_Failing()])
    with pytest.raises(ProviderError):
        await chain.complete("s", "u")


def test_chain_requires_at_least_one_provider():
    with pytest.raises(ValueError):
        ProviderChain([])


def test_active_names_reflect_availability():
    chain = ProviderChain([_Unavailable(), MockProvider()])
    assert chain.active_names == ["mock"]


@pytest.mark.parametrize(
    ("system", "marker"),
    [
        ("You write an operations briefing for staff.", "OPERATIONS BRIEFING"),
        ("You are the navigation narrator for a venue.", "route"),
        ("You are a friendly venue assistant.", "help"),
    ],
)
async def test_mock_recognizes_each_task(system, marker):
    completion = await MockProvider().complete(system, "input")
    assert marker.lower() in completion.text.lower()
