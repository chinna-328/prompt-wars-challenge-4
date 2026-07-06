"""Typed application settings, loaded once from the environment.

Secrets never leave this module except through the provider clients;
`repr` of the settings object masks key material.
"""

from functools import lru_cache

from pydantic import Field, SecretStr, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    app_env: str = "development"
    log_level: str = "INFO"

    # GenAI provider chain (all optional — mock provider needs nothing)
    nvidia_api_key: SecretStr | None = None
    nvidia_model: str = "meta/llama-3.1-70b-instruct"
    nvidia_base_url: str = "https://integrate.api.nvidia.com/v1"

    gemini_api_key: SecretStr | None = None
    gemini_model: str = "gemini-2.0-flash"
    gemini_base_url: str = "https://generativelanguage.googleapis.com/v1beta"

    llm_timeout_seconds: float = Field(default=20.0, gt=0, le=120)
    llm_max_output_tokens: int = Field(default=700, gt=0, le=4096)

    rate_limit_per_minute: int = Field(default=30, gt=0, le=1000)

    @field_validator("nvidia_api_key", "gemini_api_key", mode="before")
    @classmethod
    def _blank_key_is_unset(cls, value: object) -> object:
        """An empty NVIDIA_API_KEY= line in .env must not count as configured."""
        if isinstance(value, str) and not value.strip():
            return None
        return value


@lru_cache
def get_settings() -> Settings:
    """Cached accessor so every module shares one validated Settings instance."""
    return Settings()
