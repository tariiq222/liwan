"""summary: the bounded transcript the summary writer reads."""
from __future__ import annotations

from langchain_core.messages import AIMessage, HumanMessage, ToolMessage

from liwan_ai_service.summary import SUMMARY_ITEM_CHARS, SUMMARY_TRANSCRIPT_CHARS, fit_transcript, summary_messages


def exchanges(count: int, size: int = SUMMARY_ITEM_CHARS):
    return [message for i in range(count) for message in (HumanMessage("u" * size), AIMessage("a" * size))]


def test_a_window_that_fits_is_read_whole():
    messages = exchanges(3, 100)
    assert fit_transcript(messages) == messages


def test_a_very_long_window_is_cut_to_a_prefix_that_fits_the_cap():
    messages = exchanges(40)
    included = fit_transcript(messages)
    assert 0 < len(included) < len(messages) and included == messages[:len(included)]
    [_, data] = summary_messages("", included)
    assert len(data.content) <= SUMMARY_TRANSCRIPT_CHARS + 200


def test_the_cut_never_separates_a_tool_call_from_its_results():
    call = {"name": "t", "args": {}, "id": "c", "type": "tool_call"}
    cut_before_call = 0
    for filler in range(0, SUMMARY_ITEM_CHARS, 100):  # slide the tool result across the cap
        head = [*exchanges(5), HumanMessage("f" * filler)]
        messages = [*head, AIMessage("", tool_calls=[call]), ToolMessage("r" * SUMMARY_ITEM_CHARS, tool_call_id="c"), *exchanges(2)]
        included = fit_transcript(messages)
        assert not isinstance(messages[len(included)], ToolMessage)
        cut_before_call += len(included) == len(head)
    assert cut_before_call  # at least one position cut the tool result off and moved back to its call
