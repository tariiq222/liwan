#!/usr/bin/env python3
"""Writes the AI service's platform provider file from the operator variables in deploy/.env (specs 2026-11-04 §6.13, 2026-11-10 §5.8).

    python3 ai/platform_provider.py .env data/ai/platform-provider.json      (provision.sh runs this from deploy/)

The AI service reads its platform provider only from this file (``AI_PLATFORM_PROVIDER_FILE``): ``AI_PROVIDER``, ``AI_MODEL``,
``AI_API_KEY``, ``AI_BASE_URL`` and the optional ``AI_STREAM_USAGE``, ``AI_PRICE_INPUT``, ``AI_PRICE_OUTPUT`` (USD per million tokens) and
``AI_MARGIN_BPS`` of ``.env`` are the operator's input here and never reach the container's environment. They describe one provider, one
model and the default route: a single-model install, where every capability and quality level uses that model.
The file is mode 600 and owned by the ai user (uid 10001), so only that user reads the key: this must run as root (or as that user); otherwise it exits non-zero without writing and says so, unless LIWAN_AI_PLATFORM_FILE_UNOWNED=1 accepts an unowned file (Docker Desktop ignores bind-mount ownership). ``.env`` is read like Docker Compose reads it: the last assignment of a name wins and a trailing ` # comment` is not part of the value. It is replaced
atomically; an unchanged configuration leaves it byte for byte as it is, and a changed one raises ``revision`` by one. No
value is ever printed. The service validates the file again at start and on every change (``platform_provider.py``).
"""
from __future__ import annotations

import json
import os
import re
import sys
import tempfile
from decimal import Decimal
from pathlib import Path

AI_UID = 10001  # apps/ai-service/Dockerfile
PROVIDERS = ("anthropic", "openai", "ollama", "openrouter", "openai_compatible")
KEYLESS = ("ollama",)
ASKS_FOR_USAGE = ("openai", "openai_compatible", "openrouter")  # the providers whose stream must be asked for token counts
OWN_ENDPOINT = ("anthropic",)  # the provider always uses its own endpoint, whatever base URL .env carries
ID = "main"  # the id of the one provider and the one model of the file
UNITS_PER_USD = 100_000  # one cost unit is 0.00001 USD (apps/ai-service usage.py price_units)
MAX_UNITS = 2_147_483_647
MAX_MARGIN_BPS = 10_000


class ProviderConfigError(ValueError):
    """The operator variables cannot name a platform provider, or the file cannot be given to the ai user; the message names a variable or a path, never a value."""


def _value_of(raw: str) -> str:
    """The value of one ``NAME=value`` line as Docker Compose reads it: a quoted value ends at its closing quote (a comment may follow), an unquoted one at a `` #``."""
    raw = raw.strip()
    if raw[:1] in ("'", '"'):
        quote = raw[0]
        end = 1
        while end < len(raw) and raw[end] != quote:
            end += 2 if quote == '"' and raw[end] == "\\" else 1
        if end < len(raw):
            body = raw[1:end]
            return body.replace('\\"', '"').replace("\\\\", "\\") if quote == '"' else body
    return re.split(r"\s+#", raw, maxsplit=1)[0].strip()


def read_env(path: Path) -> dict[str, str]:
    """``NAME=value`` lines of a .env file, read like Docker Compose does: the LAST assignment of a name wins, an optional ``export `` is ignored, comments and blank lines are skipped."""
    values: dict[str, str] = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        name, separator, value = line.strip().removeprefix("export ").partition("=")
        name = name.strip()
        if separator and name and not name.startswith("#"):
            values[name] = _value_of(value)
    return values


def price_of(env: dict[str, str], name: str) -> str | None:
    """A price variable as the file carries it (USD per million tokens), or None when unset; the service converts it to exact cost units and refuses what is not exact."""
    value = env.get(name, "")
    if not value:
        return None
    try:
        units = Decimal(value) * UNITS_PER_USD
    except ArithmeticError:
        units = None
    if units is None or not re.fullmatch(r"[0-9]{1,9}(\.[0-9]{1,9})?", value) or units != units.to_integral_value() or units > MAX_UNITS:
        raise ProviderConfigError(f"{name} must be a plain decimal of USD per million tokens with at most five decimal places")
    return value


def margin_of(env: dict[str, str]) -> int:
    """AI_MARGIN_BPS (the vendor margin in basis points; 0 when unset), or ProviderConfigError."""
    value = env.get("AI_MARGIN_BPS", "")
    if not value:
        return 0
    if not re.fullmatch(r"[0-9]{1,5}", value) or int(value) > MAX_MARGIN_BPS:
        raise ProviderConfigError(f"AI_MARGIN_BPS must be a whole number from 0 to {MAX_MARGIN_BPS}")
    return int(value)


def provider_fields(env: dict[str, str]) -> dict[str, dict]:
    """The file's content without its revision: one provider, one priced model and the default route, or ProviderConfigError."""
    provider = env.get("AI_PROVIDER") or "ollama"
    if provider not in PROVIDERS:
        raise ProviderConfigError(f"AI_PROVIDER must be one of {', '.join(PROVIDERS)}")
    model = env.get("AI_MODEL", "")
    if not model:
        raise ProviderConfigError("AI_MODEL is required")
    api_key = env.get("AI_API_KEY", "")
    if not api_key and provider not in KEYLESS:
        raise ProviderConfigError(f"AI_API_KEY is required for provider {provider}")
    base_url = env.get("AI_BASE_URL", "")
    if provider == "openai_compatible" and not base_url:
        raise ProviderConfigError("AI_BASE_URL is required for provider openai_compatible")
    fields: dict[str, str | bool] = {"provider": provider}
    usage = env.get("AI_STREAM_USAGE", "").lower()
    if usage not in ("", "true", "false"):
        raise ProviderConfigError("AI_STREAM_USAGE must be true or false")
    if usage and provider in ASKS_FOR_USAGE:  # absent: the service's own rule, which does not ask a custom endpoint
        fields["stream_usage"] = usage == "true"
    if api_key:
        fields["api_key"] = api_key
    if base_url and provider not in OWN_ENDPOINT:
        fields["base_url"] = base_url
    prices = {"input_price": price_of(env, "AI_PRICE_INPUT"), "output_price": price_of(env, "AI_PRICE_OUTPUT")}
    entry = {"provider": ID, "model": model, **{name: price for name, price in prices.items() if price is not None}}
    return {"margin_bps": margin_of(env), "providers": {ID: fields}, "models": {ID: entry}, "routes": {"default": ID}}


def current_revision(target: Path, fields: dict[str, dict]) -> tuple[int, bool]:
    """(revision to write, whether the file already holds exactly these fields)."""
    try:
        existing = json.loads(target.read_text(encoding="utf-8"))
        revision = existing.pop("revision")
        if isinstance(revision, int) and not isinstance(revision, bool) and revision >= 1:
            return (revision, True) if existing == fields else (revision + 1, False)
    except (OSError, ValueError, KeyError, AttributeError):
        pass
    return 1, False


UNOWNED_VARIABLE = "LIWAN_AI_PLATFORM_FILE_UNOWNED"


def readable_by_service() -> bool:
    """Whether a mode-600 file this process writes can be read by the ai user (uid 10001): only when this process runs as root (it chowns) or as that user."""
    return os.geteuid() in (0, AI_UID) or os.environ.get(UNOWNED_VARIABLE) == "1"


def give_to_service(path: Path) -> None:
    """Make the ai user the owner of ``path`` (root only); a failure is an error unless the operator accepts an unowned file (Docker Desktop ignores ownership of bind mounts)."""
    if os.environ.get(UNOWNED_VARIABLE) == "1":
        if os.geteuid() == 0:
            try:
                os.chown(path, AI_UID, AI_UID)
            except OSError:
                pass  # accepted by the operator
        return
    if os.geteuid() == 0:
        try:
            if path.stat().st_uid != AI_UID:
                os.chown(path, AI_UID, AI_UID)
        except OSError as error:
            raise ProviderConfigError(f"cannot give {path} to uid {AI_UID} ({type(error).__name__}); the ai service could not read it") from None
    elif path.stat().st_uid != AI_UID:
        raise ProviderConfigError(f"{path} is not owned by uid {AI_UID} and this process cannot chown: run provisioning as root (sudo), or set {UNOWNED_VARIABLE}=1 where bind-mount ownership is ignored (Docker Desktop)")


def write_provider_file(env_file: Path, target: Path) -> int:
    """Write ``target`` for the variables of ``env_file`` unless it already holds them; returns its revision."""
    fields = provider_fields(read_env(env_file))
    if not readable_by_service():  # decided before anything is written: a file the service cannot read must not look like success
        raise ProviderConfigError(f"this process (uid {os.geteuid()}) cannot make {target} readable by uid {AI_UID}: run provisioning as root (sudo), or set {UNOWNED_VARIABLE}=1 where bind-mount ownership is ignored (Docker Desktop)")
    revision, unchanged = current_revision(target, fields)
    if unchanged and (target.stat().st_mode & 0o777) == 0o600:
        give_to_service(target)
        return revision
    target.parent.mkdir(parents=True, exist_ok=True)
    handle, staged = tempfile.mkstemp(dir=target.parent, prefix=".platform-provider.", suffix=".tmp")  # created mode 600
    try:
        with os.fdopen(handle, "w", encoding="utf-8") as file:
            json.dump({**fields, "revision": revision}, file)
            file.write("\n")
        give_to_service(Path(staged))
        os.replace(staged, target)
    except BaseException:
        Path(staged).unlink(missing_ok=True)
        raise
    return revision


def main(argv: list[str]) -> int:
    if len(argv) != 3:
        print("usage: platform_provider.py <path to .env> <path of the platform provider file>", file=sys.stderr)
        return 2
    target = Path(argv[2])
    try:
        revision = write_provider_file(Path(argv[1]), target)
    except (ProviderConfigError, OSError) as error:
        print(f"platform_provider: {error if isinstance(error, ProviderConfigError) else type(error).__name__}", file=sys.stderr)
        return 1
    print(f"platform_provider: {target} revision {revision}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
