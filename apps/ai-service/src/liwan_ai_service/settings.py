from __future__ import annotations

import re
from collections.abc import Mapping
from dataclasses import dataclass

from liwan_ai_service.contracts import AI_STATE_VERSION, MODEL_NAME, PROVIDER_NAME
from liwan_ai_service.provider_registry import REGISTRY


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
GENERATION_ID = re.compile(r"^[a-z][a-z0-9_-]{0,62}$")


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
    provider: str
    model: str
    api_key: str | None
    base_url: str | None
    database_url: str | None
    default_timeout_seconds: int
    service_token: str | None = None
    openrouter_referer: str | None = None
    openrouter_title: str | None = None
    state_version: str = AI_STATE_VERSION
    generation_id: str | None = None

    @classmethod
    def from_env(cls, environ: Mapping[str, str]) -> Settings:
        state_version = environ.get("AI_STATE_VERSION", AI_STATE_VERSION)
        if state_version != AI_STATE_VERSION:
            raise SettingsError("AI_STATE_VERSION", "AI_STATE_VERSION is incompatible with this runtime")
        generation_id = environ.get("AI_GENERATION_ID")
        if generation_id is not None and not GENERATION_ID.fullmatch(generation_id):
            raise SettingsError("AI_GENERATION_ID", "AI_GENERATION_ID must be a stable generation identifier")
        provider = environ.get("AI_PROVIDER", "")
        if provider not in REGISTRY:
            msg = f"AI_PROVIDER must be one of {', '.join(REGISTRY)}, got {provider!r}"
            raise SettingsError("AI_PROVIDER", msg)
        if not re.fullmatch(PROVIDER_NAME, provider):  # reported with every provider call: a bad name fails the boot, not every plan
            raise SettingsError("AI_PROVIDER", f"AI_PROVIDER must match {PROVIDER_NAME}")
        model = environ.get("AI_MODEL", "").strip()
        if not model:
            msg = "AI_MODEL is required"
            raise SettingsError("AI_MODEL", msg)
        if not re.fullmatch(MODEL_NAME, model):
            raise SettingsError("AI_MODEL", "AI_MODEL must be 1 to 128 characters without control characters")
        api_key = environ.get("AI_API_KEY") or None
        if REGISTRY[provider].needs_api_key and not api_key:
            msg = f"AI_API_KEY is required for provider {provider}"
            raise SettingsError("AI_API_KEY", msg)
        database_url = environ.get("AI_DATABASE_URL", "").strip() or None
        if database_url is None and environ.get("AI_ALLOW_MEMORY_STATE") != "true":
            msg = "AI_DATABASE_URL is required (set AI_ALLOW_MEMORY_STATE=true only for local development)"
            raise SettingsError("AI_DATABASE_URL", msg)
        return cls(
            provider=provider,
            model=model,
            api_key=api_key,
            base_url=environ.get("AI_BASE_URL") or None,
            database_url=database_url,
            default_timeout_seconds=int(environ.get("AI_DEFAULT_TIMEOUT_SECONDS", "120")),
            service_token=_service_token(environ),
            openrouter_referer=environ.get("AI_OPENROUTER_REFERER") or None,
            openrouter_title=environ.get("AI_OPENROUTER_TITLE") or None,
            state_version=state_version,
            generation_id=generation_id,
        )
