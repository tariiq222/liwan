"""The platform provider: the model LiwanOS itself pays for, read from one JSON file (spec 2026-11-04 §6.13).

``AI_PLATFORM_PROVIDER_FILE`` names a file with ``provider``, ``model``, ``base_url``, ``api_key`` and ``revision``. In
shared SaaS the control plane writes it from the vendor's provider panel; in a dedicated or customer-hosted deployment
``deploy/provision.sh`` writes it from ``deploy/.env``. This module validates it, builds the model from it, and watches it:
a valid change replaces the model whole (a run that already started keeps the model it began on), an invalid one is logged
by reason only and the last valid configuration stays. The file is never required to be there after the first start,
so the product keeps running on the last configuration whatever happens to its writer.
"""
from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import re
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import urlsplit

from langchain_core.language_models import BaseChatModel

from liwan_ai_service.contracts import MODEL_NAME, PROVIDER_NAME
from liwan_ai_service.provider_registry import REGISTRY
from liwan_ai_service.providers import build_platform_model
from liwan_ai_service.settings import PLATFORM_PROVIDER_FILE, Settings, SettingsError
from liwan_ai_service.tenant_egress import PRINTABLE_ASCII
from liwan_ai_service.usage import ModelIdentity, RunModel

log = logging.getLogger(__name__)

POLL_SECONDS = 5
FIELDS = frozenset({"provider", "model", "base_url", "api_key", "revision", "stream_usage"})
MAX_FILE_BYTES = 16 * 1024
UNREADABLE = "unreadable"
# Where the file comes from in the shipped Compose files; shown when the service cannot read it at start.
MISSING_FILE_HINT = (
    "in Docker Compose the file is platform-provider.json in the directory LIWAN_AI_PLATFORM_DIR, "
    "written by deploy/provision.sh or, in shared SaaS, by the control plane"
)


class PlatformProviderError(SettingsError):
    """The file cannot be the platform provider. ``reason`` names the problem and never carries a value from the file."""

    def __init__(self, reason: str, field: str | None = None, hint: str | None = None) -> None:
        variable = f"{PLATFORM_PROVIDER_FILE}.{field}" if field else PLATFORM_PROVIDER_FILE
        super().__init__(variable, f"{variable}: {reason}" + (f" ({hint})" if hint else ""))
        self.reason = f"{field}: {reason}" if field else reason


@dataclass(frozen=True)
class PlatformProvider:
    provider: str
    model: str
    base_url: str | None
    api_key: str | None
    revision: int
    stream_usage: bool | None = None  # ask the stream for token counts; None: the provider's own rule (a custom endpoint is not asked)


def _text(value: object, field: str, *, required: bool) -> str | None:
    if value is None or value == "":
        if required:
            raise PlatformProviderError("is required", field)
        return None
    if not isinstance(value, str):
        raise PlatformProviderError("must be a string", field)
    return value


def _endpoint(value: str) -> None:
    """The shape of a base URL that carries a key: http(s), a host, and no credentials, query or fragment."""
    try:
        parts = urlsplit(value)
        parts.port  # noqa: B018 - a bad port raises here
    except ValueError:
        raise PlatformProviderError("must be an http(s) URL", "base_url") from None
    if (
        not PRINTABLE_ASCII.fullmatch(value) or parts.scheme not in ("http", "https") or not parts.hostname
        or "@" in parts.netloc or parts.query or parts.fragment
    ):
        raise PlatformProviderError("must be an http(s) URL without credentials, query or fragment", "base_url")


def parse_platform_provider(raw: bytes) -> PlatformProvider:
    """The platform provider a file's bytes describe, under the rules the tenant keys follow too (spec §6.8)."""
    try:
        data = json.loads(raw)
    except ValueError:
        raise PlatformProviderError("is not JSON") from None
    if not isinstance(data, dict):
        raise PlatformProviderError("must be a JSON object")
    unknown = sorted(set(data) - FIELDS)
    if unknown:
        raise PlatformProviderError("has an unknown field", unknown[0])
    provider = _text(data.get("provider"), "provider", required=True)
    if provider not in REGISTRY or not re.fullmatch(PROVIDER_NAME, provider):
        raise PlatformProviderError(f"must be one of {', '.join(REGISTRY)}", "provider")
    spec = REGISTRY[provider]
    model = _text(data.get("model"), "model", required=True)
    if not re.fullmatch(MODEL_NAME, model):
        raise PlatformProviderError("must be 1 to 128 characters without control characters", "model")
    api_key = _text(data.get("api_key"), "api_key", required=False)
    if spec.needs_api_key and not api_key:
        raise PlatformProviderError("is required for this provider", "api_key")
    base_url = _text(data.get("base_url"), "base_url", required=spec.needs_base_url)
    if base_url is not None:
        _endpoint(base_url)
    revision = data.get("revision")
    if isinstance(revision, bool) or not isinstance(revision, int) or revision < 1:
        raise PlatformProviderError("must be an integer from 1", "revision")
    stream_usage = data.get("stream_usage")
    if stream_usage is not None and not isinstance(stream_usage, bool):
        raise PlatformProviderError("must be true or false", "stream_usage")
    return PlatformProvider(provider, model, base_url if spec.takes_base_url else None, api_key, revision, stream_usage)


def _read(path: str) -> bytes:
    with Path(path).open("rb") as file:
        raw = file.read(MAX_FILE_BYTES + 1)
    if len(raw) > MAX_FILE_BYTES:
        raise PlatformProviderError("is too large")
    return raw


class PlatformModel:
    """The model runs use when the tenant is on the platform provider; ``current`` is replaced whole, never edited."""

    @dataclass(frozen=True)
    class Active:
        provider: PlatformProvider
        run_model: RunModel

    def __init__(self, provider: PlatformProvider, model: BaseChatModel, *, digest: str | None = None) -> None:
        self.current = self._active(provider, model)
        self.digest = digest
        self._keys: set[str] = {provider.api_key} if provider.api_key else set()  # every key since start: a late log line is still redacted

    @staticmethod
    def _active(provider: PlatformProvider, model: BaseChatModel) -> PlatformModel.Active:
        return PlatformModel.Active(provider, RunModel(model, ModelIdentity(provider.provider, provider.model, "platform")))

    @property
    def secrets(self) -> tuple[str, ...]:
        return tuple(self._keys)

    def replace(self, provider: PlatformProvider, model: BaseChatModel, digest: str) -> None:
        if provider.api_key:
            self._keys.add(provider.api_key)
        self.current = self._active(provider, model)
        self.digest = digest


def open_platform_model(settings: Settings) -> PlatformModel:
    """The platform model from the file at start; a missing or invalid file stops the boot, naming the problem."""
    try:
        raw = _read(settings.platform_provider_file)
    except OSError:
        raise PlatformProviderError(UNREADABLE, hint=MISSING_FILE_HINT) from None
    provider = parse_platform_provider(raw)
    return PlatformModel(provider, build_platform_model(settings, provider), digest=hashlib.sha256(raw).hexdigest())


async def watch_platform_provider(
    platform: PlatformModel, settings: Settings, on_change: Callable[[PlatformProvider], Awaitable[None]], interval: float = POLL_SECONDS,
) -> None:
    """Rebuild the platform model whenever the file's content changes, forever; cancelled at shutdown.

    The content is hashed each poll, so a rewrite with an older timestamp (a restored backup) is seen too. A rejected
    content is logged once, by reason, and the last valid configuration stays until the file is valid again.
    """
    seen = platform.digest
    while True:
        await asyncio.sleep(interval)
        try:
            raw = await asyncio.to_thread(_read, settings.platform_provider_file)
        except (OSError, PlatformProviderError) as error:
            digest = UNREADABLE if isinstance(error, OSError) else "too_large"
            if digest != seen:
                seen = digest
                log.warning("platform provider file not read (%s); the last valid configuration stays", digest)
            continue
        digest = hashlib.sha256(raw).hexdigest()
        if digest == seen:
            continue
        seen = digest
        try:
            provider = parse_platform_provider(raw)
            model = build_platform_model(settings, provider)
        except PlatformProviderError as error:
            log.warning("platform provider file rejected (%s); the last valid configuration stays", error.reason)
            continue
        except Exception as error:  # noqa: BLE001 - an SDK refusing the values must not stop the watch
            log.warning("platform provider file rejected (could not be built: %s); the last valid configuration stays", type(error).__name__)
            continue
        platform.replace(provider, model, digest)
        log.info("platform provider reloaded: %s %s, revision %d", provider.provider, provider.model, provider.revision)
        try:
            await on_change(provider)
        except Exception as error:  # noqa: BLE001 - the model is already replaced; a failed side effect is logged
            log.warning("platform provider change not fully applied: %s", type(error).__name__)
