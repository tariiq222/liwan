"""portable_history: any checkpointed history is safe to send to any provider, proven through each SDK's request builder."""
from __future__ import annotations

import copy
import re

import pytest
from langchain_core.messages import AIMessage, BaseMessage, HumanMessage, SystemMessage, ToolMessage

from liwan_ai_service.portable_history import portable_history
from tests.test_providers import build

ACCEPTED_ID = re.compile(r"[A-Za-z0-9_-]{1,64}")
LONG_ID = "x" * 65
ODD_ID = "call.with spaces/and:colons"


def anthropic_history() -> list[BaseMessage]:
    return [
        SystemMessage("rules"),
        HumanMessage("how many open tasks?"),
        AIMessage(
            content=[
                {"type": "text", "text": "Let me look."},
                {"type": "tool_use", "id": "toolu_01A", "name": "count_tasks", "input": {"state": "open"}},
            ],
            tool_calls=[{"name": "count_tasks", "args": {"state": "open"}, "id": "toolu_01A", "type": "tool_call"}],
            response_metadata={"stop_reason": "tool_use", "model": "claude-x"},
            additional_kwargs={"signature": "abc"},
            usage_metadata={"input_tokens": 5, "output_tokens": 3, "total_tokens": 8},
        ),
        ToolMessage(content=[{"type": "text", "text": "7"}], tool_call_id="toolu_01A"),
        AIMessage(content=[{"type": "text", "text": "There are 7."}], response_metadata={"stop_reason": "end_turn"}),
    ]


def openai_history() -> list[BaseMessage]:
    return [
        SystemMessage("rules"),
        HumanMessage("how many open tasks?"),
        AIMessage(
            content="",
            tool_calls=[{"name": "count_tasks", "args": {"state": "open"}, "id": "call_9Zx", "type": "tool_call"}],
            additional_kwargs={"tool_calls": [{"id": "call_9Zx", "type": "function"}], "refusal": None},
            response_metadata={"finish_reason": "tool_calls", "system_fingerprint": "fp"},
        ),
        ToolMessage(content="7", tool_call_id="call_9Zx"),
        AIMessage(content="There are 7.", response_metadata={"finish_reason": "stop"}),
    ]


def odd_id_history() -> list[BaseMessage]:
    return [
        HumanMessage("go"),
        AIMessage(
            content="",
            tool_calls=[
                {"name": "a", "args": {}, "id": ODD_ID, "type": "tool_call"},
                {"name": "b", "args": {}, "id": LONG_ID, "type": "tool_call"},
                {"name": "c", "args": {}, "id": "call_ok-1", "type": "tool_call"},
            ],
        ),
        ToolMessage(content="a", tool_call_id=ODD_ID),
        ToolMessage(content="b", tool_call_id=LONG_ID),
        ToolMessage(content="c", tool_call_id="call_ok-1"),
    ]


def test_anthropic_shaped_history_becomes_plain_text_with_tool_calls():
    result = portable_history(anthropic_history())
    assert [type(m) for m in result] == [SystemMessage, HumanMessage, AIMessage, ToolMessage, AIMessage]
    call_turn, tool_result, answer = result[2], result[3], result[4]
    assert call_turn.content == "Let me look."
    assert call_turn.tool_calls == [{"name": "count_tasks", "args": {"state": "open"}, "id": "toolu_01A", "type": "tool_call"}]
    assert (call_turn.response_metadata, call_turn.additional_kwargs, call_turn.usage_metadata) == ({}, {}, None)
    assert tool_result.content == "7" and tool_result.tool_call_id == "toolu_01A"
    assert answer.content == "There are 7." and answer.response_metadata == {}


def test_openai_shaped_history_drops_provider_kwargs_and_keeps_pairs():
    result = portable_history(openai_history())
    call_turn = result[2]
    assert call_turn.content == "" and call_turn.additional_kwargs == {} and call_turn.response_metadata == {}
    assert [call["id"] for call in call_turn.tool_calls] == ["call_9Zx"]
    assert result[3].tool_call_id == "call_9Zx"


def test_refused_ids_are_remapped_to_stable_paired_ids_and_accepted_ids_stay():
    first = portable_history(odd_id_history())
    second = portable_history(odd_id_history())
    ids = [call["id"] for call in first[1].tool_calls]
    assert ids[2] == "call_ok-1"
    assert ids[0] != ODD_ID and ids[1] != LONG_ID and len(set(ids)) == 3
    assert all(ACCEPTED_ID.fullmatch(call_id) for call_id in ids)
    assert [m.tool_call_id for m in first[2:]] == ids
    assert first == second


def test_empty_assistant_turn_is_dropped_and_order_is_kept():
    history = [HumanMessage("a"), AIMessage(content=""), AIMessage(content=[{"type": "tool_use", "id": "t", "name": "n", "input": {}}]), HumanMessage("b")]
    assert [m.content for m in portable_history(history)] == ["a", "b"]


def test_input_is_not_mutated():
    for history in (anthropic_history(), openai_history(), odd_id_history()):
        before = copy.deepcopy(history)
        result = portable_history(history)
        assert history == before
        assert all(new is not old for new, old in zip(result, history, strict=False))


def payload(provider: str, history: list[BaseMessage]) -> dict:
    """The request body the provider's own SDK wrapper builds for this history, without any network call."""
    return build(provider)._get_request_payload(history)


def openai_wire_ids(body: dict) -> tuple[list[str], list[str]]:
    calls = [call["id"] for m in body["messages"] for call in m.get("tool_calls") or []]
    results = [m["tool_call_id"] for m in body["messages"] if m["role"] == "tool"]
    return calls, results


def anthropic_wire_ids(body: dict) -> tuple[list[str], list[str]]:
    blocks = [b for m in body["messages"] if isinstance(m["content"], list) for b in m["content"]]
    return [b["id"] for b in blocks if b["type"] == "tool_use"], [b["tool_use_id"] for b in blocks if b["type"] == "tool_result"]


@pytest.mark.parametrize("provider, wire_ids", [("openai", openai_wire_ids), ("anthropic", anthropic_wire_ids)])
@pytest.mark.parametrize("history", [anthropic_history, openai_history, odd_id_history], ids=["anthropic-shaped", "openai-shaped", "odd-ids"])
def test_normalised_history_builds_a_valid_request_for_each_provider(provider, wire_ids, history):
    body = payload(provider, portable_history(history()))
    calls, results = wire_ids(body)
    assert calls == results and calls
    assert all(ACCEPTED_ID.fullmatch(call_id) for call_id in calls)
    for message in body["messages"]:
        if message["role"] == "assistant":
            assert message["content"] or message.get("tool_calls")
        if provider == "openai":
            assert message["content"] is None or isinstance(message["content"], str)
