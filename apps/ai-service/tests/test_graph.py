import json
import re

import pytest
from langgraph.checkpoint.memory import InMemorySaver
from langgraph.types import Command

from tests.fakes import ScriptedChatModel, ai_text, ai_tool_call
from tests.test_contracts import DRAFT_TOOL, READ_TOOL
from webvue_ai_service.contracts import RunRequest, ToolResult
from webvue_ai_service.graph import build_graph, initial_state, run_config, text_of


def make(responses):
    model = ScriptedChatModel(responses)
    graph = build_graph(model, InMemorySaver())
    request = RunRequest.model_validate({
        "tenant": "t1", "user_ref": "42", "locale": "ar", "message": "وش مهامي؟", "context": None,
        "tools": [READ_TOOL, DRAFT_TOOL], "limits": {"max_steps": 6, "max_tool_calls": 2, "timeout_seconds": 60},
    })
    return model, graph, request


def config(thread):
    return run_config(thread, 6)


async def interrupts(graph, thread):
    state = await graph.aget_state(config(thread))
    return [item.value for task in state.tasks for item in task.interrupts]


async def test_read_tool_interrupts_with_the_request_payload_and_resumes_to_an_answer():
    model, graph, request = make([ai_tool_call("pmo__list_my_tasks", {"limit": 5}, "c_1"), ai_text("عندك مهمة واحدة: تقرير")])
    await graph.ainvoke(initial_state(request), config("r1"))
    [pending] = await interrupts(graph, "r1")
    assert pending == {
        "call_id": "c_1", "tool": "pmo.list_my_tasks", "kind": "read", "input": {"limit": 5},
        "summary_ar": pending["summary_ar"], "summary_en": pending["summary_en"],
    }
    assert pending["summary_ar"].startswith("سأقرأ")
    result = ToolResult(ok=True, data={"items": [{"id": 5, "name": "تقرير"}], "total": 1})
    final = await graph.ainvoke(Command(resume=result.model_dump()), config("r1"))
    assert final["outcome"] == "answer"
    assert final["messages"][-1].content == "عندك مهمة واحدة: تقرير"
    assert final["results"] == [("pmo.list_my_tasks", {"items": [{"id": 5, "name": "تقرير"}], "total": 1})]
    # The tool result reached the model as a tool message with the JSON data.
    tool_messages = [m for m in model.calls[-1] if m.type == "tool"]
    assert json.loads(tool_messages[-1].content)["total"] == 1


async def test_denied_result_is_passed_to_the_model_as_a_structured_error():
    model, graph, request = make([ai_tool_call("pmo__list_my_tasks", {}, "c_1"), ai_text("لا تملك صلاحية")])
    await graph.ainvoke(initial_state(request), config("r2"))
    result = ToolResult(ok=False, error={"code": "forbidden", "message": "no"})
    final = await graph.ainvoke(Command(resume=result.model_dump()), config("r2"))
    tool_messages = [m for m in model.calls[-1] if m.type == "tool"]
    assert json.loads(tool_messages[-1].content) == {"ok": False, "error": {"code": "forbidden", "message": "no"}}
    assert final["results"] == []


async def test_unknown_tool_never_interrupts_and_is_reported_to_the_model():
    model, graph, request = make([ai_tool_call("pmo__delete_everything", {}, "c_1"), ai_text("آسف")])
    final = await graph.ainvoke(initial_state(request), config("r3"))
    assert await interrupts(graph, "r3") == []
    tool_messages = [m for m in model.calls[-1] if m.type == "tool"]
    assert json.loads(tool_messages[-1].content)["error"]["code"] == "unknown_tool"
    assert final["outcome"] == "answer"


async def test_invalid_arguments_are_rejected_before_any_interrupt():
    model, graph, request = make([ai_tool_call("pmo__list_my_tasks", {"limit": "five"}, "c_1"), ai_text("حسنًا")])
    await graph.ainvoke(initial_state(request), config("r4"))
    assert await interrupts(graph, "r4") == []
    tool_messages = [m for m in model.calls[-1] if m.type == "tool"]
    assert json.loads(tool_messages[-1].content)["error"]["code"] == "invalid_arguments"


async def test_two_tool_calls_in_one_turn_run_the_first_only():
    first = ai_tool_call("pmo__list_my_tasks", {}, "c_1")
    first.tool_calls.append({"name": "pmo__get_project", "args": {"project_id": 1}, "id": "c_2", "type": "tool_call"})
    model, graph, request = make([first, ai_text("تم")])
    await graph.ainvoke(initial_state(request), config("r5"))
    pending = await interrupts(graph, "r5")
    assert [item["call_id"] for item in pending] == ["c_1"]
    await graph.ainvoke(Command(resume=ToolResult(ok=True, data={"items": [], "total": 0}).model_dump()), config("r5"))
    tool_messages = [m for m in model.calls[-1] if m.type == "tool"]
    assert {m.tool_call_id for m in tool_messages} == {"c_1", "c_2"}
    assert json.loads(next(m.content for m in tool_messages if m.tool_call_id == "c_2"))["error"]["code"] == "one_tool_per_step"


async def test_tool_call_limit_stops_the_run():
    responses = [ai_tool_call("pmo__list_my_tasks", {}, f"c_{i}") for i in range(1, 4)]
    model, graph, request = make(responses)
    await graph.ainvoke(initial_state(request), config("r6"))
    for _ in range(2):
        await graph.ainvoke(Command(resume=ToolResult(ok=True, data={"items": [], "total": 0}).model_dump()), config("r6"))
    final = (await graph.aget_state(config("r6"))).values
    assert final["outcome"] == "limit_reached"
    assert final["tool_calls_made"] == 2
    assert await interrupts(graph, "r6") == []


async def test_draft_tool_interrupts_and_a_rejection_ends_cleanly():
    model, graph, request = make([ai_tool_call("pmo__draft_project", {"name": "بوابة"}, "c_1"), ai_text("حسنًا، ألغيت المسودة")])
    await graph.ainvoke(initial_state(request), config("r7"))
    [pending] = await interrupts(graph, "r7")
    assert pending["kind"] == "draft" and pending["input"] == {"name": "بوابة"}
    final = await graph.ainvoke(Command(resume=ToolResult(ok=False, decision="rejected").model_dump()), config("r7"))
    assert final["outcome"] == "answer"
    tool_messages = [m for m in model.calls[-1] if m.type == "tool"]
    assert json.loads(tool_messages[-1].content) == {"ok": False, "decision": "rejected"}


async def test_provider_failure_marks_the_run_failed():
    class Exploding(ScriptedChatModel):
        def _next(self, messages):
            raise ConnectionError("provider down")

    graph = build_graph(Exploding(responses=[]), InMemorySaver())
    _, _, request = make([])
    with pytest.raises(ConnectionError):
        await graph.ainvoke(initial_state(request), config("r8"))


async def test_provider_receives_only_provider_legal_tool_names_and_the_interrupt_keeps_the_dotted_name():
    model, graph, request = make([ai_tool_call("pmo__list_my_tasks", {}, "c_1")])
    await graph.ainvoke(initial_state(request), config("r9"))
    names = [tool["function"]["name"] for tool in model.bound_tools]
    assert names == ["pmo__list_my_tasks", "pmo__draft_project"]
    assert all(re.fullmatch(r"[a-zA-Z0-9_-]{1,64}", name) for name in names)
    [pending] = await interrupts(graph, "r9")
    assert pending["tool"] == "pmo.list_my_tasks"
    system = model.calls[0][0].content
    assert "pmo__list_my_tasks" in system and "pmo.list_my_tasks" not in system  # the prompt names what the model can call


async def test_a_provider_name_that_is_not_in_the_encoded_map_is_an_unknown_tool():
    model, graph, request = make([ai_tool_call("pmo.list_my_tasks", {}, "c_1"), ai_text("x")])
    await graph.ainvoke(initial_state(request), config("r10"))
    assert await interrupts(graph, "r10") == []
    assert json.loads([m for m in model.calls[-1] if m.type == "tool"][-1].content)["error"]["code"] == "unknown_tool"


async def test_error_only_loops_stop_at_max_steps_not_at_the_graph_recursion_limit():
    responses = [ai_tool_call("pmo__nothing", {}, f"c_{i}") for i in range(40)]
    model = ScriptedChatModel(responses)
    graph = build_graph(model, InMemorySaver())
    request = RunRequest.model_validate({
        "tenant": "t1", "user_ref": "42", "locale": "ar", "message": "؟", "context": None, "tools": [READ_TOOL],
        "limits": {"max_steps": 30, "max_tool_calls": 2, "timeout_seconds": 60},
    })
    final = await graph.ainvoke(initial_state(request), run_config("r11", 30))
    assert final["outcome"] == "limit_reached" and final["steps"] == 30


async def test_reaching_the_tool_limit_answers_every_tool_call_of_the_last_message():
    first = ai_tool_call("pmo__list_my_tasks", {}, "c_3")
    first.tool_calls.append({"name": "pmo__get_project", "args": {}, "id": "c_4", "type": "tool_call"})
    model, graph, request = make([ai_tool_call("pmo__list_my_tasks", {}, "c_1"), ai_tool_call("pmo__list_my_tasks", {}, "c_2"), first])
    await graph.ainvoke(initial_state(request), config("r12"))
    for _ in range(2):
        await graph.ainvoke(Command(resume=ToolResult(ok=True, data={}).model_dump()), config("r12"))
    messages = (await graph.aget_state(config("r12"))).values["messages"]
    answered = {m.tool_call_id: json.loads(m.content)["error"]["code"] for m in messages if m.type == "tool" and m.tool_call_id in ("c_3", "c_4")}
    assert answered == {"c_3": "limit_reached", "c_4": "limit_reached"}


async def test_the_system_prompt_is_rendered_from_state_on_every_call_and_never_stored():
    model, graph, request = make([ai_tool_call("pmo__list_my_tasks", {}, "c_1"), ai_text("تم")])
    await graph.ainvoke(initial_state(request), config("r13"))
    assert all(m.type != "system" for m in (await graph.aget_state(config("r13"))).values["messages"])
    await graph.ainvoke(Command(update={"locale": "en", "tools": [t.model_dump() for t in request.tools][1:]}, resume=ToolResult(ok=True, data={}).model_dump()), config("r13"))
    system = [m for m in model.calls[-1] if m.type == "system"]
    assert len(system) == 1 and "Answer clearly and briefly in English" in system[0].content and "pmo__list_my_tasks" not in system[0].content


def test_text_of_flattens_provider_blocks():
    assert text_of("plain") == "plain"
    blocks = [{"type": "text", "text": "a"}, {"type": "tool_use", "id": "x", "name": "n", "input": {}}, "b", {"type": "text", "text": "c"}, {"type": "thinking", "thinking": "t"}]
    assert text_of(blocks) == "abc"
    assert text_of([]) == ""
