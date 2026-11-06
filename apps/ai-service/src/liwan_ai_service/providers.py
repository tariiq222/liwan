"""One place that knows provider SDKs (through the registry). Everything else sees a BaseChatModel."""
from __future__ import annotations

from dataclasses import replace

from langchain_core.language_models import BaseChatModel

from liwan_ai_service.provider_registry import REGISTRY
from liwan_ai_service.settings import Settings


def build_chat_model(settings: Settings) -> BaseChatModel:
    spec = REGISTRY[settings.provider]
    return spec.build(settings, settings.base_url or spec.default_base_url)


def build_tenant_model(settings: Settings, provider: str, model: str, api_key: str, base_url: str | None = None) -> BaseChatModel:
    """A model on the tenant's own key. ``AI_BASE_URL`` is the deployment's endpoint, so a tenant key uses the provider's own,
    except the generic provider, whose endpoint is the tenant's ``base_url``."""
    spec = REGISTRY[provider]
    endpoint = base_url if spec.needs_base_url else spec.default_base_url
    return spec.build(replace(settings, provider=provider, model=model, api_key=api_key, base_url=None), endpoint)
