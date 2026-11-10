"""A scripted chat model: the tests decide what the model answers, turn by turn."""
from __future__ import annotations

import asyncio
import json
import secrets
from collections.abc import AsyncIterator, Iterator, Sequence
from typing import Any

from langchain_core.callbacks import AsyncCallbackManagerForLLMRun, CallbackManagerForLLMRun
from langchain_core.language_models import BaseChatModel
from langchain_core.messages import AIMessage, AIMessageChunk, BaseMessage, SystemMessage
from langchain_core.outputs import ChatGeneration, ChatGenerationChunk, ChatResult

from liwan_ai_service.control import MemoryControlState
from liwan_ai_service.graph import RUN_MODELS_KEY, build_graph
from liwan_ai_service.platform_provider import QUALITIES, PlatformActive, PlatformModel
from liwan_ai_service.router import ROUTE_RULES
from liwan_ai_service.routing import RunModels
from liwan_ai_service.service import create_app
from liwan_ai_service.store import MemoryRunStore
from liwan_ai_service.summary import SUMMARY_RULES
from liwan_ai_service.tenancy import MemoryDirectory
from liwan_ai_service.tenant_state import TenantState, TenantStates
from liwan_ai_service.titles import TITLE_RULES
from liwan_ai_service.usage import ModelIdentity, RunModel

IDENTITY = ModelIdentity("ollama", "m", "platform")  # what the Settings of the service tests name
# The policy of a platform run of a tenant that signed the AI acknowledgement; without it no provider runs (§6.8).
PLATFORM_POLICY = {"provider_mode": "platform", "consent_signed": True, "max_output_tokens": None}


TEST_TENANT = "t1"  # the tenant the service tests' requests name; its database has the same name in memory mode


class SeededStates(TenantStates):
    """Memory tenant states in which the test's own store and checkpointer serve ``TEST_TENANT``'s database."""

    def __init__(self, *, store=None, checkpointer=None) -> None:
        super().__init__(MemoryDirectory(), None, build_graph)
        self.seed = (store, checkpointer)

    def _memory_state(self, database: str) -> TenantState:
        store, checkpointer = self.seed
        if database != TEST_TENANT or (store is None and checkpointer is None):
            return super()._memory_state(database)
        from langgraph.checkpoint.memory import InMemorySaver

        return TenantState(database, store or MemoryRunStore(), self.graph_factory(checkpointer or InMemorySaver()))


def platform_of(model, provider: str = "ollama", name: str = "m", api_key: str | None = None) -> PlatformModel:
    """The platform provider whose model is the test's own (no file behind it, so nothing is watched)."""
    run_models = RunModels(RunModel(model, ModelIdentity(provider, name, "platform")))
    return PlatformModel(PlatformActive(1, dict.fromkeys(QUALITIES, run_models), (), frozenset({api_key} if api_key else ())))


def make_memory_app(model, settings, *, store=None, checkpointer=None, control=None, states=None, embedder=None):
    """A service app over memory state: the test keeps the store, the states and the control state it drives."""
    states = states or SeededStates(store=store, checkpointer=checkpointer)
    return create_app(platform_of(model), states, control or MemoryControlState(), settings, embedder)


async def open_test_state(database_url: str):
    """A Postgres run store, checkpointer and control state in ``database_url`` (the test's own bootstrapped schema)."""
    from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver
    from psycopg_pool import AsyncConnectionPool

    from liwan_ai_service.control import open_control
    from liwan_ai_service.store import PostgresRunStore

    control = await open_control(database_url, initialize=True)
    pool = AsyncConnectionPool(database_url, min_size=1, max_size=5, kwargs={"autocommit": True, "prepare_threshold": 0}, open=False)
    await pool.open()

    async def aclose() -> None:
        await pool.close()
        await control.aclose()

    return PostgresRunStore(pool), AsyncPostgresSaver(pool), control, aclose


class BoundGraph:
    """A tenant graph driven directly by a test: every config it is given carries ``model`` as the request's only model, or ``run_models`` when given."""

    def __init__(self, model, checkpointer, identity: ModelIdentity = IDENTITY, run_models: RunModels | None = None) -> None:
        self.graph = build_graph(checkpointer)
        self.run_models = run_models or RunModels(RunModel(model, identity))

    def _config(self, config):
        return {**config, "configurable": {**config["configurable"], RUN_MODELS_KEY: self.run_models}}

    async def ainvoke(self, graph_input, config, **kwargs):
        return await self.graph.ainvoke(graph_input, self._config(config), **kwargs)

    def astream(self, graph_input, config, **kwargs):
        return self.graph.astream(graph_input, self._config(config), **kwargs)

    async def aget_state(self, config):
        return await self.graph.aget_state(config)

    async def aupdate_state(self, config, values, **kwargs):
        return await self.graph.aupdate_state(config, values, **kwargs)


def new_id() -> str:
    return "r_" + secrets.token_hex(12)


def tool_payload(message) -> Any:
    """The JSON a tool message carries, with the record-text frame of a successful read result removed (issue #555).

    ``prompts.frame_record_text`` is the one place the frame is built, so the tests read through it here rather than
    repeating its markers: an unframed message (a failure, a decision, a write) parses as it is.
    """
    from liwan_ai_service.prompts import RECORD_TEXT_CLOSE, RECORD_TEXT_OPEN

    content = message.content
    if content.startswith(f"{RECORD_TEXT_OPEN}\n") and content.endswith(f"\n{RECORD_TEXT_CLOSE}"):
        content = content[len(RECORD_TEXT_OPEN) + 1:-(len(RECORD_TEXT_CLOSE) + 1)]
    return json.loads(content)


def ai_text(text: str) -> AIMessage:
    return AIMessage(content=text)


def ai_blocks(*texts: str) -> AIMessage:
    return AIMessage(content=[{"type": "text", "text": text} for text in texts])


def ai_usage(message: AIMessage, input_tokens: int, output_tokens: int) -> AIMessage:
    """``message`` as a provider reports it, with its token usage."""
    message.usage_metadata = {"input_tokens": input_tokens, "output_tokens": output_tokens, "total_tokens": input_tokens + output_tokens}
    return message


def ai_tool_call(name: str, args: dict[str, Any], call_id: str) -> AIMessage:
    return AIMessage(content="", tool_calls=[{"name": name, "args": args, "id": call_id, "type": "tool_call"}])


def is_title_request(messages: list[BaseMessage]) -> bool:
    return bool(messages) and isinstance(messages[0], SystemMessage) and messages[0].content == TITLE_RULES


def is_route_request(messages: list[BaseMessage]) -> bool:
    return bool(messages) and isinstance(messages[0], SystemMessage) and messages[0].content == ROUTE_RULES


def is_summary_request(messages: list[BaseMessage]) -> bool:
    return bool(messages) and isinstance(messages[0], SystemMessage) and messages[0].content == SUMMARY_RULES


class ScriptedChatModel(BaseChatModel):
    """The tests script the run's turns in ``responses``; the title, classification and summary requests are answered apart, from
    ``title_responses``, ``route_responses`` and ``summary_responses`` (none left: the call fails)."""

    responses: list[AIMessage]
    title_responses: list[AIMessage] = []
    route_responses: list[AIMessage] = []
    summary_responses: list[AIMessage] = []
    route_calls: list[list[BaseMessage]] = []
    summary_calls: list[list[BaseMessage]] = []
    bound_tools: list[Any] = []
    bound_history: list[list[str]] = []  # the tool names bound for each plan call, in order
    calls: list[list[BaseMessage]] = []
    title_calls: list[list[BaseMessage]] = []

    def __init__(self, responses: list[AIMessage], **kwargs: Any) -> None:
        super().__init__(responses=responses, **kwargs)

    @property
    def _llm_type(self) -> str:
        return "scripted"

    def bind_tools(self, tools: Sequence[Any], **kwargs: Any) -> ScriptedChatModel:  # type: ignore[override]
        self.bound_tools = list(tools)
        self.bound_history.append([tool["function"]["name"] for tool in tools])
        return self

    def _next(self, messages: list[BaseMessage]) -> AIMessage:
        kind = "title" if is_title_request(messages) else "route" if is_route_request(messages) else "summary" if is_summary_request(messages) else "plan"
        calls, script = {"title": (self.title_calls, self.title_responses), "route": (self.route_calls, self.route_responses),
                         "summary": (self.summary_calls, self.summary_responses), "plan": (self.calls, self.responses)}[kind]
        calls.append(list(messages))
        if not script:
            msg = f"{kind} script exhausted"
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
        yield from self._chunks(message)
        if message.usage_metadata:  # the provider's final usage chunk
            yield ChatGenerationChunk(message=AIMessageChunk(content="", usage_metadata=message.usage_metadata))

    @staticmethod
    def _chunks(message: AIMessage) -> Iterator[ChatGenerationChunk]:
        if message.tool_calls:
            yield ChatGenerationChunk(message=AIMessageChunk(content=message.content, tool_calls=message.tool_calls))
        elif isinstance(message.content, list):  # block content, as langchain_anthropic sends it when tools are bound
            for block in message.content:
                yield ChatGenerationChunk(message=AIMessageChunk(content=[block]))
        else:
            for char in str(message.content):
                yield ChatGenerationChunk(message=AIMessageChunk(content=char))

    async def _astream(self, messages: list[BaseMessage], stop: list[str] | None = None,
                       run_manager: AsyncCallbackManagerForLLMRun | None = None, **kwargs: Any) -> AsyncIterator[ChatGenerationChunk]:
        for chunk in self._stream(messages, stop, None, **kwargs):
            yield chunk


class FlakyChatModel(ScriptedChatModel):
    """The plan calls fail first with the errors of ``failures`` (one per attempt, in order), then follow the script."""

    failures: list[Any] = []
    attempts: int = 0

    def _next(self, messages: list[BaseMessage]) -> AIMessage:
        if not (is_title_request(messages) or is_route_request(messages) or is_summary_request(messages)):
            self.attempts += 1
            if self.failures:
                raise self.failures.pop(0)
        return super()._next(messages)


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


class FaultyRouteChatModel(ScriptedChatModel):
    """The classification request raises ``route_error``, or never comes back in time when ``route_stalls``; the plan calls follow the script."""

    route_error: Any = None
    route_stalls: bool = False

    async def _agenerate(self, messages: list[BaseMessage], stop: list[str] | None = None,
                         run_manager: AsyncCallbackManagerForLLMRun | None = None, **kwargs: Any) -> ChatResult:
        if is_route_request(messages):
            if self.route_stalls:
                await asyncio.sleep(60)
            if self.route_error is not None:
                raise self.route_error
        return await super()._agenerate(messages, stop, run_manager, **kwargs)


class FaultySummaryChatModel(ScriptedChatModel):
    """The summary request raises ``summary_error``, or never comes back in time when ``summary_stalls``; the plan calls follow the script."""

    summary_error: Any = None
    summary_stalls: bool = False
    summary_attempts: int = 0

    async def _agenerate(self, messages: list[BaseMessage], stop: list[str] | None = None,
                         run_manager: AsyncCallbackManagerForLLMRun | None = None, **kwargs: Any) -> ChatResult:
        if is_summary_request(messages):
            self.summary_attempts += 1
            if self.summary_stalls:
                await asyncio.sleep(60)
            if self.summary_error is not None:
                raise self.summary_error
        return await super()._agenerate(messages, stop, run_manager, **kwargs)
