"""The provider registry: the one list of supported providers, read by settings (valid names, key rule) and providers (build).

Adding a provider is one dependency line in pyproject.toml, one ``ProviderSpec`` below with its build function, one test and
one README row. SDK imports stay inside each build function so importing the registry stays light and cycle-free.
"""
from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from typing import TYPE_CHECKING

from langchain_core.language_models import BaseChatModel

if TYPE_CHECKING:
    from webvue_ai_service.settings import Settings

OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1"
OLLAMA_BASE_URL = "http://localhost:11434"


@dataclass(frozen=True)
class ProviderSpec:
    name: str
    needs_api_key: bool
    default_base_url: str | None
    build: Callable[[Settings, str | None], BaseChatModel]  # (settings, base_url resolved from AI_BASE_URL or the default)


def _anthropic(settings: Settings, base_url: str | None) -> BaseChatModel:
    from langchain_anthropic import ChatAnthropic

    return ChatAnthropic(model=settings.model, api_key=settings.api_key, temperature=0, max_tokens=2048)


def _openai(settings: Settings, base_url: str | None) -> BaseChatModel:
    from langchain_openai import ChatOpenAI

    return ChatOpenAI(model=settings.model, api_key=settings.api_key, base_url=base_url, temperature=0)


def _ollama(settings: Settings, base_url: str | None) -> BaseChatModel:
    from langchain_ollama import ChatOllama

    return ChatOllama(model=settings.model, base_url=base_url, temperature=0)


def _openrouter(settings: Settings, base_url: str | None) -> BaseChatModel:
    from langchain_openai import ChatOpenAI

    attribution = {"HTTP-Referer": settings.openrouter_referer, "X-Title": settings.openrouter_title}
    headers = {name: value for name, value in attribution.items() if value}
    return ChatOpenAI(model=settings.model, api_key=settings.api_key, base_url=base_url, default_headers=headers or None, temperature=0)


_SPECS = (
    ProviderSpec("anthropic", needs_api_key=True, default_base_url=None, build=_anthropic),
    ProviderSpec("openai", needs_api_key=True, default_base_url=None, build=_openai),
    ProviderSpec("ollama", needs_api_key=False, default_base_url=OLLAMA_BASE_URL, build=_ollama),
    ProviderSpec("openrouter", needs_api_key=True, default_base_url=OPENROUTER_BASE_URL, build=_openrouter),
)
REGISTRY: dict[str, ProviderSpec] = {spec.name: spec for spec in _SPECS}
