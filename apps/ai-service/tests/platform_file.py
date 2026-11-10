"""The platform provider file the tests point ``AI_PLATFORM_PROVIDER_FILE`` at."""
from __future__ import annotations

import json
import tempfile
from pathlib import Path

from liwan_ai_service.settings import PLATFORM_PROVIDER_FILE

_DIRECTORY = Path(tempfile.mkdtemp(prefix="ai-platform-provider-"))


def platform_body(provider: str = "ollama", model: str = "m", *, revision: int = 1, margin_bps: int = 0, **fields: object) -> dict:
    """The smallest valid file: one provider ``main`` with these fields (a field set to None is left out), one model ``main``, and the default route."""
    prices = {name: fields.pop(name) for name in ("input_price", "cached_input_price", "output_price") if name in fields}
    return {
        "revision": revision, "margin_bps": margin_bps,
        "providers": {"main": {"provider": provider, **{name: value for name, value in fields.items() if value is not None}}},
        "models": {"main": {"provider": "main", "model": model, **prices}},
        "routes": {"default": "main"},
    }


def write_platform_file(path: Path, provider: str = "ollama", model: str = "m", **fields: object) -> Path:
    """Write a single-provider platform file (see ``platform_body``)."""
    return write_platform_json(path, platform_body(provider, model, **fields))


def write_platform_json(path: Path, body: dict) -> Path:
    path.write_text(json.dumps(body), encoding="utf-8")
    return path


def platform_env(provider: str = "ollama", model: str = "m", **fields: object) -> dict[str, str]:
    """The environment entry naming a platform provider file with these fields (one file per distinct content)."""
    name = json.dumps([provider, model, sorted(fields.items(), key=lambda item: item[0])], default=str)
    path = _DIRECTORY / f"{abs(hash(name))}.json"
    return {PLATFORM_PROVIDER_FILE: str(write_platform_file(path, provider, model, **fields))}
