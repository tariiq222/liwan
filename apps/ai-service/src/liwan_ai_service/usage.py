"""Provider calls and what they report: one ``model_call`` before every attempt, one ``model_usage`` after it.

Both events go from the service to the Nuxt server only; the browser stream never carries them. The plan call is retried here
(the provider SDKs are built with ``max_retries=0``) so that every attempt, and its outcome, is reported.
"""
from __future__ import annotations

import asyncio
import logging
import random
import re
import secrets
from collections.abc import Callable, Iterable
from dataclasses import dataclass
from datetime import UTC, datetime
from decimal import Decimal
from email.utils import parsedate_to_datetime
from typing import Any

from langchain_core.language_models import BaseChatModel
from langchain_core.messages import AIMessage, BaseMessage
from langchain_core.runnables import Runnable

from liwan_ai_service.contracts import (
    MAX_COST_UNITS,
    Billing,
    Capability,
    ModelCallEvent,
    ModelCallKind,
    ModelCallOutcome,
    ModelUsageEvent,
)
from liwan_ai_service.errors import is_transient_provider_error

log = logging.getLogger("liwan_ai_service")
# Ollama's ResponseError carries a status_code as well, so its 5xx answers are retried too; that is acceptable (a local server, same bounds).
PLAN_ATTEMPTS = 3
BACKOFF_SECONDS = (0.5, 1.0)  # before the second and the third attempt
JITTER = 0.25  # each wait grows by a random 0 to 25 %, so concurrent runs do not retry in step
TOKENS_PER_PRICE = 1_000_000  # prices are per million tokens
BPS = 10_000  # basis points in 100 %
UNITS_PER_USD = 100_000  # one cost unit is 0.00001 USD
PRICE = re.compile(r"[0-9]{1,9}(\.[0-9]{1,9})?")  # a plain decimal in USD per million tokens
Tokens = tuple[int | None, int | None]
Emit = Callable[[dict[str, Any]], None]  # takes ``{"event": name, "data": payload}``; the graph passes LangGraph's custom stream writer


def _is_count(value: object) -> bool:
    return isinstance(value, int) and not isinstance(value, bool) and value >= 0


def price_units(price: str) -> int:
    """A price in USD per million tokens as cost units per million tokens (``price * 100,000``).

    The result must be an exact integer within the shared maximum, so a price finer than one unit is refused instead of rounded;
    anything but a plain decimal raises ``ValueError``.
    """
    if not isinstance(price, str) or not PRICE.fullmatch(price):
        msg = "a price is a plain decimal number of USD per million tokens"
        raise ValueError(msg)
    units = Decimal(price) * UNITS_PER_USD
    if units != units.to_integral_value():
        msg = "a price has at most five decimal places (one cost unit is 0.00001 USD)"
        raise ValueError(msg)
    if units > MAX_COST_UNITS:
        msg = "a price is above the shared maximum"
        raise ValueError(msg)
    return int(units)


@dataclass(frozen=True)
class ModelIdentity:
    provider: str
    model: str
    billing: Billing  # whose account pays: the platform's, the tenant's own key, or the vendor's setup budget
    capability: Capability = "standard"  # the kind of task the model serves (see ``RunModels.for_capability``)
    input_units: int | None = None  # price per million input tokens in cost units; None while unknown
    output_units: int | None = None  # price per million output tokens in cost units; None while unknown
    margin_bps: int = 0  # the vendor margin on cost, in basis points (2000 = 20 %)
    cached_input_units: int | None = None  # price per million cached input tokens; carried for the caching slice, not yet in the cost

    def __post_init__(self) -> None:
        for name in ("input_units", "cached_input_units", "output_units"):
            value = getattr(self, name)
            if value is not None and not _is_count(value):
                msg = f"{name} must be None or a non-negative integer"
                raise ValueError(msg)
        if not _is_count(self.margin_bps):
            msg = "margin_bps must be a non-negative integer"
            raise ValueError(msg)


@dataclass(frozen=True)
class RunModel:
    """The model a run uses and how its calls are reported; chosen per request from the tenant's policy."""

    model: BaseChatModel
    identity: ModelIdentity


def new_call_id() -> str:
    return secrets.token_hex(8)


def call_cost(tokens: Tokens, input_units: int | None, output_units: int | None) -> int | None:
    """What a call cost the vendor in cost units, rounded up; None while the tokens or a price are unknown, or above the shared maximum."""
    input_tokens, output_tokens = tokens
    if input_tokens is None or output_tokens is None or input_units is None or output_units is None:
        return None
    cost = -(-(input_tokens * input_units + output_tokens * output_units) // TOKENS_PER_PRICE)
    return cost if cost <= MAX_COST_UNITS else None


def call_charge(cost: int | None, margin_bps: int) -> int | None:
    """The cost plus the vendor margin, rounded up; None without a cost or above the shared maximum."""
    if cost is None:
        return None
    charge = -(-(cost * (BPS + margin_bps)) // BPS)
    return charge if charge <= MAX_COST_UNITS else None


def call_event(call_id: str, kind: ModelCallKind, identity: ModelIdentity) -> dict[str, Any]:
    event = ModelCallEvent(
        call_id=call_id, kind=kind, capability=identity.capability, billing=identity.billing, provider=identity.provider,
        model=identity.model, called_at=datetime.now(UTC),
    )
    return {"event": "model_call", "data": event.model_dump(mode="json")}


def usage_event(call_id: str, outcome: ModelCallOutcome, identity: ModelIdentity, tokens: Tokens = (None, None)) -> dict[str, Any]:
    """The tenant's own key is not priced here (cost and charge null); a setup call has a cost but no charge, the vendor pays it."""
    cost = None if identity.billing == "tenant_key" else call_cost(tokens, identity.input_units, identity.output_units)
    charge = call_charge(cost, identity.margin_bps) if identity.billing == "platform" else None
    priced = tokens[0] is not None and identity.input_units is not None and identity.output_units is not None
    if identity.billing != "tenant_key" and priced and (cost is None or (identity.billing == "platform" and charge is None)):
        log.warning("%s/%s: the cost or charge of a call is above %s units and is not reported", identity.provider, identity.model, MAX_COST_UNITS)
    event = ModelUsageEvent(call_id=call_id, outcome=outcome, input_tokens=tokens[0], output_tokens=tokens[1], cost=cost, charge=charge)
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


async def invoke_once(
    kind: ModelCallKind, model: BaseChatModel, messages: list[BaseMessage], identity: ModelIdentity, emit: Emit, timeout_seconds: float,
    deadline_at: float | None = None,
) -> AIMessage:
    """A side call (``route`` or ``summary``): one attempt, reported as a ``kind`` call.

    The outcome is ``aborted`` when it outlasts ``timeout_seconds`` or the run deadline.

    A failure is reported and then raised; the caller decides what a failed call means.
    """
    call_id = new_call_id()
    emit(call_event(call_id, kind, identity))
    seconds = timeout_seconds if deadline_at is None else min(timeout_seconds, deadline_at - asyncio.get_running_loop().time())
    timeout = asyncio.timeout(seconds)
    try:
        async with timeout:
            response = await model.ainvoke(messages)
    except Exception as error:
        emit(usage_event(call_id, "aborted" if isinstance(error, TimeoutError) and timeout.expired() else "failed", identity))
        raise
    emit(usage_event(call_id, "ok", identity, tokens_of([response])))
    return response


async def invoke_planned(
    model: Runnable, messages: list[BaseMessage], identity: ModelIdentity, emit: Emit, deadline_at: float | None = None,
    attempts: int = PLAN_ATTEMPTS,
) -> AIMessage:
    """The planning call: up to ``attempts`` attempts (``PLAN_ATTEMPTS`` unless the caller bounds it), each reported.

    A wait honours the provider's ``Retry-After`` and is jittered; one that would not end before ``deadline_at`` (the run deadline, on
    the event loop clock; None: unbounded) is not started: the failure is final instead.

    Only a failure that comes before any output is retried: the transient classes (408/409/429/5xx answers, connections that
    could not be made) are all raised when the request is answered, before the first token streams.
    """
    for attempt in range(attempts):
        call_id = new_call_id()
        emit(call_event(call_id, "plan", identity))
        try:
            response = await model.ainvoke(messages)
        except Exception as error:
            wait = retry_wait(error, attempt) if attempt < attempts - 1 and is_transient_provider_error(error) else None
            if wait is not None and deadline_at is not None and wait >= deadline_at - asyncio.get_running_loop().time():
                wait = None  # the run deadline comes first: no point waiting for an attempt it would cut
            emit(usage_event(call_id, "failed" if wait is None else "retried", identity))
            if wait is None:
                raise
            log.warning("plan call attempt %s failed (%s); retrying in %.2fs", attempt + 1, type(error).__name__, wait)
            await asyncio.sleep(wait)
            continue
        emit(usage_event(call_id, "ok", identity, tokens_of([response])))
        return response
    raise AssertionError("unreachable: the last attempt returns or raises")  # pragma: no cover
