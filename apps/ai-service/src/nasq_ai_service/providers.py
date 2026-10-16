"""One place that knows provider SDKs (through the registry). Everything else sees a BaseChatModel."""
from __future__ import annotations

from langchain_core.language_models import BaseChatModel

from nasq_ai_service.provider_registry import REGISTRY
from nasq_ai_service.settings import Settings


def build_chat_model(settings: Settings) -> BaseChatModel:
    spec = REGISTRY[settings.provider]
    return spec.build(settings, settings.base_url or spec.default_base_url)
