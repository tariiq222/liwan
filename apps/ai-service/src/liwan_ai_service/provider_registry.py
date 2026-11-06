"""The provider registry: the one list of supported providers, read by the platform file and tenant keys (names, key rule) and providers (build).

Adding a provider is one dependency line in pyproject.toml, one ``ProviderSpec`` below with its build function, one test and
one README row. ``openai_compatible`` is the one generic provider: any OpenAI-compatible endpoint, named by a base URL.
SDK imports stay inside each build function so importing the registry stays light and cycle-free.
"""
from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from typing import TYPE_CHECKING

from langchain_core.language_models import BaseChatModel

if TYPE_CHECKING:
    from liwan_ai_service.settings import Settings

ANTHROPIC_HOST = "api.anthropic.com"
OPENAI_HOST = "api.openai.com"
OPENROUTER_HOST = "openrouter.ai"
OPENROUTER_BASE_URL = f"https://{OPENROUTER_HOST}/api/v1"
OLLAMA_BASE_URL = "http://localhost:11434"


@dataclass(frozen=True)
class ProviderSpec:
    name: str
    needs_api_key: bool
    default_base_url: str | None
    # (settings, model, api key, base url resolved by the caller, stream_usage: ask the stream for token counts; None: the provider's rule)
    build: Callable[[Settings, str, str | None, str | None, bool | None], BaseChatModel]
    host: str | None = None  # the public host of the provider's own endpoint, which a key on it reaches through ai-egress
    needs_base_url: bool = False  # the endpoint is always given (the platform file, or a tenant's base URL), never defaulted
    takes_base_url: bool = True  # False: the provider always uses its own endpoint and a given base URL is ignored


def _anthropic(settings: Settings, model: str, api_key: str | None, base_url: str | None, stream_usage: bool | None) -> BaseChatModel:
    from langchain_anthropic import ChatAnthropic

    return ChatAnthropic(model=model, api_key=api_key, temperature=0, max_tokens=2048, max_retries=0)


def _openai(settings: Settings, model: str, api_key: str | None, base_url: str | None, stream_usage: bool | None) -> BaseChatModel:
    from langchain_openai import ChatOpenAI

    # The usage chunk needs `stream_options`, which only the official endpoint is known to accept: unless the platform file
    # says the endpoint reports usage (stream_usage), a custom base URL (an OpenAI-compatible server that may answer 400 to
    # it) is called without it and its calls are reported without token counts.
    return ChatOpenAI(
        model=model, api_key=api_key, base_url=base_url, temperature=0, max_retries=0,
        stream_usage=base_url is None if stream_usage is None else stream_usage,
    )


def _ollama(settings: Settings, model: str, api_key: str | None, base_url: str | None, stream_usage: bool | None) -> BaseChatModel:
    from langchain_ollama import ChatOllama

    return ChatOllama(model=model, base_url=base_url, temperature=0)


def _openrouter(settings: Settings, model: str, api_key: str | None, base_url: str | None, stream_usage: bool | None) -> BaseChatModel:
    from langchain_openai import ChatOpenAI

    attribution = {"HTTP-Referer": settings.openrouter_referer, "X-Title": settings.openrouter_title}
    headers = {name: value for name, value in attribution.items() if value}
    return ChatOpenAI(
        model=model, api_key=api_key, base_url=base_url, default_headers=headers or None,
        temperature=0, max_retries=0, stream_usage=True if stream_usage is None else stream_usage,
    )


_SPECS = (
    ProviderSpec("anthropic", needs_api_key=True, default_base_url=None, build=_anthropic, host=ANTHROPIC_HOST, takes_base_url=False),
    ProviderSpec("openai", needs_api_key=True, default_base_url=None, build=_openai, host=OPENAI_HOST),
    ProviderSpec("ollama", needs_api_key=False, default_base_url=OLLAMA_BASE_URL, build=_ollama),
    ProviderSpec("openrouter", needs_api_key=True, default_base_url=OPENROUTER_BASE_URL, build=_openrouter, host=OPENROUTER_HOST),
    ProviderSpec("openai_compatible", needs_api_key=True, default_base_url=None, build=_openai, needs_base_url=True),
)
REGISTRY: dict[str, ProviderSpec] = {spec.name: spec for spec in _SPECS}
