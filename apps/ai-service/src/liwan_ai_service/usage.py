"""Provider calls and what they report: one ``model_call`` before every attempt, one ``model_usage`` after it.

Both events go from the service to the Nuxt server only; the browser stream never carries them. The plan call is retried here
(the provider SDKs are built with ``max_retries=0``) so that every attempt, and its outcome, is reported.
"""
from __future__ import annotations

import asyncio
import logging
import random
import secrets
from collections.abc import Callable, Iterable
from dataclasses import dataclass
from datetime import UTC, datetime
from email.utils import parsedate_to_datetime
from typing import Any

from langchain_core.messages import AIMessage, BaseMessage
from langchain_core.runnables import Runnable

from liwan_ai_service.contracts import ModelCallEvent, ModelCallKind, ModelCallOutcome, ModelUsageEvent
from liwan_ai_service.errors import is_transient_provider_error

log = logging.getLogger("liwan_ai_service")
# Ollama's ResponseError carries a status_code as well, so its 5xx answers are retried too; that is acceptable (a local server, same bounds).
PLAN_ATTEMPTS = 3
BACKOFF_SECONDS = (0.5, 1.0)  # before the second and the third attempt
JITTER = 0.25  # each wait grows by a random 0 to 25 %, so concurrent runs do not retry in step
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


def retry_after_seconds(error: BaseException, now: datetime | None = None) -> float | None:
    """The provider's ``Retry-After`` (delay in seconds, or an HTTP date) from ``error.response``, or None when absent or unreadable."""
    headers = getattr(getattr(error, "response", None), "headers", None)
    raw = headers.get("retry-after") if headers is not None else None
    if not isinstance(raw, str) or not raw.strip():
        return None
    try:
        seconds = float(raw)
    except ValueError:
        try:
            seconds = (parsedate_to_datetime(raw) - (now or datetime.now(UTC))).total_seconds()
        except (TypeError, ValueError):
            return None
    return max(seconds, 0.0) if seconds == seconds else None  # noqa: PLR0124 - NaN is unreadable


def retry_wait(error: BaseException, attempt: int) -> float:
    """Seconds to wait after the failed ``attempt`` (0-based): the backoff, or the provider's ``Retry-After`` when longer, plus jitter."""
    base = BACKOFF_SECONDS[attempt]
    hinted = retry_after_seconds(error)
    wait = base if hinted is None else max(base, hinted)
    return wait * (1 + random.uniform(0, JITTER))  # noqa: S311 - jitter, not security


async def invoke_planned(
    model: Runnable, messages: list[BaseMessage], identity: ModelIdentity, emit: Emit, deadline_at: float | None = None,
) -> AIMessage:
    """The planning call: up to ``PLAN_ATTEMPTS`` attempts, each reported.

    A wait honours the provider's ``Retry-After`` and is jittered; one that would not end before ``deadline_at`` (the run deadline, on
    the event loop clock; None: unbounded) is not started: the failure is final instead.

    Only a failure that comes before any output is retried: the transient classes (408/409/429/5xx answers, connections that
    could not be made) are all raised when the request is answered, before the first token streams.
    """
    for attempt in range(PLAN_ATTEMPTS):
        call_id = new_call_id()
        emit(call_event(call_id, "plan", identity))
        try:
            response = await model.ainvoke(messages)
        except Exception as error:
            wait = retry_wait(error, attempt) if attempt < PLAN_ATTEMPTS - 1 and is_transient_provider_error(error) else None
            if wait is not None and deadline_at is not None and wait >= deadline_at - asyncio.get_running_loop().time():
                wait = None  # the run deadline comes first: no point waiting for an attempt it would cut
            emit(usage_event(call_id, "failed" if wait is None else "retried"))
            if wait is None:
                raise
            log.warning("plan call attempt %s failed (%s); retrying in %.2fs", attempt + 1, type(error).__name__, wait)
            await asyncio.sleep(wait)
            continue
        emit(usage_event(call_id, "ok", tokens_of([response])))
        return response
    raise AssertionError("unreachable: the last attempt returns or raises")  # pragma: no cover
