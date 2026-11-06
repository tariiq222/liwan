"""The platform provider file the tests point ``AI_PLATFORM_PROVIDER_FILE`` at."""
from __future__ import annotations

import json
import tempfile
from pathlib import Path

from liwan_ai_service.settings import PLATFORM_PROVIDER_FILE

_DIRECTORY = Path(tempfile.mkdtemp(prefix="ai-platform-provider-"))


def write_platform_file(path: Path, provider: str = "ollama", model: str = "m", *, revision: int = 1, **fields: object) -> Path:
    """Write a platform provider file; a field set to None is left out."""
    body = {"provider": provider, "model": model, "revision": revision, **fields}
    path.write_text(json.dumps({name: value for name, value in body.items() if value is not None}), encoding="utf-8")
    return path


def platform_env(provider: str = "ollama", model: str = "m", **fields: object) -> dict[str, str]:
    """The environment entry naming a platform provider file with these fields (one file per distinct content)."""
    name = json.dumps([provider, model, sorted(fields.items(), key=lambda item: item[0])], default=str)
    path = _DIRECTORY / f"{abs(hash(name))}.json"
    return {PLATFORM_PROVIDER_FILE: str(write_platform_file(path, provider, model, **fields))}
