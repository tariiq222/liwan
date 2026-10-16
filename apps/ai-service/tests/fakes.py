"""A scripted chat model: the tests decide what the model answers, turn by turn."""
from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator, Iterator, Sequence
from typing import Any

from langchain_core.callbacks import AsyncCallbackManagerForLLMRun, CallbackManagerForLLMRun
from langchain_core.language_models import BaseChatModel
from langchain_core.messages import AIMessage, AIMessageChunk, BaseMessage, SystemMessage
from langchain_core.outputs import ChatGeneration, ChatGenerationChunk, ChatResult

from webvue_ai_service.titles import TITLE_RULES


def ai_text(text: str) -> AIMessage:
    return AIMessage(content=text)


def ai_blocks(*texts: str) -> AIMessage:
    return AIMessage(content=[{"type": "text", "text": text} for text in texts])


def ai_tool_call(name: str, args: dict[str, Any], call_id: str) -> AIMessage:
    return AIMessage(content="", tool_calls=[{"name": name, "args": args, "id": call_id, "type": "tool_call"}])


def is_title_request(messages: list[BaseMessage]) -> bool:
    return bool(messages) and isinstance(messages[0], SystemMessage) and messages[0].content == TITLE_RULES


class ScriptedChatModel(BaseChatModel):
    """The tests script the run's turns in ``responses``; the title requests are answered apart from ``title_responses`` (none: the call fails)."""

    responses: list[AIMessage]
    title_responses: list[AIMessage] = []
    bound_tools: list[Any] = []
    calls: list[list[BaseMessage]] = []
    title_calls: list[list[BaseMessage]] = []

    def __init__(self, responses: list[AIMessage], **kwargs: Any) -> None:
        super().__init__(responses=responses, **kwargs)

    @property
    def _llm_type(self) -> str:
        return "scripted"

    def bind_tools(self, tools: Sequence[Any], **kwargs: Any) -> ScriptedChatModel:  # type: ignore[override]
        self.bound_tools = list(tools)
        return self

    def _next(self, messages: list[BaseMessage]) -> AIMessage:
        title = is_title_request(messages)
        (self.title_calls if title else self.calls).append(list(messages))
        script = self.title_responses if title else self.responses
        if not script:
            msg = "title script exhausted" if title else "script exhausted"
            raise RuntimeError(msg)
        return script.pop(0)

    def _generate(self, messages: list[BaseMessage], stop: list[str] | None = None,
                  run_manager: CallbackManagerForLLMRun | None = None, **kwargs: Any) -> ChatResult:
        return ChatResult(generations=[ChatGeneration(message=self._next(messages))])

    async def _agenerate(self, messages: list[BaseMessage], stop: list[str] | None = None,
                         run_manager: AsyncCallbackManagerForLLMRun | None = None, **kwargs: Any) -> ChatResult:
        return self._generate(messages, stop, None, **kwargs)

    def _stream(self, messages: list[BaseMessage], stop: list[str] | None = None,
                run_manager: CallbackManagerForLLMRun | None = None, **kwargs: Any) -> Iterator[ChatGenerationChunk]:
        message = self._next(messages)
        if message.tool_calls:
            yield ChatGenerationChunk(message=AIMessageChunk(content=message.content, tool_calls=message.tool_calls))
            return
        if isinstance(message.content, list):  # block content, as langchain_anthropic sends it when tools are bound
            for block in message.content:
                yield ChatGenerationChunk(message=AIMessageChunk(content=[block]))
            return
        for char in str(message.content):
            yield ChatGenerationChunk(message=AIMessageChunk(content=char))

    async def _astream(self, messages: list[BaseMessage], stop: list[str] | None = None,
                       run_manager: AsyncCallbackManagerForLLMRun | None = None, **kwargs: Any) -> AsyncIterator[ChatGenerationChunk]:
        for chunk in self._stream(messages, stop, None, **kwargs):
            yield chunk


class SlowChatModel(ScriptedChatModel):
    """A model that never answers: ``started`` is set when a call begins, then it sleeps."""

    started: Any = None

    async def _astream(self, messages: list[BaseMessage], stop: list[str] | None = None,
                       run_manager: AsyncCallbackManagerForLLMRun | None = None, **kwargs: Any) -> AsyncIterator[ChatGenerationChunk]:
        if self.started is not None:
            self.started.set()
        await asyncio.sleep(60)
        yield ChatGenerationChunk(message=AIMessageChunk(content=""))


class FailingChatModel(ScriptedChatModel):
    """A model whose provider call raises ``error``."""

    error: Any = None

    def _next(self, messages: list[BaseMessage]) -> AIMessage:
        raise self.error


class SlowTitleChatModel(ScriptedChatModel):
    """Answers the run normally; the title request never comes back."""

    async def _astream(self, messages: list[BaseMessage], stop: list[str] | None = None,
                       run_manager: AsyncCallbackManagerForLLMRun | None = None, **kwargs: Any) -> AsyncIterator[ChatGenerationChunk]:
        if is_title_request(messages):
            await asyncio.sleep(60)
        async for chunk in super()._astream(messages, stop, None, **kwargs):
            yield chunk


class RenamingChatModel(ScriptedChatModel):
    """The user renames the conversation while its title is being written: ``on_title`` runs before the title reply."""

    on_title: Any = None

    async def _astream(self, messages: list[BaseMessage], stop: list[str] | None = None,
                       run_manager: AsyncCallbackManagerForLLMRun | None = None, **kwargs: Any) -> AsyncIterator[ChatGenerationChunk]:
        if is_title_request(messages):
            await self.on_title()
        async for chunk in super()._astream(messages, stop, None, **kwargs):
            yield chunk
