"""History portability: a checkpointed history made safe to send to any provider.

The router sends consecutive messages of one conversation to different providers, but a checkpointed message is shaped by the
provider that produced it (Anthropic content-block lists and ``toolu_`` ids, OpenAI strings and ``call_`` ids, response and usage
metadata). ``portable_history`` is pure: it returns new messages, never touches its input, and the checkpoint is not rewritten.
"""
from __future__ import annotations

import hashlib
import re
from typing import Any

from langchain_core.messages import AIMessage, BaseMessage, ToolMessage

_ACCEPTED_ID = re.compile(r"[A-Za-z0-9_-]{1,64}")
_REMAPPED_ID_PREFIX = "call_"
_REMAPPED_ID_DIGEST_CHARS = 24


def portable_history(messages: list[BaseMessage]) -> list[BaseMessage]:
    """The messages as plain text plus tool calls, in order, with tool-call ids every provider accepts."""
    portable = [_portable(message) for message in messages]
    return [message for message in portable if not _is_empty_assistant_turn(message)]


def _portable(message: BaseMessage) -> BaseMessage:
    if isinstance(message, AIMessage):
        return AIMessage(
            content=_text_of(message.content),
            tool_calls=[{**call, "args": dict(call["args"]), "id": _portable_id(call["id"])} for call in message.tool_calls],
            id=message.id,
            name=message.name,
        )
    if isinstance(message, ToolMessage):
        return ToolMessage(
            content=_text_of(message.content),
            tool_call_id=_portable_id(message.tool_call_id),
            status=message.status,
            id=message.id,
            name=message.name,
        )
    return message.model_copy(deep=True)


def _is_empty_assistant_turn(message: BaseMessage) -> bool:
    return isinstance(message, AIMessage) and not message.content and not message.tool_calls


def _portable_id(call_id: str | None) -> str | None:
    """An id a provider accepts is kept; any other maps to a stable id, the same for a call and for its result."""
    if call_id is None or _ACCEPTED_ID.fullmatch(call_id):
        return call_id
    digest = hashlib.sha256(call_id.encode()).hexdigest()[:_REMAPPED_ID_DIGEST_CHARS]
    return f"{_REMAPPED_ID_PREFIX}{digest}"


def _text_of(content: str | list[Any]) -> str:
    """Plain text of a content: a string as is, a block list reduced to its text blocks."""
    if isinstance(content, str):
        return content
    return "".join(
        block if isinstance(block, str) else block.get("text", "")
        for block in content
        if isinstance(block, str) or (isinstance(block, dict) and block.get("type") == "text")
    )
