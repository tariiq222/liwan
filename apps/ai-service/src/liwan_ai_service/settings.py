from __future__ import annotations

import re
from collections.abc import Mapping
from dataclasses import dataclass

from liwan_ai_service.contracts import AI_STATE_VERSION, MODEL_NAME, PROVIDER_NAME
from liwan_ai_service.provider_registry import REGISTRY
from liwan_ai_service.tenancy import tenancy_from_env
from liwan_ai_service.tenant_config import Keyring


class SettingsError(ValueError):
    """A bad or missing variable; ``variable`` is the only part safe to report outside the logs."""

    def __init__(self, variable: str, message: str) -> None:
        super().__init__(message)
        self.variable = variable


def bootstrap_retention_days(environ: Mapping[str, str]) -> int:
    """``AI_RUN_RETENTION_DAYS``: the window a newly bootstrapped tenant starts with (its administrator may change it)."""
    raw = environ.get("AI_RUN_RETENTION_DAYS", "30")
    try:
        days = int(raw)
    except ValueError:
        days = 0
    if not 1 <= days <= 365:  # the bounds of ai_tenant_config.retention_days
        msg = "AI_RUN_RETENTION_DAYS must be an integer from 1 to 365"
        raise SettingsError("AI_RUN_RETENTION_DAYS", msg)
    return days


EMBEDDING_PROVIDERS = ("openai", "ollama")  # openai covers any OpenAI-compatible endpoint (AI_EMBEDDING_BASE_URL)
EMBEDDING_VARIABLES = ("AI_EMBEDDING_MODEL", "AI_EMBEDDING_BASE_URL", "AI_EMBEDDING_API_KEY")


@dataclass(frozen=True)
class EmbeddingSettings:
    """The operator's embedding endpoint for knowledge retrieval; without it the knowledge search is unavailable."""

    provider: str
    model: str
    base_url: str | None = None
    api_key: str | None = None

    @classmethod
    def from_env(cls, environ: Mapping[str, str]) -> EmbeddingSettings | None:
        provider = environ.get("AI_EMBEDDING_PROVIDER", "").strip()
        if not provider:
            stray = next((name for name in EMBEDDING_VARIABLES if environ.get(name, "").strip()), None)
            if stray is not None:  # a half-written configuration must stop the boot, not silently disable the search
                msg = f"AI_EMBEDDING_PROVIDER is required when {stray} is set"
                raise SettingsError("AI_EMBEDDING_PROVIDER", msg)
            return None
        if provider not in EMBEDDING_PROVIDERS:
            msg = f"AI_EMBEDDING_PROVIDER must be one of {', '.join(EMBEDDING_PROVIDERS)}, got {provider!r}"
            raise SettingsError("AI_EMBEDDING_PROVIDER", msg)
        model = environ.get("AI_EMBEDDING_MODEL", "").strip()
        if not re.fullmatch(MODEL_NAME, model):
            raise SettingsError("AI_EMBEDDING_MODEL", "AI_EMBEDDING_MODEL is required: 1 to 128 characters without control characters")
        base_url = environ.get("AI_EMBEDDING_BASE_URL", "").strip() or None
        if base_url is not None and not base_url.startswith(("http://", "https://")):
            raise SettingsError("AI_EMBEDDING_BASE_URL", "AI_EMBEDDING_BASE_URL must be an http(s) URL")
        api_key = environ.get("AI_EMBEDDING_API_KEY") or None
        if provider == "openai" and not api_key:
            raise SettingsError("AI_EMBEDDING_API_KEY", "AI_EMBEDDING_API_KEY is required for provider openai")
        return cls(provider=provider, model=model, base_url=base_url, api_key=api_key)


MIN_SERVICE_TOKEN_LENGTH = 24
GENERATION_ID = re.compile(r"^[a-z][a-z0-9_-]{0,62}$")


def _dev_insecure(environ: Mapping[str, str]) -> bool:
    """``AI_DEV_INSECURE=true`` is the only way to run without a token, and it never touches real state."""
    if environ.get("AI_DEV_INSECURE", "") != "true":
        return False
    if environ.get("AI_ALLOW_MEMORY_STATE") != "true" or environ.get("AI_DATABASE_URL", "").strip():
        msg = "AI_DEV_INSECURE=true requires AI_ALLOW_MEMORY_STATE=true and no AI_DATABASE_URL"
        raise SettingsError("AI_DEV_INSECURE", msg)
    return True


def _service_token(environ: Mapping[str, str], *, dev_insecure: bool) -> str | None:
    token = environ.get("AI_SERVICE_TOKEN") or None
    if token is None:
        if not dev_insecure:
            msg = (
                "AI_SERVICE_TOKEN is required "
                f"(at least {MIN_SERVICE_TOKEN_LENGTH} characters; set AI_DEV_INSECURE=true only for local development)"
            )
            raise SettingsError("AI_SERVICE_TOKEN", msg)
        return None
    if len(token) < MIN_SERVICE_TOKEN_LENGTH:
        msg = f"AI_SERVICE_TOKEN must be at least {MIN_SERVICE_TOKEN_LENGTH} characters"
        raise SettingsError("AI_SERVICE_TOKEN", msg)
    return token


@dataclass(frozen=True)
class CleanupSettings:
    """What the retention job needs: the database only; each tenant's window is in its own ``ai_tenant_config``."""

    database_url: str

    @classmethod
    def from_env(cls, environ: Mapping[str, str]) -> CleanupSettings:
        database_url = environ.get("AI_DATABASE_URL", "").strip()
        if not database_url:
            msg = "AI_DATABASE_URL is required"
            raise SettingsError("AI_DATABASE_URL", msg)
        return cls(database_url=database_url)


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
    keyring: Keyring | None = None  # encrypts tenant provider keys; None leaves the tenant-key mode unavailable
    tenancy_mode: str = "dedicated"
    tenant_database: str | None = None
    tenant_registry_path: str | None = None
    embedding: EmbeddingSettings | None = None  # knowledge retrieval (spec 2026-11-04 §6.3); None leaves it unavailable

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
        dev_insecure = _dev_insecure(environ)
        database_url = environ.get("AI_DATABASE_URL", "").strip() or None
        if database_url is None and environ.get("AI_ALLOW_MEMORY_STATE") != "true":
            msg = "AI_DATABASE_URL is required (set AI_ALLOW_MEMORY_STATE=true only for local development)"
            raise SettingsError("AI_DATABASE_URL", msg)
        tenancy_mode, tenant_database, tenant_registry_path = tenancy_from_env(environ)
        return cls(
            provider=provider,
            model=model,
            api_key=api_key,
            base_url=environ.get("AI_BASE_URL") or None,
            database_url=database_url,
            default_timeout_seconds=int(environ.get("AI_DEFAULT_TIMEOUT_SECONDS", "120")),
            service_token=_service_token(environ, dev_insecure=dev_insecure),
            openrouter_referer=environ.get("AI_OPENROUTER_REFERER") or None,
            openrouter_title=environ.get("AI_OPENROUTER_TITLE") or None,
            state_version=state_version,
            tenancy_mode=tenancy_mode,
            tenant_database=tenant_database,
            tenant_registry_path=tenant_registry_path,
            generation_id=generation_id,
            keyring=Keyring.from_env(environ),
            embedding=EmbeddingSettings.from_env(environ),
        )
