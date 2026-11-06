"""The service side of knowledge: the request carries the search, and the background drain is fenced like any other work."""
from dataclasses import replace

import httpx

from liwan_ai_service.control import MemoryControlState
from liwan_ai_service.knowledge import QUEUE_MAX_AGE_HOURS, Drained
from liwan_ai_service.tenant_state import TenantState
from tests.fakes import ScriptedChatModel, SeededStates, ai_text, ai_tool_call, make_memory_app
from tests.test_knowledge_graph import AI_AGENT, REFS, SEARCH_TOOL, FakeEmbedder, FakeStore
from tests.test_service import BODY, HEADERS, SETTINGS, fresh, parse_sse


class KnowledgeStates(SeededStates):
    def __init__(self, knowledge) -> None:
        super().__init__()
        self.knowledge = knowledge

    def _memory_state(self, database: str) -> TenantState:
        state = super()._memory_state(database)
        return TenantState(state.database, state.store, state.graph, state.config, state.memory, self.knowledge)


async def serve_tenant(app):
    """The in-memory directory knows a tenant once a request named it."""
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://ai") as client:
        await client.get("/v1/runs", headers=HEADERS)


class CountingStore(FakeStore):
    def __init__(self, refs=None) -> None:
        super().__init__(refs)
        self.drains, self.purges, self.purged = 0, 0, 0

    async def drain(self, embedder):
        self.drains += 1
        return Drained(3, self.dropped)

    async def purge_expired(self):
        self.purges += 1
        return self.purged

    dropped = 0


def knowledge_body():
    from tests.test_contracts import PMO_AGENT

    return {**BODY, "tools": [SEARCH_TOOL], "agents": [PMO_AGENT, AI_AGENT], "company": "9"}


def app_for(store, embedder, settings=SETTINGS, control=None):
    model = ScriptedChatModel([ai_tool_call("ai__search_knowledge", {"query": "Acme"}, "c_1"), ai_text("done")])
    return make_memory_app(model, settings, states=KnowledgeStates(store), control=control, embedder=embedder)


async def test_a_run_searches_the_tenants_index_for_the_requests_company():
    store, embedder = CountingStore(REFS), FakeEmbedder()
    app = app_for(store, embedder)
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://ai") as client:
        events = parse_sse((await client.post("/v1/runs", json=fresh(knowledge_body()), headers=HEADERS)).text)
        request = dict(events)["tool_request"]
        assert request["tool"] == "ai.search_knowledge" and request["input"] == {"query": "Acme", "refs": REFS}
        assert store.searches[0][0] == 9


async def test_without_an_embedder_the_search_is_unavailable_and_the_tick_only_purges():
    store = CountingStore(REFS)
    store.purged = 2
    app = app_for(store, None)
    await serve_tenant(app)
    assert await app.state.drain_knowledge() == 0 and store.drains == 0 and store.purges == 1
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://ai") as client:
        events = parse_sse((await client.post("/v1/runs", json=fresh(knowledge_body()), headers=HEADERS)).text)
        assert "tool_request" not in dict(events) and events[-1][1] == {"status": "done"} and store.searches == []


async def test_the_drain_indexes_every_tenant_with_an_index_and_counts_as_local_work():
    store = CountingStore()
    app = app_for(store, FakeEmbedder())
    await serve_tenant(app)
    assert await app.state.drain_knowledge() == 3 and store.drains == 1 and store.purges == 1  # every tick also purges
    # memory-state tenants have no index: nothing to drain, nothing fails
    plain = make_memory_app(ScriptedChatModel([]), SETTINGS, embedder=FakeEmbedder())
    await serve_tenant(plain)
    assert await plain.state.drain_knowledge() == 0


async def test_a_draining_generation_leaves_the_queue_to_the_accepting_one():
    store, control = CountingStore(), MemoryControlState()
    app = app_for(store, FakeEmbedder(), replace(SETTINGS, generation_id="old-ai"), control)
    await serve_tenant(app)
    await control.drain_generation("old-ai")
    assert await app.state.drain_knowledge() == 0 and store.drains == 0 and store.purges == 0


async def test_one_tenants_failing_drain_is_logged_by_class_and_never_raised(caplog):
    class Failing(CountingStore):
        async def drain(self, embedder):
            raise ConnectionError("postgresql://secret@db sk-secret")

    app = app_for(Failing(), FakeEmbedder())
    await serve_tenant(app)
    assert await app.state.drain_knowledge() == 0
    assert "ConnectionError" in caplog.text and "sk-secret" not in caplog.text


async def test_the_tick_logs_what_it_purged_and_what_the_embedder_refused(caplog):
    store = CountingStore()
    store.purged, store.dropped = 4, 1
    app = app_for(store, FakeEmbedder())
    await serve_tenant(app)
    await app.state.drain_knowledge()
    assert f"4 rows older than {QUEUE_MAX_AGE_HOURS} hours were deleted" in caplog.text
    assert "1 records refused by the embedder were dropped" in caplog.text


async def test_a_failing_drain_does_not_skip_the_purge():
    class Failing(CountingStore):
        async def drain(self, embedder):
            raise ConnectionError("down")

    store = Failing()
    app = app_for(store, FakeEmbedder())
    await serve_tenant(app)
    assert await app.state.drain_knowledge() == 0 and store.purges == 1
