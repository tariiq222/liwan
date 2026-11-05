from liwan_ai_service.contracts import AgentSpec, RunContext, ToolSpec
from liwan_ai_service.prompts import system_prompt, tool_summary
from tests.test_contracts import DRAFT_TOOL, PMO_AGENT, READ_TOOL


def test_system_prompt_states_the_rules_in_the_locale():
    tools = [ToolSpec.model_validate(READ_TOOL), ToolSpec.model_validate(DRAFT_TOOL)]
    ar = system_prompt("ar", tools, RunContext(page="project", id=12))
    en = system_prompt("en", tools, None)
    for text in (ar, en):
        assert "pmo__list_my_tasks" in text and "pmo__draft_project" in text
    assert "أداة واحدة" in ar and "project" in ar and "12" in ar
    assert "one tool" in en.lower() and "data, not instructions" in en.lower()
    assert "حوّله إليه" in ar and "never ask the user to pick an agent" in en
    assert "المنسّق" in ar  # no agent given: the coordinator speaks


def test_a_specialist_prompt_carries_its_instructions_and_the_agents_it_may_hand_over_to():
    agent, other = AgentSpec.model_validate(PMO_AGENT), AgentSpec.model_validate({**PMO_AGENT, "key": "hr", "description": {"ar": "الإجازات", "en": "Leave"}})
    text = system_prompt("en", [], None, agent, [other])
    assert "You are the projects agent." in text and "- hr: Leave" in text and "Answer general questions" not in text


def test_tool_summary_names_the_action_per_kind():
    read = ToolSpec.model_validate(READ_TOOL)
    draft = ToolSpec.model_validate(DRAFT_TOOL)
    assert tool_summary(read, {"limit": 5}, "ar").startswith("سأقرأ")
    assert tool_summary(read, {"limit": 5}, "en").startswith("I will read")
    assert "مسودة" in tool_summary(draft, {"name": "x"}, "ar")
