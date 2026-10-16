"""What a failure may show a client (a fixed message and the exception class) and what may reach the log (redacted)."""
from __future__ import annotations

import re

PROVIDER_MODULES = {"anthropic", "openai", "ollama", "httpx", "httpcore"}
PROVIDER_MESSAGE = "The AI provider is unavailable"
INTERNAL_MESSAGE = "The AI service hit an internal error"
URL = re.compile(r"\b[a-zA-Z][a-zA-Z0-9+.-]*://\S+")
KEY = re.compile(r"\b(?:sk|pk|key|token)-[A-Za-z0-9_-]+", re.IGNORECASE)


def is_provider_error(error: BaseException) -> bool:
    """Connection and provider SDK failures; the run timeout is told apart by the caller."""
    return isinstance(error, OSError) or any(cls.__module__.split(".")[0] in PROVIDER_MODULES for cls in type(error).__mro__)


def client_error(error: BaseException) -> dict[str, str]:
    """The ``error`` event payload: a fixed message plus the class name, never the exception text."""
    provider = is_provider_error(error)
    return {
        "code": "provider_unavailable" if provider else "internal",
        "message": f"{PROVIDER_MESSAGE}: {type(error).__name__}" if provider else f"{INTERNAL_MESSAGE}: {type(error).__name__}",
    }


def redact(text: str, secrets: tuple[str | None, ...] = ()) -> str:
    """``text`` without connection strings, key-looking tokens or any of the configured ``secrets``."""
    for secret in secrets:
        if secret:
            text = text.replace(secret, "[redacted]")
    return KEY.sub("[redacted]", URL.sub("[redacted-url]", text))
