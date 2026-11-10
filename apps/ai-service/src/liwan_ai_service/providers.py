"""One place that knows provider SDKs (through the registry). Everything else sees a BaseChatModel."""
from __future__ import annotations

from typing import TYPE_CHECKING

from langchain_core.language_models import BaseChatModel

from liwan_ai_service.provider_registry import REGISTRY
from liwan_ai_service.settings import Settings

if TYPE_CHECKING:
    from liwan_ai_service.platform_provider import PlatformProvider


def build_platform_model(settings: Settings, platform: PlatformProvider, model: str) -> BaseChatModel:
    """A model on one of the platform's providers: its own endpoint and token-count choice from the file, else the provider's defaults."""
    spec = REGISTRY[platform.provider]
    return spec.build(settings, model, platform.api_key, platform.base_url or spec.default_base_url, platform.stream_usage)


def build_tenant_model(settings: Settings, provider: str, model: str, api_key: str, base_url: str | None = None) -> BaseChatModel:
    """A model on the tenant's own key. A tenant key uses the provider's own endpoint, except the generic provider,
    whose endpoint is the tenant's ``base_url``."""
    spec = REGISTRY[provider]
    return spec.build(settings, model, api_key, base_url if spec.needs_base_url else spec.default_base_url, None)
