"""summary: the bounded transcript the summary writer reads."""
from __future__ import annotations

from langchain_core.messages import AIMessage, HumanMessage, ToolMessage

from liwan_ai_service.summary import SUMMARY_ITEM_CHARS, SUMMARY_MIN_ITEM_CHARS, SUMMARY_TRANSCRIPT_CHARS, fit_transcript, summary_messages


def exchanges(count: int, size: int = SUMMARY_ITEM_CHARS):
    return [message for i in range(count) for message in (HumanMessage("u" * size), AIMessage("a" * size))]


def test_a_window_that_fits_is_read_whole():
    messages = exchanges(3, 100)
    assert fit_transcript(messages) == (messages, SUMMARY_ITEM_CHARS)


def test_a_very_long_window_is_cut_to_a_prefix_that_fits_the_cap():
    messages = exchanges(40)
    included, _ = fit_transcript(messages)
    assert 0 < len(included) < len(messages) and included == messages[:len(included)]
    [_, data] = summary_messages("", included)
    assert len(data.content) <= SUMMARY_TRANSCRIPT_CHARS + 200


def test_the_cut_never_separates_a_tool_call_from_its_results():
    call = {"name": "t", "args": {}, "id": "c", "type": "tool_call"}
    cut_before_call = 0
    for filler in range(0, SUMMARY_ITEM_CHARS, 100):  # slide the tool result across the cap
        head = [*exchanges(5), HumanMessage("f" * filler)]
        messages = [*head, AIMessage("", tool_calls=[call]), ToolMessage("r" * SUMMARY_ITEM_CHARS, tool_call_id="c"), *exchanges(2)]
        included, _ = fit_transcript(messages)
        assert not isinstance(messages[len(included)], ToolMessage)
        cut_before_call += len(included) == len(head)
    assert cut_before_call  # at least one position cut the tool result off and moved back to its call


def parallel_group(calls: int = 13) -> list:
    """One assistant turn with ``calls`` parallel tool calls whose arguments are at the per-line limit, and their results."""
    tool_calls = [{"name": f"tool_{i}", "args": {"q": "x" * SUMMARY_ITEM_CHARS}, "id": f"c{i}", "type": "tool_call"} for i in range(calls)]
    return [AIMessage("", tool_calls=tool_calls), *(ToolMessage("r" * SUMMARY_ITEM_CHARS, tool_call_id=f"c{i}") for i in range(calls))]


def test_a_first_group_larger_than_the_budget_is_taken_whole_with_shortened_lines():
    group = parallel_group()
    messages = [*group, *exchanges(3)]
    included, limit = fit_transcript(messages)
    assert included == group and SUMMARY_MIN_ITEM_CHARS <= limit < SUMMARY_ITEM_CHARS
    [_, data] = summary_messages("", included, limit)
    assert len(data.content) <= SUMMARY_TRANSCRIPT_CHARS + 200
    assert all(f"tool_{i} " in data.content for i in range(13)) and data.content.count("Tool result:") == 13


def test_a_later_group_that_does_not_fit_still_stops_the_prefix_before_it():
    messages = [HumanMessage("q"), *parallel_group()]
    included, limit = fit_transcript(messages)
    assert included == messages[:1] and limit == SUMMARY_ITEM_CHARS


def test_a_group_with_too_many_lines_keeps_the_minimum_line_length_and_is_never_empty():
    included, limit = fit_transcript(parallel_group(120))
    assert len(included) == 121 and limit == SUMMARY_MIN_ITEM_CHARS
