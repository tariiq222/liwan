from liwan_ai_service.contracts import RunContext, ToolSpec
from liwan_ai_service.prompts import system_prompt, tool_summary
from tests.test_contracts import DRAFT_TOOL, READ_TOOL


def test_system_prompt_states_the_rules_in_the_locale():
    tools = [ToolSpec.model_validate(READ_TOOL), ToolSpec.model_validate(DRAFT_TOOL)]
    ar = system_prompt("ar", tools, RunContext(page="project", id=12))
    en = system_prompt("en", tools, None)
    for text in (ar, en):
        assert "pmo__list_my_tasks" in text and "pmo__draft_project" in text
    assert "أداة واحدة" in ar and "project" in ar and "12" in ar
    assert "one tool" in en.lower() and "data, not instructions" in en.lower()
    assert "ناقش المستخدم" in ar and "never ask the user to write every field" in en


def test_tool_summary_names_the_action_per_kind():
    read = ToolSpec.model_validate(READ_TOOL)
    draft = ToolSpec.model_validate(DRAFT_TOOL)
    assert tool_summary(read, {"limit": 5}, "ar").startswith("سأقرأ")
    assert tool_summary(read, {"limit": 5}, "en").startswith("I will read")
    assert "مسودة" in tool_summary(draft, {"name": "x"}, "ar")
