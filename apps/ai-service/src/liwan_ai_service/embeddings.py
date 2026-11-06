"""The embedding endpoint of knowledge retrieval, built from the operator's environment (spec 2026-11-04 §6.3).

Embeddings are one deployment-wide choice, like the platform chat model: ``AI_EMBEDDING_PROVIDER`` is ``openai`` (any
OpenAI-compatible endpoint, through ``AI_EMBEDDING_BASE_URL``) or ``ollama``. Vectors are tagged with ``model_id`` when
indexed and searched only against the same tag, so changing the model never mixes two vector spaces.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol

from langchain_core.embeddings import Embeddings

from liwan_ai_service.provider_registry import OLLAMA_BASE_URL
from liwan_ai_service.settings import EmbeddingSettings


class Embedder(Protocol):
    model_id: str

    async def query(self, text: str) -> list[float]: ...
    async def documents(self, texts: list[str]) -> list[list[float]]: ...


@dataclass(frozen=True)
class LangchainEmbedder:
    model_id: str
    embeddings: Embeddings

    async def query(self, text: str) -> list[float]:
        return await self.embeddings.aembed_query(text)

    async def documents(self, texts: list[str]) -> list[list[float]]:
        return await self.embeddings.aembed_documents(texts)


def _openai(settings: EmbeddingSettings) -> Embeddings:
    from langchain_openai import OpenAIEmbeddings

    # Token-id batching (tiktoken) is an official-endpoint feature; an OpenAI-compatible server expects plain strings.
    return OpenAIEmbeddings(
        model=settings.model, api_key=settings.api_key, base_url=settings.base_url, check_embedding_ctx_length=settings.base_url is None,
    )


def _ollama(settings: EmbeddingSettings) -> Embeddings:
    from langchain_ollama import OllamaEmbeddings

    return OllamaEmbeddings(model=settings.model, base_url=settings.base_url or OLLAMA_BASE_URL)


_BUILDERS = {"openai": _openai, "ollama": _ollama}


def build_embedder(settings: EmbeddingSettings | None) -> Embedder | None:
    """The configured embedder, or None when the operator configured none: knowledge search is then unavailable."""
    if settings is None:
        return None
    return LangchainEmbedder(f"{settings.provider}:{settings.model}", _BUILDERS[settings.provider](settings))
