"""The service with the REAL langchain_openai client against a local server that enforces the OpenAI API rules (fake_openai.py)."""
import socket
import threading
import time

import httpx
import pytest
import uvicorn
from langgraph.checkpoint.memory import InMemorySaver

from tests.fake_openai import FAKE_TITLE, LEGAL_NAME, create_fake_openai, failure_turn, text_turn, tool_turn
from tests.test_service import BODY, HEADERS, fresh, parse_sse
from webvue_ai_service import graph, usage
from webvue_ai_service.providers import build_chat_model
from webvue_ai_service.service import create_app
from webvue_ai_service.settings import Settings
from webvue_ai_service.store import MemoryRunStore

TASKS = {"ok": True, "data": {"items": [{"id": 5, "name": "تقرير"}], "total": 1}}


@pytest.fixture
def serve_fake():
    """Start the fake on a free local port in a thread; returns ``(fake_app, base_url)`` for a scenario."""
    servers = []

    def start(scenario):
        fake = create_fake_openai(scenario)
        with socket.socket() as probe:
            probe.bind(("127.0.0.1", 0))
            port = probe.getsockname()[1]
        server = uvicorn.Server(uvicorn.Config(fake, host="127.0.0.1", port=port, log_level="warning"))
        thread = threading.Thread(target=server.run, daemon=True)
        thread.start()
        deadline = time.monotonic() + 10
        while not server.started:
            assert time.monotonic() < deadline, "the fake OpenAI server did not start"
            time.sleep(0.02)
        servers.append((server, thread))
        return fake, f"http://127.0.0.1:{port}/v1"

    yield start
    for server, thread in servers:
        server.should_exit = True
        thread.join(timeout=10)


def service_client(base_url, provider="openai", **extra):
    settings = Settings.from_env({"AI_PROVIDER": provider, "AI_MODEL": "gpt-test", "AI_API_KEY": "sk-test", "AI_BASE_URL": base_url, "AI_ALLOW_MEMORY_STATE": "true", **extra})
    app = create_app(build_chat_model(settings), MemoryRunStore(), InMemorySaver(), settings)
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://ai")


def tool_names(request_body):
    return [tool["function"]["name"] for tool in request_body["tools"]]


async def test_dotted_tool_name_goes_out_legal_and_comes_back_dotted_with_parsed_arguments(serve_fake):
    fake, base_url = serve_fake([tool_turn("pmo__list_my_tasks", {"limit": 5}, "call_a1")])
    async with service_client(base_url) as client:
        events = parse_sse((await client.post("/v1/runs", json=fresh(), headers=HEADERS)).text)
    assert fake.state.rejected == []
    assert tool_names(fake.state.requests[0]) == ["pmo__list_my_tasks", "pmo__draft_project"]
    request = dict(events)["tool_request"]
    assert request["tool"] == "pmo.list_my_tasks" and request["call_id"] == "call_a1" and request["input"] == {"limit": 5}
    assert events[-1][1] == {"status": "waiting_tool"}


async def test_resume_streams_tokens_and_the_answer_string_and_sends_a_valid_follow_up(serve_fake):
    fake, base_url = serve_fake([tool_turn("pmo__list_my_tasks", {"limit": 5}, "call_a1"), text_turn("عندك مهمة واحدة: تقرير")])
    async with service_client(base_url) as client:
        run_id = parse_sse((await client.post("/v1/runs", json=fresh(), headers=HEADERS)).text)[0][1]["run_id"]
        events = parse_sse((await client.post(f"/v1/runs/{run_id}/resume", json={"call_id": "call_a1", "result": TASKS}, headers=HEADERS)).text)
        assert [item["title"] for item in (await client.get("/v1/runs", headers=HEADERS)).json()["items"]] == [FAKE_TITLE]
    tokens = [data["text"] for name, data in events if name == "token"]
    assert len(tokens) > 1 and "".join(tokens) == "عندك مهمة واحدة: تقرير"
    answer = dict(events)["answer"]
    assert isinstance(answer["text"], str) and answer["text"] == "عندك مهمة واحدة: تقرير" and answer["records"] == [{"type": "task", "id": 5, "label": "تقرير"}]
    assert events[-1][1] == {"status": "done"} and fake.state.rejected == []
    assert len(fake.state.title_requests) == 1  # the real client's title request is legal for the API and is not a turn of the run
    follow_up = fake.state.requests[1]["messages"]
    assert [m["role"] for m in follow_up] == ["system", "user", "assistant", "tool"]
    assert follow_up[2]["tool_calls"][0]["function"]["name"] == "pmo__list_my_tasks" and follow_up[3]["tool_call_id"] == "call_a1"


async def test_a_continuation_after_the_tool_limit_passes_the_providers_message_order_rules(serve_fake):
    fake, base_url = serve_fake([tool_turn("pmo__list_my_tasks", {}, f"call_{i}") for i in range(1, 4)] + [text_turn("من جديد")])
    async with service_client(base_url) as client:
        run_id = parse_sse((await client.post("/v1/runs", json=fresh(), headers=HEADERS)).text)[0][1]["run_id"]
        for call in ("call_1", "call_2"):
            events = parse_sse((await client.post(f"/v1/runs/{run_id}/resume", json={"call_id": call, "result": {"ok": True, "data": {}}}, headers=HEADERS)).text)
        assert events[-1][1] == {"status": "limit_reached"}
        events = parse_sse((await client.post("/v1/runs", json={**BODY, "run_id": run_id, "message": "كمّل"}, headers=HEADERS)).text)
    assert events[-1][1] == {"status": "done"} and dict(events)["answer"]["text"] == "من جديد"
    assert fake.state.rejected == []
    roles = [m["role"] for m in fake.state.requests[-1]["messages"]]
    assert roles == ["system", "user", "assistant", "tool", "assistant", "tool", "assistant", "tool", "user"]


async def test_openrouter_sends_the_bearer_legal_tool_names_and_attribution_headers(serve_fake):
    fake, base_url = serve_fake([tool_turn("pmo__list_my_tasks", {"limit": 5}, "call_a1")])
    async with service_client(base_url, "openrouter", AI_OPENROUTER_REFERER="https://webvue.example", AI_OPENROUTER_TITLE="WebVue") as client:
        events = parse_sse((await client.post("/v1/runs", json=fresh(), headers=HEADERS)).text)
    assert fake.state.rejected == [] and events[-1][1] == {"status": "waiting_tool"}
    assert tool_names(fake.state.requests[0]) == ["pmo__list_my_tasks", "pmo__draft_project"]
    headers = fake.state.headers[0]
    assert headers["authorization"] == "Bearer sk-test"
    assert headers["http-referer"] == "https://webvue.example" and headers["x-title"] == "WebVue"


async def test_openrouter_without_attribution_variables_sends_neither_header(serve_fake):
    fake, base_url = serve_fake([text_turn("تمام")])
    async with service_client(base_url, "openrouter") as client:
        await client.post("/v1/runs", json=fresh(), headers=HEADERS)
    assert fake.state.rejected == [] and "http-referer" not in fake.state.headers[0] and "x-title" not in fake.state.headers[0]


async def test_every_tool_name_the_service_sends_is_legal(serve_fake):
    fake, base_url = serve_fake([text_turn("تمام")])
    async with service_client(base_url) as client:
        await client.post("/v1/runs", json=fresh(), headers=HEADERS)
    assert fake.state.rejected == [] and all(LEGAL_NAME.match(name) for name in tool_names(fake.state.requests[0]))


async def test_the_fake_would_catch_the_dotted_name_bug(serve_fake, monkeypatch):
    monkeypatch.setattr(graph, "encode_tool_name", lambda name: name)  # the earlier bug: dotted names sent as they are
    fake, base_url = serve_fake([text_turn("never reached")])
    async with service_client(base_url) as client:
        events = parse_sse((await client.post("/v1/runs", json=fresh(), headers=HEADERS)).text)
    assert events[-1][1] == {"status": "failed"} and "error" in dict(events)
    assert len(fake.state.rejected) == 1 and "function.name" in fake.state.rejected[0]


LEGAL_TOOL = {"type": "function", "function": {"name": "a__b", "description": "d", "parameters": {"type": "object", "properties": {}}}}
CALL = {"id": "c1", "type": "function", "function": {"name": "a__b", "arguments": "{}"}}


@pytest.mark.parametrize(("body", "needle"), [
    ({"tools": [{**LEGAL_TOOL, "function": {**LEGAL_TOOL["function"], "name": "pmo.list"}}]}, "function.name"),
    ({"tools": [{**LEGAL_TOOL, "function": {**LEGAL_TOOL["function"], "name": "x" * 65}}]}, "function.name"),
    ({"tools": [{**LEGAL_TOOL, "function": {**LEGAL_TOOL["function"], "parameters": {"type": "array"}}}]}, "function.parameters"),
    ({"tools": [{**LEGAL_TOOL, "function": {k: v for k, v in LEGAL_TOOL["function"].items() if k != "parameters"}}]}, "function.parameters"),
    ({"messages": [{"role": "user", "content": "hi"}, {"role": "system", "content": "late"}]}, "system"),
    ({"messages": [{"role": "user", "content": "hi"}, {"role": "assistant", "content": None, "tool_calls": [CALL]}]}, "did not have response"),
    ({"messages": [{"role": "user", "content": "hi"}, {"role": "assistant", "content": None, "tool_calls": [CALL]}, {"role": "user", "content": "again"}]}, "did not have response"),
    ({"messages": [{"role": "user", "content": "hi"}, {"role": "tool", "tool_call_id": "c1", "content": "{}"}]}, "preceeding"),
    ({"messages": [{"role": "user", "content": "hi"}, {"role": "assistant", "content": None, "tool_calls": [CALL]}, {"role": "tool", "tool_call_id": "c1", "content": "{}"},
                   {"role": "tool", "tool_call_id": "c1", "content": "{}"}]}, "preceeding"),
])
async def test_the_fake_answers_400_in_the_openai_error_shape_for_what_the_real_api_rejects(serve_fake, body, needle):
    fake, base_url = serve_fake([text_turn("ok")])
    valid = {"model": "gpt-test", "stream": True, "tools": [LEGAL_TOOL], "messages": [{"role": "user", "content": "hi"}]}
    async with httpx.AsyncClient(base_url=base_url, headers={"authorization": "Bearer sk-test"}) as client:
        response = await client.post("/chat/completions", json={**valid, **body})
    assert response.status_code == 400
    error = response.json()["error"]
    assert error["type"] == "invalid_request_error" and needle in error["message"] + str(error["param"])
    assert fake.state.requests == []


async def test_each_plan_attempt_is_one_http_request_and_its_usage_comes_from_the_stream(serve_fake, monkeypatch):
    monkeypatch.setattr(usage, "BACKOFF_SECONDS", (0.0, 0.0))
    fake, base_url = serve_fake([failure_turn(429), failure_turn(503), text_turn("تمام")])
    async with service_client(base_url, "openrouter") as client:  # OpenRouter always asks for the usage chunk, whatever the test's base URL
        events = parse_sse((await client.post("/v1/runs", json=fresh(), headers=HEADERS)).text)
    assert fake.state.attempts == 3 and len(fake.state.requests) == 1  # the SDK adds no retry of its own (max_retries=0)
    usages = [data for name, data in events if name == "model_usage"]
    assert [item["outcome"] for item in usages] == ["retried", "retried", "ok", "ok"]  # three plan attempts, then the title
    assert (usages[2]["input_tokens"], usages[2]["output_tokens"]) == (10, 5) and (usages[3]["input_tokens"], usages[3]["output_tokens"]) == (10, 5)
    assert events[-1][1] == {"status": "done"}


async def test_a_provider_400_is_one_request_and_a_failed_call(serve_fake):
    fake, base_url = serve_fake([failure_turn(400)])
    async with service_client(base_url) as client:
        events = parse_sse((await client.post("/v1/runs", json=fresh(), headers=HEADERS)).text)
    assert fake.state.attempts == 1
    assert [data["outcome"] for name, data in events if name == "model_usage"] == ["failed"] and events[-1][1] == {"status": "failed"}


async def test_a_custom_openai_base_url_is_not_sent_stream_options_so_its_tokens_are_null(serve_fake):
    fake, base_url = serve_fake([text_turn("تمام")])
    async with service_client(base_url) as client:
        events = parse_sse((await client.post("/v1/runs", json=fresh(), headers=HEADERS)).text)
    usages = [data for name, data in events if name == "model_usage"]
    assert fake.state.rejected == [] and [item["outcome"] for item in usages] == ["ok", "ok"]
    assert all(item["input_tokens"] is None and item["output_tokens"] is None for item in usages)
