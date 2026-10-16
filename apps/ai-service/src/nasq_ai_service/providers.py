"""One place that knows provider SDKs. Everything else sees a BaseChatModel."""
from __future__ import annotations

from langchain_core.language_models import BaseChatModel

from nasq_ai_service.settings import Settings


def build_chat_model(settings: Settings) -> BaseChatModel:
    if settings.provider == "anthropic":
        from langchain_anthropic import ChatAnthropic

        return ChatAnthropic(model=settings.model, api_key=settings.api_key, temperature=0, max_tokens=2048)
    if settings.provider == "openai":
        from langchain_openai import ChatOpenAI

        return ChatOpenAI(model=settings.model, api_key=settings.api_key, base_url=settings.base_url, temperature=0)
    from langchain_ollama import ChatOllama

    return ChatOllama(model=settings.model, base_url=settings.base_url or "http://localhost:11434", temperature=0)
