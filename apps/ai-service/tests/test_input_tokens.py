"""The tenant's ceiling on the input tokens of one request (issue #554).

Every plan call sends the whole prompt and history to the provider, so a conversation that keeps growing costs more with
each turn. ``policy.max_input_tokens`` bounds that spend the same way the platform's output cap does: a call that reaches
the ceiling completes (its text has already streamed to the browser) and the run ends there — ``limit_reached`` with
``input_tokens`` — so no further prompt is paid for and no tool request a completed call carried is made.
"""
import httpx
import pytest
from langgraph.checkpoint.memory import InMemorySaver
from langgraph.types import Command

from liwan_ai_service.contracts import RunRequest, ToolResult
from liwan_ai_service.graph import initial_state, run_config
from tests.fakes import PLATFORM_POLICY, BoundGraph, ScriptedChatModel, ai_text, ai_tool_call, ai_usage, make_memory_app, new_id
from tests.test_contracts import DRAFT_TOOL, PMO_AGENT, READ_TOOL
from tests.test_service import BODY, HEADERS, SETTINGS, fresh, parse_sse

PAUSED = ai_usage(ai_tool_call("pmo__list_my_tasks", {}, "c_1"), 5000, 20)  # one plan call, then the read waits for its result
ROWS = {"ok": True, "data": {"items": [{"id": 5, "name": "تقرير"}], "total": 1}}


def make(responses, policy=None):
    model = ScriptedChatModel(responses)
    graph = BoundGraph(model, InMemorySaver())
    request = RunRequest.model_validate({
        "new_run_id": new_id(), "tenant": "t1", "user_ref": "42", "locale": "ar", "message": "وش مهامي؟", "context": None,
        "tools": [READ_TOOL, DRAFT_TOOL], "agents": [PMO_AGENT],
        "limits": {"max_steps": 6, "max_tool_calls": 2, "timeout_seconds": 60},
        "policy": {**PLATFORM_POLICY, **(policy or {})},
    })
    return model, graph, request


def interrupts_of(state):
    return [item.value for task in state.tasks for item in task.interrupts]


async def test_a_call_that_reaches_the_ceiling_ends_the_run_without_a_tool_request():
    model, graph, request = make([ai_usage(ai_tool_call("pmo__list_my_tasks", {}, "c_1"), 5000, 20),
                                 ai_usage(ai_text("لا يُرسل"), 100, 5)], policy={"max_input_tokens": 1000})
    config = run_config(request.new_run_id, 6)
    final = await graph.ainvoke(initial_state(request), config)
    assert final["outcome"] == "limit_reached" and final["limit"] == "input_tokens"
    assert final["input_tokens"] == 5000
    # The call it carried is not requested: the run spent its ceiling on the call it already made.
    assert interrupts_of(await graph.aget_state(config)) == []
    assert len(model.calls) == 1


async def test_the_spent_input_tokens_add_up_across_the_calls_of_one_run():
    """Every call sends the whole prompt again, so the calls of a run are summed and the crossing one ends the run."""
    model, graph, request = make([
        ai_usage(ai_tool_call("pmo__list_my_tasks", {}, "c_1"), 400, 10),
        ai_usage(ai_tool_call("pmo__list_my_tasks", {}, "c_2"), 400, 10),
        ai_usage(ai_text("لا يُرسل"), 400, 5),
    ], policy={"max_input_tokens": 900})
    config = run_config(request.new_run_id, 6)
    await graph.ainvoke(initial_state(request), config)
    await graph.ainvoke(Command(resume=ToolResult(ok=True, data={"items": [], "total": 0}).model_dump()), config)
    # Two calls under the ceiling (800); the third crosses it and ends the run, so its tool call is never requested.
    final = await graph.ainvoke(Command(resume=ToolResult(ok=True, data={"items": [], "total": 0}).model_dump()), config)
    assert final["outcome"] == "limit_reached" and final["limit"] == "input_tokens"
    assert final["input_tokens"] == 1200
    assert len(model.calls) == 3


async def test_a_zero_ceiling_sends_no_prompt_at_all():
    """Zero is a ceiling of its own, not "unlimited": no prompt fits under it, so no provider call is made."""
    model, graph, request = make([ai_text("لا يُرسل")], policy={"max_input_tokens": 0})
    final = await graph.ainvoke(initial_state(request), run_config(request.new_run_id, 6))
    assert final["outcome"] == "limit_reached" and final["limit"] == "input_tokens"
    assert model.calls == []


async def test_a_run_under_the_ceiling_answers_normally():
    model, graph, request = make([ai_usage(ai_text("عندك مهمة واحدة"), 200, 8)], policy={"max_input_tokens": 1000})
    final = await graph.ainvoke(initial_state(request), run_config(request.new_run_id, 6))
    assert final["outcome"] == "answer"
    assert final["input_tokens"] == 200
    assert final["messages"][-1].content == "عندك مهمة واحدة"


async def test_no_ceiling_means_no_stop_however_large_the_prompt():
    model, graph, request = make([ai_usage(ai_text("طويل"), 90_000, 8)], policy={"max_input_tokens": None})
    final = await graph.ainvoke(initial_state(request), run_config(request.new_run_id, 6))
    assert final["outcome"] == "answer"


async def test_a_provider_reporting_no_input_tokens_is_logged_and_the_run_goes_on(caplog):
    """An unreported count cannot be capped: the call is kept, and the reason is logged rather than hidden."""
    model, graph, request = make([
        ai_text("بلا عدّ"),
        ai_usage(ai_text("تم"), 10, 2),
    ], policy={"max_input_tokens": 100})
    with caplog.at_level("WARNING", logger="liwan_ai_service"):
        final = await graph.ainvoke(initial_state(request), run_config(request.new_run_id, 6))
    assert final["outcome"] == "answer"
    assert final["input_tokens"] == 0
    assert any("per-run input ceiling cannot count this call" in record.message for record in caplog.records)


@pytest.mark.parametrize("cap", [-1, 2_000_001])
def test_the_ceiling_is_bounded(cap):
    with pytest.raises(ValueError):
        RunRequest.model_validate({
            "new_run_id": new_id(), "tenant": "t1", "user_ref": "42", "locale": "ar", "message": "x", "context": None,
            "tools": [], "agents": [], "limits": {"max_steps": 6, "max_tool_calls": 2, "timeout_seconds": 60},
            "policy": {**PLATFORM_POLICY, "max_input_tokens": cap},
        })


def make_client(responses):
    model = ScriptedChatModel(responses)
    app = make_memory_app(model, SETTINGS)
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://ai"), model


async def run_paused_on_a_read(client, policy):
    """Start a run whose one plan call spends 5000 input tokens and then waits for its tool result."""
    body = fresh({**BODY, "policy": {**PLATFORM_POLICY, **policy}})
    events = parse_sse((await client.post("/v1/runs", json=body, headers=HEADERS)).text)
    assert events[-1][1] == {"status": "waiting_tool"} and (events[-2][0], events[-2][1]["call_id"]) == ("tool_request", "c_1")
    return events[0][1]["run_id"]


async def test_a_ceiling_lowered_while_the_run_waited_stops_the_resumed_run():
    """A ceiling set after the pause applies to the rest of the run: the tokens already spent are over it, so no call is made."""
    client, model = make_client([PAUSED])
    async with client:
        run_id = await run_paused_on_a_read(client, {})
        resumed = parse_sse((await client.post(f"/v1/runs/{run_id}/resume", json={
            "call_id": "c_1", "policy": {**PLATFORM_POLICY, "max_input_tokens": 1000}, "result": ROWS,
        }, headers=HEADERS)).text)
        assert ("limit_reached", {"limit": "input_tokens"}) in resumed and resumed[-1][1] == {"status": "limit_reached"}
        assert len(model.calls) == 1  # the stale no-ceiling checkpoint does not spend another prompt
        assert (await client.get(f"/v1/runs/{run_id}", headers=HEADERS)).json()["status"] == "limit_reached"


@pytest.mark.parametrize("policy", [{"max_input_tokens": 20_000}, {"max_input_tokens": None}])
async def test_a_ceiling_raised_or_cleared_while_the_run_waited_lets_the_resumed_run_answer(policy):
    """The ceiling is the resume policy's, not the checkpoint's.

    The run started under a 6000 ceiling, paused after spending 5000, and its next call spends 5000 more: under the
    checkpointed 6000 the resumed run would stop at 10000, so only the raised (or cleared) ceiling lets it answer.
    """
    client, model = make_client([PAUSED, ai_usage(ai_text("عندك مهمة واحدة"), 5000, 8)])
    async with client:
        run_id = await run_paused_on_a_read(client, {"max_input_tokens": 6000})
        resumed = parse_sse((await client.post(f"/v1/runs/{run_id}/resume", json={
            "call_id": "c_1", "policy": {**PLATFORM_POLICY, **policy}, "result": ROWS,
        }, headers=HEADERS)).text)
        assert len(model.calls) == 2  # the raised ceiling let the second call be made
        assert ("limit_reached", {"limit": "input_tokens"}) not in resumed
        assert dict(resumed)["answer"]["text"] == "عندك مهمة واحدة" and resumed[-1][1] == {"status": "done"}
        assert (await client.get(f"/v1/runs/{run_id}", headers=HEADERS)).json()["status"] == "done"
