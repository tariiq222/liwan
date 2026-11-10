import json
import re

import pytest
from langgraph.checkpoint.memory import InMemorySaver
from langgraph.types import Command

from liwan_ai_service.contracts import RunRequest, ToolResult
from liwan_ai_service.graph import initial_state, run_config, text_of
from tests.fakes import (
    PLATFORM_POLICY,
    BoundGraph,
    FaultyRouteChatModel,
    FlakyChatModel,
    ScriptedChatModel,
    ai_text,
    ai_tool_call,
    new_id,
    tool_payload,
)
from tests.test_contracts import DRAFT_TOOL, PMO_AGENT, READ_TOOL


def make(responses):
    model = ScriptedChatModel(responses)
    graph = BoundGraph(model, InMemorySaver())
    request = RunRequest.model_validate({"new_run_id": new_id(),
        "tenant": "t1", "user_ref": "42", "locale": "ar", "message": "وش مهامي؟", "context": None,
        "tools": [READ_TOOL, DRAFT_TOOL], "agents": [PMO_AGENT], "limits": {"max_steps": 6, "max_tool_calls": 2, "timeout_seconds": 60}, "policy": PLATFORM_POLICY,
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
        "call_id": "c_1", "tool": "pmo.list_my_tasks", "kind": "read", "agent": "pmo", "requires_approval": False,
        "input": {"limit": 5}, "summary_ar": pending["summary_ar"], "summary_en": pending["summary_en"],
    }
    assert pending["summary_ar"].startswith("سأقرأ")
    result = ToolResult(ok=True, data={"items": [{"id": 5, "name": "تقرير"}], "total": 1})
    final = await graph.ainvoke(Command(resume=result.model_dump()), config("r1"))
    assert final["outcome"] == "answer"
    assert final["messages"][-1].content == "عندك مهمة واحدة: تقرير"
    assert final["results"] == [("pmo.list_my_tasks", {"items": [{"id": 5, "name": "تقرير"}], "total": 1})]
    # The tool result reached the model as a tool message with the JSON data (record text framed, issue #555).
    tool_messages = [m for m in model.calls[-1] if m.type == "tool"]
    assert tool_payload(tool_messages[-1])["total"] == 1


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

    graph = BoundGraph(Exploding(responses=[]), InMemorySaver())
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
    graph = BoundGraph(model, InMemorySaver())
    request = RunRequest.model_validate({"new_run_id": new_id(),
        "tenant": "t1", "user_ref": "42", "locale": "ar", "message": "؟", "context": None, "tools": [READ_TOOL], "agents": [PMO_AGENT],
        "limits": {"max_steps": 30, "max_tool_calls": 2, "timeout_seconds": 60}, "policy": PLATFORM_POLICY,
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


def routed(classified, *, default_model=None, deep_model=None, deep_identity=None):
    """A graph whose ``analysis`` plan calls go to a second scripted model; the classifier (the default model, as ``quick``) answers ``classified``."""
    from liwan_ai_service.routing import RunModels
    from liwan_ai_service.usage import ModelIdentity, RunModel
    from tests.fakes import IDENTITY

    default = default_model or ScriptedChatModel([ai_tool_call("pmo__list_my_tasks", {}, "c_1"), ai_text("من الأساسي")],
                                                 route_responses=[ai_text(classified)])
    deep = deep_model or ScriptedChatModel([ai_tool_call("pmo__list_my_tasks", {}, "c_1"), ai_text("من العميق")])
    models = RunModels(RunModel(default, IDENTITY), {"analysis": RunModel(deep, deep_identity or ModelIdentity("ollama", "deep", "platform", "analysis"))})
    graph = BoundGraph(default, InMemorySaver(), run_models=models)
    return default, deep, graph, new_request("حلل")


def new_request(message, tools=None):
    request = RunRequest.model_validate({"new_run_id": new_id(), "tenant": "t1", "user_ref": "42", "locale": "ar", "message": message, "context": None,
        "tools": tools or [READ_TOOL], "agents": [PMO_AGENT], "limits": {"max_steps": 6, "max_tool_calls": 2, "timeout_seconds": 60}, "policy": PLATFORM_POLICY})
    return initial_state(request)


async def custom_events(graph, graph_input, thread):
    """The ``model_call`` and ``model_usage`` events of one graph run: (event, kind or outcome) in order."""
    events = [payload async for mode, payload in graph.astream(graph_input, config(thread), stream_mode=["custom"]) if mode == "custom"]
    return [(event["event"], event["data"].get("kind") or event["data"]["outcome"]) for event in events]


RESULT = ToolResult(ok=True, data={"items": [], "total": 0}).model_dump()


@pytest.mark.parametrize(("capability", "used", "unused", "answer"), [("analysis", "deep", "default", "من العميق"), ("standard", "default", "deep", "من الأساسي")])
async def test_the_message_is_classified_once_and_the_plan_calls_and_the_resume_use_its_model(capability, used, unused, answer):
    default, deep, graph, state = routed(capability)
    models = {"default": default, "deep": deep}
    assert await custom_events(graph, state, "m1") == [
        ("model_call", "route"), ("model_usage", "ok"), ("model_call", "plan"), ("model_usage", "ok"),
    ]
    final = await graph.ainvoke(Command(resume=RESULT), config("m1"))
    assert final["messages"][-1].content == answer and final["capability"] == capability
    assert len(models[used].calls) == 2 and models[unused].calls == []  # the plan before and after the tool interrupt
    assert len(default.route_calls) == 1  # the resume did not classify again


async def test_the_classifier_reads_only_the_last_message_with_the_agent_and_the_previous_capability():
    default, _deep, graph, state = routed("standard")
    await graph.ainvoke({**state, "capability": "writing"}, config("m3"))
    [request] = default.route_calls
    assert [m.type for m in request] == ["system", "human"]
    assert "Active agent: pmo" in request[1].content and "Previous capability: writing" in request[1].content and "حلل" in request[1].content


async def test_a_second_user_message_is_classified_again_and_an_unclear_reply_is_standard():
    from langchain_core.messages import HumanMessage

    from liwan_ai_service.graph import continued_state

    default, deep, graph, state = routed("analysis")
    default.responses[:] = [ai_text("ثاني")]
    deep.responses[:] = [ai_text("أول")]
    default.route_responses.append(ai_text("لا أعرف"))
    first = await graph.ainvoke(state, config("m4"))
    assert first["capability"] == "analysis" and first["messages"][-1].content == "أول"
    request = RunRequest.model_validate({"new_run_id": new_id(), "tenant": "t1", "user_ref": "42", "locale": "ar", "message": "وش اسمك؟", "context": None,
        "tools": [READ_TOOL], "agents": [PMO_AGENT], "limits": {"max_steps": 6, "max_tool_calls": 2, "timeout_seconds": 60}, "policy": PLATFORM_POLICY})
    second = await graph.ainvoke({"messages": [HumanMessage("وش اسمك؟")], **continued_state(request, first)}, config("m4"))
    assert len(default.route_calls) == 2 and "Previous capability: analysis" in default.route_calls[1][1].content
    assert second["capability"] == "standard" and second["messages"][-1].content == "ثاني"


@pytest.mark.parametrize("kwargs", [{"route_error": RuntimeError("boom with a secret")}, {"route_stalls": True}], ids=["error", "timeout"])
async def test_a_failed_or_slow_classification_selects_standard_and_the_run_completes(kwargs, monkeypatch, caplog):
    monkeypatch.setattr("liwan_ai_service.graph.ROUTE_TIMEOUT_SECONDS", 0.05)
    default = FaultyRouteChatModel([ai_text("من الأساسي")], **kwargs)
    _default, _deep, graph, state = routed("", default_model=default)
    events = await custom_events(graph, state, "m5")
    outcome = "aborted" if kwargs.get("route_stalls") else "failed"
    assert events == [("model_call", "route"), ("model_usage", outcome), ("model_call", "plan"), ("model_usage", "ok")]
    assert (await graph.aget_state(config("m5"))).values["messages"][-1].content == "من الأساسي"
    assert "secret" not in caplog.text


async def test_a_single_model_map_and_a_pinned_map_never_classify():
    from liwan_ai_service.routing import RunModels
    from liwan_ai_service.usage import RunModel
    from tests.fakes import IDENTITY

    model = ScriptedChatModel([ai_text("جواب")])
    for index, run_models in enumerate((RunModels(RunModel(model, IDENTITY)), RunModels.pinned(RunModel(model, IDENTITY)))):
        model.responses[:] = [ai_text("جواب")]
        graph = BoundGraph(model, InMemorySaver(), run_models=run_models)
        assert await custom_events(graph, new_request("مرحبا"), f"s{index}") == [("model_call", "plan"), ("model_usage", "ok")]
    assert model.route_calls == []


async def test_a_checkpoint_written_without_a_capability_still_resumes_on_the_default():
    from langchain_core.messages import HumanMessage

    default, _deep, graph, state = routed("standard")
    legacy = {key: value for key, value in state.items() if key != "capability"}
    legacy["messages"] = [HumanMessage("حلل"), ai_tool_call("pmo__list_my_tasks", {}, "c_1")]
    default.responses[:] = [ai_text("من الأساسي")]
    await graph.aupdate_state(config("m2"), legacy, as_node="plan")
    await graph.ainvoke(None, config("m2"))
    assert "capability" not in (await graph.aget_state(config("m2"))).values
    final = await graph.ainvoke(Command(resume=RESULT), config("m2"))
    assert final["messages"][-1].content == "من الأساسي" and len(default.calls) == 1 and default.route_calls == []  # the plan after the resume only


TRANSIENT = type("InternalServerError", (Exception,), {"status_code": 503, "__module__": "openai"})


@pytest.fixture
def no_waiting(monkeypatch):
    async def instant(_seconds):
        return None

    monkeypatch.setattr("liwan_ai_service.usage.asyncio.sleep", instant)


async def test_a_routed_model_that_keeps_failing_transiently_is_replaced_once_by_the_default_for_the_rest_of_the_message(no_waiting):
    deep = FlakyChatModel([], failures=[TRANSIENT("down") for _ in range(3)])
    default = ScriptedChatModel([ai_tool_call("pmo__list_my_tasks", {}, "c_1"), ai_text("من الأساسي")], route_responses=[ai_text("analysis")])
    _default, _deep, graph, state = routed("", default_model=default, deep_model=deep)
    events = await custom_events(graph, state, "f1")
    assert events == [("model_call", "route"), ("model_usage", "ok")] + [("model_call", "plan"), ("model_usage", "retried")] * 2 + [
        ("model_call", "plan"), ("model_usage", "failed"), ("model_call", "plan"), ("model_usage", "ok")]
    values = (await graph.aget_state(config("f1"))).values
    assert values["capability"] == "analysis" and values["on_default_model"] is True
    final = await graph.ainvoke(Command(resume=RESULT), config("f1"))
    assert final["messages"][-1].content == "من الأساسي" and deep.attempts == 3 and len(default.calls) == 2  # the next plan call stayed on the default


async def test_a_non_transient_failure_of_the_routed_model_is_not_retried_on_the_default(no_waiting):
    deep = FlakyChatModel([], failures=[ValueError("bad request")])
    default = ScriptedChatModel([ai_text("never")], route_responses=[ai_text("analysis")])
    _default, _deep, graph, state = routed("", default_model=default, deep_model=deep)
    with pytest.raises(ValueError, match="bad request"):
        await graph.ainvoke(state, config("f2"))
    assert default.calls == []


async def test_no_fallback_when_the_failing_model_already_is_the_default(no_waiting):
    from liwan_ai_service.routing import RunModels
    from liwan_ai_service.usage import ModelIdentity, RunModel
    from tests.fakes import IDENTITY

    default = FlakyChatModel([ai_text("never")], failures=[TRANSIENT("down") for _ in range(4)], route_responses=[ai_text("standard")])
    other = ScriptedChatModel([])
    run_models = RunModels(RunModel(default, IDENTITY), {"analysis": RunModel(other, ModelIdentity("ollama", "o", "platform", "analysis"))})
    graph = BoundGraph(default, InMemorySaver(), run_models=run_models)
    with pytest.raises(TRANSIENT):
        await graph.ainvoke(new_request("مرحبا"), config("f3"))
    assert default.attempts == 3  # the three planned attempts only


async def test_the_model_receives_a_provider_neutral_history_and_the_checkpoint_keeps_the_original():
    from langchain_core.messages import AIMessage, HumanMessage

    model = ScriptedChatModel([ai_text("تمام")])
    graph = BoundGraph(model, InMemorySaver())
    blocks = AIMessage(content=[{"type": "text", "text": "أهلا"}, {"type": "thinking", "thinking": "x"}])
    first = new_request("مرحبا")
    first["messages"] = [HumanMessage("مرحبا"), blocks, HumanMessage("وش مهامي؟")]
    final = await graph.ainvoke(first, config("p1"))
    sent = next(m for m in model.calls[0] if isinstance(m, AIMessage))
    assert sent.content == "أهلا"
    assert next(m for m in final["messages"] if isinstance(m, AIMessage) and m.content != "تمام").content == blocks.content


def standard_mapped(classified, *, standard_failures=0, deep_failures=0):
    """A map whose ``standard`` and ``analysis`` entries are both non-default models; the default (quick) classifies."""
    from liwan_ai_service.routing import RunModels
    from liwan_ai_service.usage import ModelIdentity, RunModel
    from tests.fakes import IDENTITY

    def entry(model, name, capability):
        return RunModel(model, ModelIdentity("ollama", name, "platform", capability))

    default = ScriptedChatModel([ai_tool_call("pmo__list_my_tasks", {}, "d_1"), ai_text("من الأساسي")], route_responses=[ai_text(classified)])
    standard = FlakyChatModel([ai_tool_call("pmo__list_my_tasks", {}, "s_1"), ai_text("من القياسي")],
                              failures=[TRANSIENT("down") for _ in range(standard_failures)])
    deep = FlakyChatModel([ai_tool_call("pmo__list_my_tasks", {}, "a_1")], failures=[TRANSIENT("down") for _ in range(deep_failures)])
    run_models = RunModels(RunModel(default, IDENTITY), {"standard": entry(standard, "std", "standard"), "analysis": entry(deep, "deep", "analysis")})
    return default, standard, deep, BoundGraph(default, InMemorySaver(), run_models=run_models)


@pytest.mark.parametrize(("classified", "failing"), [("analysis", "deep"), ("standard", "standard")])
async def test_after_a_fallback_the_rest_of_the_message_stays_on_the_default_never_on_the_standard_model(classified, failing, no_waiting):
    default, standard, deep, graph = standard_mapped(classified, standard_failures=3, deep_failures=3)
    models = {"deep": deep, "standard": standard}
    await graph.ainvoke(new_request("حلل"), config("g1"))
    assert (await graph.aget_state(config("g1"))).values["on_default_model"] is True
    default.responses[:] = [ai_text("من الأساسي")]
    final = await graph.ainvoke(Command(resume=RESULT), config("g1"))  # a resume keeps the flag
    assert final["messages"][-1].content == "من الأساسي" and final["capability"] == classified
    assert models[failing].attempts == 3  # no retries on the failing model for the second plan call
    other = standard if failing == "deep" else deep
    assert other.attempts == 0 and len(default.calls) == 2  # the fallback call and the following one


async def test_the_next_message_classifies_again_and_uses_the_mapped_model_again(no_waiting):
    from langchain_core.messages import HumanMessage

    from liwan_ai_service.graph import continued_state

    default, standard, _deep, graph = standard_mapped("standard", standard_failures=3)
    first = await graph.ainvoke(new_request("مرحبا"), config("g2"))
    assert first["on_default_model"] is True
    default.route_responses.append(ai_text("standard"))
    default.responses[:] = []
    standard.responses[:] = [ai_text("من القياسي")]
    request = RunRequest.model_validate({"new_run_id": new_id(), "tenant": "t1", "user_ref": "42", "locale": "ar", "message": "ثاني", "context": None,
        "tools": [READ_TOOL], "agents": [PMO_AGENT], "limits": {"max_steps": 6, "max_tool_calls": 2, "timeout_seconds": 60}, "policy": PLATFORM_POLICY})
    second = await graph.ainvoke({"messages": [HumanMessage("ثاني")], **continued_state(request, first)}, config("g2"))
    assert second["on_default_model"] is False and second["messages"][-1].content == "من القياسي"
    assert len(default.route_calls) == 2


async def test_no_fallback_call_is_made_once_the_run_deadline_has_passed(no_waiting):
    import asyncio

    from liwan_ai_service.graph import DEADLINE_KEY

    default, standard, _deep, graph = standard_mapped("standard", standard_failures=3)  # the expired deadline also fails the classification: standard
    stream_config = config("g3")
    stream_config["configurable"][DEADLINE_KEY] = asyncio.get_running_loop().time() - 1
    events = []
    with pytest.raises(TRANSIENT):
        async for _mode, payload in graph.astream(new_request("حلل"), stream_config, stream_mode=["custom"]):
            events.append(payload)
    assert default.calls == [] and standard.attempts == 1  # the expired deadline also cuts the retries
    calls = [e for e in events if e["event"] == "model_call"]
    usages = [e for e in events if e["event"] == "model_usage"]
    assert [c["data"]["call_id"] for c in calls] == [u["data"]["call_id"] for u in usages]  # every call has its usage
    assert [u["data"]["outcome"] for u in usages][-1] == "failed"
