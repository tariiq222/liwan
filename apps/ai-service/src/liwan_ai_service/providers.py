"""One place that knows provider SDKs (through the registry). Everything else sees a BaseChatModel."""
from __future__ import annotations

from dataclasses import replace

from langchain_core.language_models import BaseChatModel

from liwan_ai_service.provider_registry import REGISTRY
from liwan_ai_service.settings import Settings


def build_chat_model(settings: Settings) -> BaseChatModel:
    spec = REGISTRY[settings.provider]
    return spec.build(settings, settings.base_url or spec.default_base_url)


def build_tenant_model(settings: Settings, provider: str, model: str, api_key: str) -> BaseChatModel:
    """A model on the tenant's own key. ``AI_BASE_URL`` is the deployment's endpoint, so a tenant key always uses the provider's own."""
    spec = REGISTRY[provider]
    return spec.build(replace(settings, provider=provider, model=model, api_key=api_key, base_url=None), spec.default_base_url)
