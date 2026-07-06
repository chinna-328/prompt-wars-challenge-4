"""Shared fixtures. The suite runs fully offline: with no API keys configured
the provider chain terminates at the deterministic mock, so tests exercise
the exact code paths a keyless judge deployment uses."""

import pytest
from fastapi.testclient import TestClient

from app.config import get_settings
from app.main import create_app


@pytest.fixture()
def client(monkeypatch):
    # Ensure no real keys leak in from the developer's environment or .env —
    # blank values are normalized to "unset" by Settings.
    monkeypatch.setenv("NVIDIA_API_KEY", "")
    monkeypatch.setenv("GEMINI_API_KEY", "")
    get_settings.cache_clear()
    with TestClient(create_app()) as test_client:
        yield test_client
    get_settings.cache_clear()
