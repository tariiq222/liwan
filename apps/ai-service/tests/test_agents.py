"""One conversation, several agents (spec 2026-11-04 §6.5): who starts, what each sees, and the hand-over."""
import json

import pytest
from langgraph.checkpoint.memory import InMemorySaver
from langgraph.types import Command
from pydantic import ValidationError

from liwan_ai_service.contracts import RunRequest, ToolResult
from liwan_ai_service.graph import HANDOFF, MAX_HANDOFFS, continued_state, initial_state, run_config
from tests.fakes import PLATFORM_POLICY, BoundGraph, ScriptedChatModel, ai_text, ai_tool_call, new_id
from tests.test_contracts import DRAFT_TOOL, PMO_AGENT, READ_TOOL

HR_AGENT = {**PMO_AGENT, "key": "hr", "name": {"ar": "وكيل الموارد البشرية", "en": "HR agent"},
            "description": {"ar": "الإجازات", "en": "Leave"}, "instructions": {"ar": "أنت وكيل الموارد البشرية.", "en": "You are the HR agent."},
            "pages": ["hr"]}
HR_READ = {**READ_TOOL, "name": "hr.get_my_leave_balances", "route": {"method": "GET", "path": "/api/v1/hr/leave/balances"}}
HR_WRITE = {
    **READ_TOOL, "name": "hr.cancel_leave", "kind": "write_light",
    "route": {"method": "POST", "path": "/api/v1/hr/leave/requests/{leave_id}/cancel"},
    "input_schema": {"type": "object", "properties": {"leave_id": {"type": "integer"}}, "required": ["leave_id"]},
    "input_map": {"path": {"leave_id": "$leave_id"}},
}


def request(context=None, tools=(READ_TOOL, DRAFT_TOOL, HR_READ, HR_WRITE), agents=(PMO_AGENT, HR_AGENT)):
    return RunRequest.model_validate({
        "new_run_id": new_id(), "tenant": "t1", "user_ref": "42", "locale": "en", "message": "help", "context": context,
        "tools": list(tools), "agents": list(agents), "limits": {"max_steps": 10, "max_tool_calls": 2, "timeout_seconds": 60},
        "policy": PLATFORM_POLICY,
    })


def make(responses):
    model = ScriptedChatModel(responses)
    return model, BoundGraph(model, InMemorySaver())


async def pending(graph, thread):
    state = await graph.aget_state(run_config(thread, 10))
    return [item.value for task in state.tasks for item in task.interrupts]


def test_the_page_picks_the_first_agent_and_otherwise_the_coordinator_starts():
    assert initial_state(request({"page": "hr"}))["agent"] == "hr"
    assert initial_state(request({"page": "project", "id": 3}))["agent"] == "pmo"
    assert initial_state(request({"page": "crm"}))["agent"] == "core"
    assert initial_state(request())["agent"] == "core"
    # With one specialist there is nothing to route.
    assert initial_state(request(tools=(READ_TOOL,), agents=(PMO_AGENT,)))["agent"] == "pmo"


async def test_the_coordinator_reads_and_hands_writes_over_to_the_owning_agent():
    model, graph = make([
        ai_tool_call(HANDOFF, {"agent": "pmo", "reason": "a project draft"}, "c_1"),
        ai_tool_call("pmo__draft_project", {"name": "Gate"}, "c_2"),
    ])
    await graph.ainvoke(initial_state(request()), run_config("a1", 10))
    first, second = model.bound_history
    assert first == ["pmo__list_my_tasks", "hr__get_my_leave_balances", HANDOFF]
    assert second == ["pmo__list_my_tasks", "pmo__draft_project", "hr__get_my_leave_balances", HANDOFF]
    [call] = await pending(graph, "a1")
    assert (call["tool"], call["agent"], call["requires_approval"]) == ("pmo.draft_project", "pmo", True)
    state = (await graph.aget_state(run_config("a1", 10))).values
    assert (state["agent"], state["handoffs"], state["tool_calls_made"]) == ("pmo", 1, 0)


async def test_a_specialist_cannot_run_another_agents_write():
    model, graph = make([ai_tool_call("hr__cancel_leave", {"leave_id": 4}, "c_1"), ai_text("no")])
    final = await graph.ainvoke(initial_state(request({"page": "project"})), run_config("a2", 10))
    assert await pending(graph, "a2") == []
    reply = next(m for m in final["messages"] if m.type == "tool")
    assert json.loads(reply.content)["error"]["code"] == "unknown_tool"


async def test_hand_overs_are_bounded_and_an_unknown_target_is_refused():
    script = [ai_tool_call(HANDOFF, {"agent": "pmo" if i % 2 else "hr"}, f"c_{i}") for i in range(MAX_HANDOFFS)]
    model, graph = make([*script, ai_tool_call(HANDOFF, {"agent": "pmo"}, "c_x"), ai_text("done")])
    final = await graph.ainvoke(initial_state(request()), run_config("a3", 10))
    assert final["handoffs"] == MAX_HANDOFFS
    assert HANDOFF not in model.bound_history[-1]
    refused = json.loads(final["messages"][-2].content)
    assert refused["error"]["code"] == "invalid_arguments"


async def test_a_read_the_administrator_set_to_approval_waits_for_the_user():
    gated = {**READ_TOOL, "requires_approval": True}
    model, graph = make([ai_tool_call("pmo__list_my_tasks", {}, "c_1"), ai_text("none")])
    await graph.ainvoke(initial_state(request(tools=(gated,), agents=(PMO_AGENT,))), run_config("a4", 10))
    [call] = await pending(graph, "a4")
    assert call["requires_approval"] is True
    await graph.ainvoke(Command(resume=ToolResult(ok=True, data={"total": 0}).model_dump()), run_config("a4", 10))


def test_a_continued_run_keeps_its_agent_while_it_is_still_offered():
    assert continued_state(request({"page": "hr"}), {"agent": "pmo"})["agent"] == "pmo"
    assert continued_state(request({"page": "hr"}, tools=(HR_READ,), agents=(HR_AGENT,)), {"agent": "pmo"})["agent"] == "hr"
    assert continued_state(request(), {})["agent"] == "core"


def test_the_request_names_an_agent_for_every_tool_and_never_core():
    with pytest.raises(ValidationError, match="belongs to no agent"):
        request(agents=(PMO_AGENT,))
    with pytest.raises(ValidationError, match="coordinator"):
        request(agents=(PMO_AGENT, {**HR_AGENT, "key": "core"}))
    with pytest.raises(ValidationError, match="unique"):
        request(agents=(PMO_AGENT, PMO_AGENT, HR_AGENT))
