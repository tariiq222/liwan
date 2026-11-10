"""The platform provider: the models LiwanOS itself pays for, read from one JSON file (specs 2026-11-04 §6.13, 2026-11-10 §5.5).

``AI_PLATFORM_PROVIDER_FILE`` names a file with ``revision``, ``margin_bps``, ``providers`` (each with its endpoint and key),
``models`` (a provider, a model name and optional prices) and ``routes`` (a required ``default`` model, and an optional model
per capability for each quality level). In shared SaaS the control plane writes it from the vendor's provider panel; in a
dedicated or customer-hosted deployment ``deploy/provision.sh`` writes it from ``deploy/.env``. This module validates it,
builds the models from it, and watches it: a valid change replaces the configuration whole (a run that already started keeps
the models it began on), an invalid one is logged by reason only and the last valid configuration stays. The file is never
required to be there after the first start, so the product keeps running on the last configuration whatever happens to its writer.

Each model entry stands on its own: one that is invalid (unknown provider, bad name, bad price, an SDK that refuses it) is
dropped with one logged reason and every route to it falls back (the quality level's cell, then the ``balanced`` cell, then
``default``). Only a structural error, a bad ``revision`` or ``margin_bps``, or a ``default`` that is not usable rejects the file.
"""
from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import re
from collections.abc import Awaitable, Callable, Mapping
from dataclasses import dataclass
from pathlib import Path
from typing import get_args
from urllib.parse import urlsplit

from langchain_core.language_models import BaseChatModel

from liwan_ai_service.contracts import MODEL_NAME, PROVIDER_NAME, Capability, Quality
from liwan_ai_service.provider_registry import REGISTRY
from liwan_ai_service.providers import build_platform_model
from liwan_ai_service.routing import RunModels
from liwan_ai_service.settings import PLATFORM_PROVIDER_FILE, Settings, SettingsError
from liwan_ai_service.tenant_egress import PRINTABLE_ASCII, platform_hosts
from liwan_ai_service.usage import ModelIdentity, RunModel, price_units

log = logging.getLogger(__name__)

POLL_SECONDS = 5
FIELDS = frozenset({"revision", "margin_bps", "providers", "models", "routes"})
PROVIDER_FIELDS = frozenset({"provider", "base_url", "api_key", "stream_usage"})
MODEL_FIELDS = frozenset({"provider", "model", "input_price", "cached_input_price", "output_price"})
QUALITIES: tuple[Quality, ...] = get_args(Quality)
CAPABILITIES: tuple[Capability, ...] = get_args(Capability)
DEFAULT_ROUTE = "default"
FALLBACK_QUALITY: Quality = "balanced"
MAX_MARGIN_BPS = 10_000
# Room for a realistic configuration: some twenty providers (a key is up to 512 characters) and a hundred priced models.
MAX_FILE_BYTES = 64 * 1024
UNREADABLE = "unreadable"
SAFE_NAME = re.compile(r"[A-Za-z0-9_-]{1,40}")
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
    """One provider of the file: where it is reached and with which key."""

    provider: str
    base_url: str | None
    api_key: str | None
    stream_usage: bool | None = None  # ask the stream for token counts; None: the provider's own rule (a custom endpoint is not asked)


@dataclass(frozen=True)
class PlatformModelEntry:
    """One priced model of the file; a price is in cost units per million tokens (``usage.price_units``), None while not entered."""

    provider_id: str
    model: str
    input_units: int | None = None
    cached_input_units: int | None = None
    output_units: int | None = None


@dataclass(frozen=True)
class PlatformConfig:
    """What a file says once every entry was checked on its own; ``providers`` and ``models`` hold only the usable ones."""

    revision: int
    margin_bps: int
    providers: Mapping[str, PlatformProvider]
    models: Mapping[str, PlatformModelEntry]
    routes: Mapping[str, Mapping[str, str]]  # quality level -> capability -> model id, as the file wrote them
    default: str  # a model id in ``models``
    dropped: Mapping[str, str]  # model id -> why it is unusable (no value of the file)


def _safe(name: object) -> str:
    """A key of the file as a log-safe token: its own text when it is a plain name, else a placeholder."""
    return name if isinstance(name, str) and SAFE_NAME.fullmatch(name) else "?"


def _text(value: object, field: str, *, required: bool) -> str | None:
    if value is None or value == "":
        if required:
            raise PlatformProviderError("is required", field)
        return None
    if not isinstance(value, str):
        raise PlatformProviderError("must be a string", field)
    return value


def _endpoint(value: str, field: str) -> None:
    """The shape of a base URL that carries a key: http(s), a host, and no credentials, query or fragment."""
    try:
        parts = urlsplit(value)
        parts.port  # noqa: B018 - a bad port raises here
    except ValueError:
        raise PlatformProviderError("must be an http(s) URL", field) from None
    if (
        not PRINTABLE_ASCII.fullmatch(value) or parts.scheme not in ("http", "https") or not parts.hostname
        or "@" in parts.netloc or parts.query or parts.fragment
    ):
        raise PlatformProviderError("must be an http(s) URL without credentials, query or fragment", field)


def _object(value: object, field: str, allowed: frozenset[str]) -> dict:
    """A JSON object whose keys are all known: an unknown key is a structural error, whatever level it is at."""
    if not isinstance(value, dict):
        raise PlatformProviderError("must be a JSON object", field)
    unknown = sorted(set(value) - allowed, key=str)
    if unknown:
        raise PlatformProviderError("has an unknown field", f"{field}.{_safe(unknown[0])}" if field else _safe(unknown[0]))
    return value


def _entries(value: object, field: str, allowed: frozenset[str]) -> dict[str, dict]:
    """The entries of ``providers`` or ``models``: ids by the shared name rule, each a JSON object of known fields."""
    if not isinstance(value, dict) or not value:
        raise PlatformProviderError("must be a JSON object with at least one entry", field)
    if any(not isinstance(name, str) or not re.fullmatch(PROVIDER_NAME, name) for name in value):
        raise PlatformProviderError("has an id that is not 1 to 32 characters of a-z, 0-9, _ or -, starting with a letter", field)
    return {name: _object(entry, f"{field}.{name}", allowed) for name, entry in value.items()}


def _provider_entry(data: dict, field: str) -> PlatformProvider:
    """A provider entry under the rules the tenant keys follow too (spec §6.8); a problem names the field, never a value."""
    provider = _text(data.get("provider"), f"{field}.provider", required=True)
    if provider not in REGISTRY or not re.fullmatch(PROVIDER_NAME, provider):
        raise PlatformProviderError(f"must be one of {', '.join(REGISTRY)}", f"{field}.provider")
    spec = REGISTRY[provider]
    api_key = _text(data.get("api_key"), f"{field}.api_key", required=False)
    if spec.needs_api_key and not api_key:
        raise PlatformProviderError("is required for this provider", f"{field}.api_key")
    base_url = _text(data.get("base_url"), f"{field}.base_url", required=spec.needs_base_url)
    if base_url is not None:
        _endpoint(base_url, f"{field}.base_url")
    stream_usage = data.get("stream_usage")
    if stream_usage is not None and not isinstance(stream_usage, bool):
        raise PlatformProviderError("must be true or false", f"{field}.stream_usage")
    return PlatformProvider(provider, base_url if spec.takes_base_url else None, api_key, stream_usage)


def _price(data: dict, name: str, field: str) -> int | None:
    value = data.get(name)
    if value is None:
        return None
    try:
        return price_units(value)
    except ValueError as error:
        raise PlatformProviderError(str(error), f"{field}.{name}") from None


def _model_entry(data: dict, field: str, providers: Mapping[str, PlatformProvider], unusable: Mapping[str, str]) -> PlatformModelEntry:
    provider_id = _text(data.get("provider"), f"{field}.provider", required=True)
    if provider_id in unusable:
        raise PlatformProviderError(f"its provider is unusable ({unusable[provider_id]})", f"{field}.provider")
    if provider_id not in providers:
        raise PlatformProviderError("is not a provider of the file", f"{field}.provider")
    model = _text(data.get("model"), f"{field}.model", required=True)
    if not re.fullmatch(MODEL_NAME, model):
        raise PlatformProviderError("must be 1 to 128 characters without control characters", f"{field}.model")
    return PlatformModelEntry(
        provider_id, model, _price(data, "input_price", field), _price(data, "cached_input_price", field), _price(data, "output_price", field),
    )


def _routes(value: object) -> dict[str, dict[str, str]]:
    """The route table: ``default`` and, per quality level, an optional model id per capability. Structure only; ids are resolved later."""
    routes = _object(value, "routes", frozenset({DEFAULT_ROUTE, *QUALITIES}))
    parsed: dict[str, dict[str, str]] = {}
    for key, entry in routes.items():
        if key == DEFAULT_ROUTE:
            continue
        cell = _object(entry, f"routes.{key}", frozenset(CAPABILITIES))
        for capability, target in cell.items():
            if not isinstance(target, str) or not re.fullmatch(PROVIDER_NAME, target):
                raise PlatformProviderError("must be a model id", f"routes.{key}.{capability}")
        parsed[key] = dict(cell)
    return parsed


def parse_platform_config(raw: bytes) -> PlatformConfig:
    """The platform configuration a file's bytes describe: whole-file problems raise, entry problems drop that entry."""
    try:
        data = json.loads(raw)
    except ValueError:
        raise PlatformProviderError("is not JSON") from None
    data = _object(data, "", FIELDS)
    revision = data.get("revision")
    if isinstance(revision, bool) or not isinstance(revision, int) or revision < 1:
        raise PlatformProviderError("must be an integer from 1", "revision")
    margin = data.get("margin_bps")
    if isinstance(margin, bool) or not isinstance(margin, int) or not 0 <= margin <= MAX_MARGIN_BPS:
        raise PlatformProviderError(f"must be an integer from 0 to {MAX_MARGIN_BPS}", "margin_bps")
    provider_entries = _entries(data.get("providers"), "providers", PROVIDER_FIELDS)
    model_entries = _entries(data.get("models"), "models", MODEL_FIELDS)
    routes = _routes(data.get("routes"))
    default = _text((data.get("routes") or {}).get(DEFAULT_ROUTE), f"routes.{DEFAULT_ROUTE}", required=True)
    if not re.fullmatch(PROVIDER_NAME, default):
        raise PlatformProviderError("must be a model id", f"routes.{DEFAULT_ROUTE}")

    providers: dict[str, PlatformProvider] = {}
    unusable: dict[str, str] = {}
    for name, entry in provider_entries.items():
        try:
            providers[name] = _provider_entry(entry, f"providers.{name}")
        except PlatformProviderError as error:
            unusable[name] = error.reason
    models: dict[str, PlatformModelEntry] = {}
    dropped: dict[str, str] = {}
    for name, entry in model_entries.items():
        try:
            models[name] = _model_entry(entry, f"models.{name}", providers, unusable)
        except PlatformProviderError as error:
            dropped[name] = error.reason
    if default not in models:
        why = dropped.get(default, "is not a model of the file")
        raise PlatformProviderError(f"the default model {default} is unusable: {why}", f"routes.{DEFAULT_ROUTE}")
    return PlatformConfig(revision, margin, providers, models, routes, default, dropped)


def _read(path: str) -> bytes:
    with Path(path).open("rb") as file:
        raw = file.read(MAX_FILE_BYTES + 1)
    if len(raw) > MAX_FILE_BYTES:
        raise PlatformProviderError("is too large")
    return raw


@dataclass(frozen=True)
class PlatformActive:
    """The configuration in force: the models a run uses at each quality level, and what the proxy and the log redaction need."""

    revision: int
    quality: Mapping[str, RunModels]  # every quality level of ``QUALITIES``
    hosts: tuple[str, ...]  # the public hosts of every configured provider, for ai-egress
    keys: frozenset[str]  # every provider key in the file, for redaction

    @property
    def default(self) -> ModelIdentity:
        """The identity of the model the balanced level falls back to: what the tenant's settings page names as the platform model."""
        return self.quality[FALLBACK_QUALITY].default.identity


def _targets(config: PlatformConfig) -> set[str]:
    """Every model id some route points at."""
    return {config.default, *(target for cell in config.routes.values() for target in cell.values())}


def _build_models(settings: Settings, config: PlatformConfig) -> tuple[dict[str, BaseChatModel], dict[str, str]]:
    """The SDK model of every routed model that is usable, and the reason for each that is not (``config.dropped`` included)."""
    built: dict[str, BaseChatModel] = {}
    dropped = dict(config.dropped)
    for name in sorted(_targets(config) & config.models.keys()):
        entry = config.models[name]
        try:
            built[name] = build_platform_model(settings, config.providers[entry.provider_id], entry.model)
        except Exception as error:  # noqa: BLE001 - an SDK refusing the values drops this model, never the others
            dropped[name] = f"could not be built: {type(error).__name__}"
    return built, dropped


def _run_models(config: PlatformConfig, built: Mapping[str, BaseChatModel], quality: str) -> RunModels:
    def pick(capability: str) -> str:
        for level in (quality, FALLBACK_QUALITY):
            target = config.routes.get(level, {}).get(capability)
            if target in built:
                return target
        return config.default

    def run_model(name: str, capability: Capability) -> RunModel:
        entry = config.models[name]
        provider = config.providers[entry.provider_id]
        identity = ModelIdentity(
            provider.provider, entry.model, "platform", capability, entry.input_units, entry.output_units, config.margin_bps,
            entry.cached_input_units,
        )
        return RunModel(built[name], identity)

    return RunModels(run_model(config.default, "standard"), {capability: run_model(pick(capability), capability) for capability in CAPABILITIES})


def build_active(settings: Settings, config: PlatformConfig) -> PlatformActive:
    """The models of a parsed configuration; a model the SDK refuses is dropped like an invalid one, an unusable default rejects the file."""
    built, dropped = _build_models(settings, config)
    if config.default not in built:
        raise PlatformProviderError(f"the default model {config.default} is unusable: {dropped[config.default]}", f"routes.{DEFAULT_ROUTE}")
    for name, reason in sorted(dropped.items()):
        log.warning("platform model %s dropped: %s; its routes fall back", name, reason)
    for level, cell in sorted(config.routes.items()):
        for capability, target in sorted(cell.items()):
            if target not in built:
                log.warning("platform route %s.%s points at an unusable model; it falls back", level, capability)
    hosts = platform_hosts((provider.provider, provider.base_url) for provider in config.providers.values())
    keys = frozenset(provider.api_key for provider in config.providers.values() if provider.api_key)
    return PlatformActive(config.revision, {quality: _run_models(config, built, quality) for quality in QUALITIES}, hosts, keys)


class PlatformModel:
    """The models runs use when the tenant is on the platform provider; ``current`` is replaced whole, never edited."""

    def __init__(self, active: PlatformActive, *, digest: str | None = None) -> None:
        self.current = active
        self.digest = digest
        self._keys: set[str] = set(active.keys)  # every key since start: a late log line is still redacted

    @property
    def secrets(self) -> tuple[str, ...]:
        return tuple(self._keys)

    def replace(self, active: PlatformActive, digest: str) -> None:
        self._keys |= active.keys
        self.current = active
        self.digest = digest


def open_platform_model(settings: Settings) -> PlatformModel:
    """The platform model from the file at start; a missing or invalid file stops the boot, naming the problem."""
    try:
        raw = _read(settings.platform_provider_file)
    except OSError:
        raise PlatformProviderError(UNREADABLE, hint=MISSING_FILE_HINT) from None
    return PlatformModel(build_active(settings, parse_platform_config(raw)), digest=hashlib.sha256(raw).hexdigest())


async def watch_platform_provider(
    platform: PlatformModel, settings: Settings, on_change: Callable[[PlatformActive], Awaitable[None]], interval: float = POLL_SECONDS,
) -> None:
    """Rebuild the platform models whenever the file's content changes, forever; cancelled at shutdown.

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
            active = build_active(settings, parse_platform_config(raw))
        except PlatformProviderError as error:
            log.warning("platform provider file rejected (%s); the last valid configuration stays", error.reason)
            continue
        except Exception as error:  # noqa: BLE001 - an unexpected failure must not stop the watch
            log.warning("platform provider file rejected (could not be built: %s); the last valid configuration stays", type(error).__name__)
            continue
        platform.replace(active, digest)
        log.info("platform provider reloaded: revision %d, %s", active.revision, active.default.model)
        try:
            await on_change(active)
        except Exception as error:  # noqa: BLE001 - the model is already replaced; a failed side effect is logged
            log.warning("platform provider change not fully applied: %s", type(error).__name__)
