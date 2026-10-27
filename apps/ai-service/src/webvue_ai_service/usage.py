"""Provider calls and what they report: one ``model_call`` before every attempt, one ``model_usage`` after it.

Both events go from the service to the Nuxt server only; the browser stream never carries them. The plan call is retried here
(the provider SDKs are built with ``max_retries=0``) so that every attempt, and its outcome, is reported.
"""
from __future__ import annotations

import asyncio
import logging
import secrets
from collections.abc import Callable, Iterable
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

from langchain_core.messages import AIMessage, BaseMessage
from langchain_core.runnables import Runnable

from webvue_ai_service.contracts import ModelCallEvent, ModelCallKind, ModelCallOutcome, ModelUsageEvent
from webvue_ai_service.errors import is_transient_provider_error

log = logging.getLogger("webvue_ai_service")
PLAN_ATTEMPTS = 3
BACKOFF_SECONDS = (0.5, 1.0)  # before the second and the third attempt
Tokens = tuple[int | None, int | None]
Emit = Callable[[dict[str, Any]], None]  # takes ``{"event": name, "data": payload}``; the graph passes LangGraph's custom stream writer


@dataclass(frozen=True)
class ModelIdentity:
    provider: str
    model: str


def new_call_id() -> str:
    return secrets.token_hex(8)


def call_event(call_id: str, kind: ModelCallKind, identity: ModelIdentity) -> dict[str, Any]:
    event = ModelCallEvent(call_id=call_id, kind=kind, provider=identity.provider, model=identity.model, called_at=datetime.now(UTC))
    return {"event": "model_call", "data": event.model_dump(mode="json")}


def usage_event(call_id: str, outcome: ModelCallOutcome, tokens: Tokens = (None, None)) -> dict[str, Any]:
    event = ModelUsageEvent(call_id=call_id, outcome=outcome, input_tokens=tokens[0], output_tokens=tokens[1])
    return {"event": "model_usage", "data": event.model_dump(mode="json")}


def tokens_of(messages: Iterable[BaseMessage]) -> Tokens:
    """The summed token counts the provider reported on ``messages`` (one reply, or the chunks of a stream); null when it reported none."""
    reported = [message.usage_metadata for message in messages if getattr(message, "usage_metadata", None)]
    if not reported:
        return None, None
    return sum(usage.get("input_tokens", 0) for usage in reported), sum(usage.get("output_tokens", 0) for usage in reported)


async def invoke_planned(model: Runnable, messages: list[BaseMessage], identity: ModelIdentity, emit: Emit) -> AIMessage:
    """The planning call: up to ``PLAN_ATTEMPTS`` attempts, each reported. The run deadline cancels the wait between attempts.

    Only a failure that comes before any output is retried: the transient classes (408/409/429/5xx answers, connections that
    could not be made) are all raised when the request is answered, before the first token streams.
    """
    for attempt in range(PLAN_ATTEMPTS):
        call_id = new_call_id()
        emit(call_event(call_id, "plan", identity))
        try:
            response = await model.ainvoke(messages)
        except Exception as error:
            retry = attempt < PLAN_ATTEMPTS - 1 and is_transient_provider_error(error)
            emit(usage_event(call_id, "retried" if retry else "failed"))
            if not retry:
                raise
            log.warning("plan call attempt %s failed (%s); retrying", attempt + 1, type(error).__name__)
            await asyncio.sleep(BACKOFF_SECONDS[attempt])
            continue
        emit(usage_event(call_id, "ok", tokens_of([response])))
        return response
    raise AssertionError("unreachable: the last attempt returns or raises")  # pragma: no cover
