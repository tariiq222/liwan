"""The classifier's request and the reading of its answer."""
import pytest

from liwan_ai_service.router import ROUTE_MESSAGE_CHARS, ROUTE_RULES, parse_capability, route_messages


def test_the_request_is_the_rules_and_one_prompt_with_no_history_or_tools():
    system, human = route_messages("حلل مبيعات الشهر", "finance", "writing")
    assert (system.type, system.content) == ("system", ROUTE_RULES)
    assert human.type == "human"
    assert human.content == "Active agent: finance\nPrevious capability: writing\n\nUser message:\nحلل مبيعات الشهر"
    assert "Arabic or English" in ROUTE_RULES


def test_a_long_message_is_cut():
    _system, human = route_messages("x" * (ROUTE_MESSAGE_CHARS + 500), "core", "standard")
    assert human.content.endswith("x" * ROUTE_MESSAGE_CHARS) and "x" * (ROUTE_MESSAGE_CHARS + 1) not in human.content


@pytest.mark.parametrize(("reply", "expected"), [
    ("quick", "quick"),
    ("  Analysis.\n", "analysis"),
    ("WRITING", "writing"),
    ("standard!", "standard"),
    ("The task is analysis, I think", "analysis"),
    ("**quick**", "quick"),
    ("maybe", "standard"),
    ("", "standard"),
    ("تحليل", "standard"),
    ("quickly", "standard"),
])
def test_the_reply_is_read_leniently_and_anything_else_is_standard(reply, expected):
    assert parse_capability(reply) == expected
