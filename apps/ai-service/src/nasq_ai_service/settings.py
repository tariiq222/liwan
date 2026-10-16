from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from typing import Literal

Provider = Literal["anthropic", "openai", "ollama"]
PROVIDERS: tuple[Provider, ...] = ("anthropic", "openai", "ollama")
CLOUD_PROVIDERS = {"anthropic", "openai"}


class SettingsError(ValueError):
    """A bad or missing variable; ``variable`` is the only part safe to report outside the logs."""

    def __init__(self, variable: str, message: str) -> None:
        super().__init__(message)
        self.variable = variable


def _retention_days(environ: Mapping[str, str]) -> int:
    raw = environ.get("AI_RUN_RETENTION_DAYS", "30")
    try:
        days = int(raw)
    except ValueError:
        days = 0
    if days < 1:
        msg = "AI_RUN_RETENTION_DAYS must be an integer >= 1"
        raise SettingsError("AI_RUN_RETENTION_DAYS", msg)
    return days


MIN_SERVICE_TOKEN_LENGTH = 24


def _service_token(environ: Mapping[str, str]) -> str | None:
    token = environ.get("AI_SERVICE_TOKEN") or None
    if token is not None and len(token) < MIN_SERVICE_TOKEN_LENGTH:
        msg = f"AI_SERVICE_TOKEN must be at least {MIN_SERVICE_TOKEN_LENGTH} characters"
        raise SettingsError("AI_SERVICE_TOKEN", msg)
    return token


@dataclass(frozen=True)
class CleanupSettings:
    """What the retention job needs: the database and the window, no provider, model or key."""

    database_url: str
    retention_days: int

    @classmethod
    def from_env(cls, environ: Mapping[str, str]) -> CleanupSettings:
        database_url = environ.get("AI_DATABASE_URL", "").strip()
        if not database_url:
            msg = "AI_DATABASE_URL is required"
            raise SettingsError("AI_DATABASE_URL", msg)
        return cls(database_url=database_url, retention_days=_retention_days(environ))


@dataclass(frozen=True)
class Settings:
    provider: Provider
    model: str
    api_key: str | None
    base_url: str | None
    database_url: str | None
    default_timeout_seconds: int
    service_token: str | None = None

    @classmethod
    def from_env(cls, environ: Mapping[str, str]) -> Settings:
        provider = environ.get("AI_PROVIDER", "")
        if provider not in PROVIDERS:
            msg = f"AI_PROVIDER must be one of {PROVIDERS}, got {provider!r}"
            raise SettingsError("AI_PROVIDER", msg)
        model = environ.get("AI_MODEL", "").strip()
        if not model:
            msg = "AI_MODEL is required"
            raise SettingsError("AI_MODEL", msg)
        api_key = environ.get("AI_API_KEY") or None
        if provider in CLOUD_PROVIDERS and not api_key:
            msg = f"AI_API_KEY is required for provider {provider}"
            raise SettingsError("AI_API_KEY", msg)
        database_url = environ.get("AI_DATABASE_URL", "").strip() or None
        if database_url is None and environ.get("AI_ALLOW_MEMORY_STATE") != "true":
            msg = "AI_DATABASE_URL is required (set AI_ALLOW_MEMORY_STATE=true only for local development)"
            raise SettingsError("AI_DATABASE_URL", msg)
        return cls(
            provider=provider,  # type: ignore[arg-type]
            model=model,
            api_key=api_key,
            base_url=environ.get("AI_BASE_URL") or None,
            database_url=database_url,
            default_timeout_seconds=int(environ.get("AI_DEFAULT_TIMEOUT_SECONDS", "120")),
            service_token=_service_token(environ),
        )
