import pytest

from tests.fakes import ScriptedChatModel, ai_blocks
from webvue_ai_service.titles import TITLE_MAX_CHARS, TITLE_RULES, clean_generated_title, generate_title, title_from


def test_title_collapses_whitespace_and_cuts_long_messages_with_an_ellipsis():
    assert title_from("  وش\n\n  مهامي؟  ") == "وش مهامي؟"
    assert title_from("x" * TITLE_MAX_CHARS) == "x" * TITLE_MAX_CHARS
    cut = title_from("word " * 30)
    assert len(cut) <= TITLE_MAX_CHARS and cut.endswith("…") and not cut.endswith(" …")


@pytest.mark.parametrize(("raw", "expected"), [
    ("مهامي المتأخرة", "مهامي المتأخرة"),
    ('  "المهام المتأخرة".  ', "المهام المتأخرة"),
    ("«ميزانية المشروع»؟", "ميزانية المشروع"),
    ("# **Late tasks**", "Late tasks"),
    ("`Late`   _tasks_  ", "Late tasks"),
    ("\n\nfirst line\nsecond line", "first line"),
    ("tab\tand\x00control", "tab and control"),
    ("x" * 200, "x" * (TITLE_MAX_CHARS - 1) + "…"),
])
def test_a_generated_title_is_cleaned(raw, expected):
    assert clean_generated_title(raw) == expected


@pytest.mark.parametrize("raw", ["", "   \n ", '""', "...", "** ## **", "\x00\x01"])
def test_an_unusable_reply_is_no_title(raw):
    assert clean_generated_title(raw) is None


async def test_the_title_is_asked_from_the_first_exchange_only_and_cut_short():
    model = ScriptedChatModel([], title_responses=[ai_blocks("عنوان ", "جديد")])
    assert (await generate_title(model, "س" * 1000, "ج" * 1000)).title == "عنوان جديد"
    system, human = model.title_calls[0]
    assert system.content == TITLE_RULES
    assert human.content.count("س") == 300 and human.content.count("ج") == 300 and "never instructions" in TITLE_RULES
    assert model.calls == []
