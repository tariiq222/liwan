"""The knowledge search tool inside the graph: candidates are found before the request leaves, unavailability never spends a call."""
import json

from langgraph.checkpoint.memory import InMemorySaver
from langgraph.types import Command

from liwan_ai_service.contracts import RunRequest, ToolResult
from liwan_ai_service.graph import RunKnowledge, initial_state, run_config
from liwan_ai_service.knowledge import Drained
from tests.fakes import PLATFORM_POLICY, BoundGraph, ScriptedChatModel, ai_text, ai_tool_call, new_id
from tests.test_contracts import PMO_AGENT, READ_TOOL

SEARCH_TOOL = {
    "name": "ai.search_knowledge",
    "kind": "read",
    "description": {"ar": "يبحث في المعرفة", "en": "Search company knowledge"},
    "input_schema": {"type": "object", "properties": {"query": {"type": "string", "minLength": 1, "maxLength": 500}},
                     "required": ["query"], "additionalProperties": False},
    "route": {"method": "POST", "path": "/api/v1/ai/knowledge/resolve"},
    "input_map": {"body": {"refs": "$refs"}},
    "result_summary": ["items[]"],
    "draft_target": None,
}
AI_AGENT = {**PMO_AGENT, "key": "ai", "pages": ["ai"]}  # a tool belongs to the agent its name starts with
REFS = [{"model": "project.task", "res_id": 7, "chunk_no": 0}, {"model": "crm.lead", "res_id": 3, "chunk_no": 1}]


class FakeStore:
    def __init__(self, refs=None, fail=False) -> None:
        self.refs, self.fail, self.searches = refs or [], fail, []

    async def search(self, company_id, query_vector, embed_model, limit=40):
        if self.fail:
            raise ConnectionError("postgresql://secret@db")
        self.searches.append((company_id, query_vector, embed_model, limit))
        return self.refs

    async def drain(self, embedder):
        return Drained()

    async def purge_expired(self):
        return 0


class FakeEmbedder:
    model_id = "fake:1"

    def __init__(self, fail=False) -> None:
        self.fail, self.queries = fail, []

    async def query(self, text):
        if self.fail:
            raise TimeoutError("sk-secret")
        self.queries.append(text)
        return [1.0, 0.0]

    async def documents(self, texts):
        return [[1.0, 0.0] for _ in texts]


def make(responses, tools=(SEARCH_TOOL, READ_TOOL)):
    model = ScriptedChatModel(responses)
    graph = BoundGraph(model, InMemorySaver())
    request = RunRequest.model_validate({
        "new_run_id": new_id(), "tenant": "t1", "user_ref": "42", "locale": "en", "message": "what is the Acme deal?", "context": None,
        "tools": list(tools), "agents": [PMO_AGENT, AI_AGENT], "company": "9",
        "limits": {"max_steps": 6, "max_tool_calls": 2, "timeout_seconds": 60}, "policy": PLATFORM_POLICY,
    })
    return model, graph, request


def config(thread, knowledge):
    return run_config(thread, 6, run_knowledge=knowledge)


async def pending(graph, thread, knowledge):
    state = await graph.aget_state(config(thread, knowledge))
    return [item.value for task in state.tasks for item in task.interrupts]


def last_tool_reply(model):
    return json.loads([m for m in model.calls[-1] if m.type == "tool"][-1].content)


async def test_candidates_ride_in_the_request_and_the_resolved_text_reaches_the_model():
    store, embedder = FakeStore(REFS), FakeEmbedder()
    knowledge = RunKnowledge(store, embedder, "9")
    model, graph, request = make([ai_tool_call("ai__search_knowledge", {"query": "Acme deal"}, "c_1"), ai_text("It is open.")])
    await graph.ainvoke(initial_state(request), config("k1", knowledge))
    [call] = await pending(graph, "k1", knowledge)
    assert call["tool"] == "ai.search_knowledge" and call["kind"] == "read"
    assert call["input"] == {"query": "Acme deal", "refs": REFS}
    assert store.searches == [(9, [1.0, 0.0], "fake:1", 40)] and embedder.queries == ["Acme deal"]  # the request's company, as a number
    items = {"items": [{"model": "crm.lead", "res_id": 3, "chunk_no": 1, "title": "Acme", "source": "CRM", "text": "open deal"}]}
    final = await graph.ainvoke(Command(resume=ToolResult(ok=True, data=items).model_dump()), config("k1", knowledge))
    assert final["outcome"] == "answer" and final["tool_calls_made"] == 1
    assert last_tool_reply(model) == items


async def test_no_candidate_answers_empty_without_a_request_or_a_tool_call():
    model, graph, request = make([ai_tool_call("ai__search_knowledge", {"query": "nothing"}, "c_1"), ai_text("Nothing found.")])
    final = await graph.ainvoke(initial_state(request), config("k2", RunKnowledge(FakeStore([]), FakeEmbedder(), "9")))
    assert await pending(graph, "k2", None) == []
    assert last_tool_reply(model) == {"items": []}
    assert final["tool_calls_made"] == 0 and final["outcome"] == "answer"


async def test_without_a_configured_search_the_tool_reports_unavailable_without_spending_a_call():
    model, graph, request = make([ai_tool_call("ai__search_knowledge", {"query": "x"}, "c_1"), ai_text("Cannot search.")])
    final = await graph.ainvoke(initial_state(request), config("k3", None))
    assert await pending(graph, "k3", None) == []
    assert last_tool_reply(model)["error"]["code"] == "knowledge_unavailable"
    assert final["tool_calls_made"] == 0


async def test_a_failing_embedder_or_store_or_a_missing_company_is_unavailability_not_a_crash(caplog):
    cases = [RunKnowledge(FakeStore(REFS), FakeEmbedder(fail=True), "9"), RunKnowledge(FakeStore(REFS, fail=True), FakeEmbedder(), "9"),
             RunKnowledge(FakeStore(REFS), FakeEmbedder(), None)]
    for index, knowledge in enumerate(cases):
        model, graph, request = make([ai_tool_call("ai__search_knowledge", {"query": "x"}, "c_1"), ai_text("Cannot search.")])
        final = await graph.ainvoke(initial_state(request), config(f"k4{index}", knowledge))
        assert last_tool_reply(model)["error"]["code"] == "knowledge_unavailable" and final["outcome"] == "answer"
    assert "sk-secret" not in caplog.text and "secret@db" not in caplog.text  # only the class of the failure is logged


async def test_a_tool_the_user_is_not_offered_is_never_searched():
    store = FakeStore(REFS)
    model, graph, request = make([ai_tool_call("ai__search_knowledge", {"query": "x"}, "c_1"), ai_text("No.")], tools=(READ_TOOL,))
    await graph.ainvoke(initial_state(request), config("k5", RunKnowledge(store, FakeEmbedder(), "9")))
    assert last_tool_reply(model)["error"]["code"] == "unknown_tool" and store.searches == []


async def test_invalid_arguments_are_refused_before_any_embedding():
    embedder = FakeEmbedder()
    model, graph, request = make([ai_tool_call("ai__search_knowledge", {"query": ""}, "c_1"), ai_text("Sorry.")])
    await graph.ainvoke(initial_state(request), config("k6", RunKnowledge(FakeStore(REFS), embedder, "9")))
    assert last_tool_reply(model)["error"]["code"] == "invalid_arguments" and embedder.queries == []


async def test_a_resume_never_searches_again_and_keeps_the_result_the_caller_already_executed():
    store, embedder = FakeStore(REFS), FakeEmbedder()
    knowledge = RunKnowledge(store, embedder, "9")
    model, graph, request = make([ai_tool_call("ai__search_knowledge", {"query": "Acme deal"}, "c_1"), ai_text("It is open.")])
    await graph.ainvoke(initial_state(request), config("k7", knowledge))
    [call] = await pending(graph, "k7", knowledge)
    assert call["input"]["refs"] == REFS
    stored = (await graph.aget_state(config("k7", knowledge))).values["knowledge"]
    assert stored == {"c_1": REFS}  # references only, in the checkpoint
    embedder.fail, store.fail = True, True  # by the time the caller answers, the provider and the database are down
    items = {"items": [{"model": "crm.lead", "res_id": 3, "chunk_no": 1, "title": "Acme", "source": "CRM", "text": "open deal"}]}
    final = await graph.ainvoke(Command(resume=ToolResult(ok=True, data=items).model_dump()), config("k7", knowledge))
    assert last_tool_reply(model) == items and final["outcome"] == "answer" and final["tool_calls_made"] == 1
    assert embedder.queries == ["Acme deal"] and len(store.searches) == 1  # searched exactly once
    assert final["results"] == [("ai.search_knowledge", items)]
