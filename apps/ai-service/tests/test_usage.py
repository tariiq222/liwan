"""Every provider attempt is reported: ``model_call`` before, ``model_usage`` after; plan calls retry transient failures."""
import asyncio
from dataclasses import replace
from datetime import UTC, datetime, timedelta
from email.utils import format_datetime

import httpx
import openai
import pytest
from langgraph.checkpoint.memory import InMemorySaver

from liwan_ai_service import service, usage
from liwan_ai_service.contracts import ModelCallEvent, ModelUsageEvent, RunRequest
from liwan_ai_service.errors import is_transient_provider_error
from liwan_ai_service.graph import initial_state, run_config
from liwan_ai_service.usage import ModelIdentity
from tests.fakes import (
    BoundGraph,
    FlakyChatModel,
    ScriptedChatModel,
    SlowChatModel,
    SlowTitleChatModel,
    ai_text,
    ai_usage,
    make_memory_app,
    new_id,
)
from tests.test_service import BODY, HEADERS, SETTINGS, fresh, parse_sse

REQUEST = httpx.Request("POST", "http://provider/v1/chat/completions")


def status_error(status: int, **headers: str) -> openai.APIStatusError:
    return openai.APIStatusError("scripted", response=httpx.Response(status, request=REQUEST, headers=headers), body=None)


def connection_error() -> openai.APIConnectionError:
    return openai.APIConnectionError(request=REQUEST)


@pytest.fixture(autouse=True)
def no_backoff(monkeypatch):
    monkeypatch.setattr(usage, "BACKOFF_SECONDS", (0.0, 0.0))


async def plan_events(model, *, timeout=None, deadline_in=None):
    """The ``(event, data)`` pairs the plan node writes for one run of the graph, and the error that ended it (or None)."""
    graph = BoundGraph(model, InMemorySaver())
    request = RunRequest.model_validate({**fresh(), "tools": []})
    deadline_at = None if deadline_in is None else asyncio.get_running_loop().time() + deadline_in
    events, error = [], None
    try:
        async with asyncio.timeout(timeout):
            async for mode, payload in graph.astream(initial_state(request), run_config(new_id(), 6, deadline_at), stream_mode=["custom", "messages"]):
                if mode == "custom":  # "messages" makes the model stream, as the service does
                    events.append((payload["event"], payload["data"]))
    except (Exception, TimeoutError) as caught:
        error = caught
    return events, error


def shape(events):
    return [(name, data.get("outcome", data.get("kind"))) for name, data in events]


async def test_a_successful_plan_call_reports_its_tokens():
    events, error = await plan_events(ScriptedChatModel([ai_usage(ai_text("تم"), 120, 7)]))
    assert error is None and shape(events) == [("model_call", "plan"), ("model_usage", "ok")]
    call, done = events[0][1], events[1][1]
    assert call["call_id"] == done["call_id"] and (done["input_tokens"], done["output_tokens"]) == (120, 7)
    assert ModelCallEvent.model_validate(call).provider == "ollama" and call["model"] == "m"
    assert ModelUsageEvent.model_validate(done).outcome == "ok"


async def test_a_reply_without_usage_reports_null_tokens():
    events, _ = await plan_events(ScriptedChatModel([ai_text("تم")]))
    assert events[1][1]["input_tokens"] is None and events[1][1]["output_tokens"] is None


async def test_a_429_is_retried_and_each_attempt_has_its_own_pair():
    model = FlakyChatModel([ai_usage(ai_text("تم"), 4, 2)], failures=[status_error(429)])
    events, error = await plan_events(model)
    assert error is None and model.attempts == 2
    assert shape(events) == [("model_call", "plan"), ("model_usage", "retried"), ("model_call", "plan"), ("model_usage", "ok")]
    assert events[0][1]["call_id"] == events[1][1]["call_id"] != events[2][1]["call_id"] == events[3][1]["call_id"]
    assert events[1][1]["input_tokens"] is None and events[3][1]["output_tokens"] == 2


async def test_a_400_fails_at_once_without_a_retry():
    model = FlakyChatModel([ai_text("never")], failures=[status_error(400)])
    events, error = await plan_events(model)
    assert isinstance(error, openai.APIStatusError) and model.attempts == 1
    assert shape(events) == [("model_call", "plan"), ("model_usage", "failed")]


async def test_three_transient_failures_give_retried_retried_failed():
    model = FlakyChatModel([ai_text("never")], failures=[status_error(500), connection_error(), status_error(503)])
    events, error = await plan_events(model)
    assert isinstance(error, openai.APIStatusError) and model.attempts == 3
    assert [data["outcome"] for name, data in events if name == "model_usage"] == ["retried", "retried", "failed"]
    assert len({data["call_id"] for _, data in events}) == 3


async def test_a_deadline_cut_leaves_an_unpaired_call():
    events, error = await plan_events(SlowChatModel([]), timeout=0.2)
    assert isinstance(error, TimeoutError) and shape(events) == [("model_call", "plan")]


@pytest.mark.parametrize(("error", "transient"), [
    (status_error(408), True), (status_error(409), True), (status_error(429), True), (status_error(500), True), (status_error(529), True),
    (status_error(400), False), (status_error(401), False), (status_error(404), False), (status_error(422), False),
    (connection_error(), True), (openai.APITimeoutError(request=REQUEST), True), (httpx.ConnectError("x"), True), (httpx.ConnectTimeout("x"), True),
    (httpx.ReadTimeout("x"), False), (RuntimeError("x"), False), (ValueError("x"), False),
])
def test_only_transient_provider_errors_are_retried(error, transient):
    assert is_transient_provider_error(error) is transient


def make_client(model):
    app = make_memory_app(model, SETTINGS)
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://ai")


def model_names(events):
    return [name for name, _ in events if name.startswith("model_")]


async def test_a_run_streams_its_plan_and_title_pairs_in_order():
    model = ScriptedChatModel([ai_usage(ai_text("عندك مهمة"), 50, 6)], title_responses=[ai_usage(ai_text("مهامي"), 20, 3)])
    async with make_client(model) as client:
        events = parse_sse((await client.post("/v1/runs", json=fresh(), headers=HEADERS)).text)
    names = [name for name, _ in events]
    assert names[0] == "run" and names[-1] == "done"
    assert names.index("model_call") < names.index("token") < names.index("model_usage") < names.index("answer")
    assert names[-4:] == ["answer", "model_call", "model_usage", "done"]
    assert model_names(events) == ["model_call", "model_usage", "model_call", "model_usage"]
    plan_call, plan_usage, title_call, title_usage = [data for name, data in events if name.startswith("model_")]
    assert plan_call["kind"] == "plan" and title_call["kind"] == "title" and title_call["provider"] == "ollama"
    assert plan_call["call_id"] == plan_usage["call_id"] and title_call["call_id"] == title_usage["call_id"] != plan_call["call_id"]
    assert (plan_usage["outcome"], plan_usage["input_tokens"], plan_usage["output_tokens"]) == ("ok", 50, 6)
    assert (title_usage["outcome"], title_usage["input_tokens"], title_usage["output_tokens"]) == ("ok", 20, 3)
    assert (plan_call["capability"], title_call["capability"]) == ("standard", "quick")
    assert all(item["cost"] is None and item["charge"] is None for item in (plan_usage, title_usage))  # no prices configured yet


async def test_a_title_that_times_out_is_aborted(monkeypatch):
    monkeypatch.setattr(service, "TITLE_TIMEOUT_SECONDS", 0.05)
    async with make_client(SlowTitleChatModel([ai_text("تم")])) as client:
        events = parse_sse((await client.post("/v1/runs", json=fresh(), headers=HEADERS)).text)
    title_usage = [data for name, data in events if name == "model_usage"][-1]
    assert (title_usage["outcome"], title_usage["input_tokens"], title_usage["output_tokens"]) == ("aborted", None, None)
    assert events[-1][1] == {"status": "done"}


async def test_a_title_that_errors_is_failed():
    async with make_client(ScriptedChatModel([ai_text("تم")])) as client:  # no title script: the title call raises
        events = parse_sse((await client.post("/v1/runs", json=fresh(), headers=HEADERS)).text)
    title_usage = [data for name, data in events if name == "model_usage"][-1]
    assert title_usage["outcome"] == "failed" and events[-1][1] == {"status": "done"}


async def test_a_title_is_not_retried():
    model = FlakyChatModel([ai_text("تم")])
    async with make_client(model) as client:
        events = parse_sse((await client.post("/v1/runs", json=fresh(), headers=HEADERS)).text)
    assert model_names(events).count("model_call") == 2 and len(model.title_calls) == 1


async def test_a_service_stream_retries_a_429_and_a_failed_plan_reports_its_failure_before_the_error():
    flaky = FlakyChatModel([ai_text("تم")], failures=[status_error(429)], title_responses=[ai_text("عنوان")])
    async with make_client(flaky) as client:
        events = parse_sse((await client.post("/v1/runs", json=fresh(), headers=HEADERS)).text)
    assert [d["outcome"] for n, d in events if n == "model_usage"] == ["retried", "ok", "ok"] and events[-1][1] == {"status": "done"}

    broken = FlakyChatModel([], failures=[status_error(400)])
    async with make_client(broken) as client:
        events = parse_sse((await client.post("/v1/runs", json=fresh(), headers=HEADERS)).text)
    names = [name for name, _ in events]
    assert names == ["run", "model_call", "model_usage", "error", "done"] and events[2][1]["outcome"] == "failed"
    assert events[-1][1] == {"status": "failed"}


async def test_a_run_needs_exactly_one_of_run_id_and_new_run_id():
    async with make_client(ScriptedChatModel([ai_text("x")] * 4)) as client:
        assert (await client.post("/v1/runs", json=BODY, headers=HEADERS)).status_code == 422
        both = {**fresh(), "run_id": "r_" + "ab" * 12}
        assert (await client.post("/v1/runs", json=both, headers=HEADERS)).status_code == 422
        assert (await client.post("/v1/runs", json={**fresh(), "new_run_id": "nope"}, headers=HEADERS)).status_code == 422


async def test_a_new_run_id_names_the_run_and_a_second_use_of_it_is_a_conflict():
    body = fresh()
    async with make_client(ScriptedChatModel([ai_text("x")] * 4)) as client:
        events = parse_sse((await client.post("/v1/runs", json=body, headers=HEADERS)).text)
        assert events[0] == ("run", {"run_id": body["new_run_id"]})
        again = await client.post("/v1/runs", json={**body, "message": "ثانية"}, headers=HEADERS)
        assert again.status_code == 409
        other_owner = await client.post("/v1/runs", json={**body, "user_ref": "7"}, headers={"X-Liwan-Tenant": "t1", "X-Liwan-User": "7"})
        assert other_owner.status_code == 409  # the run id is unique, not per user


async def test_an_empty_run_id_is_not_a_continuation_and_does_not_bypass_the_one_of_rule():
    async with make_client(ScriptedChatModel([ai_text("x")] * 2)) as client:
        assert (await client.post("/v1/runs", json={**BODY, "run_id": ""}, headers=HEADERS)).status_code == 422
        assert (await client.post("/v1/runs", json={**fresh(), "run_id": ""}, headers=HEADERS)).status_code == 422


@pytest.fixture
def sleeps(monkeypatch):
    waited = []

    async def record(seconds):
        waited.append(seconds)

    monkeypatch.setattr(usage.asyncio, "sleep", record)
    return waited


async def test_a_429_with_retry_after_waits_at_least_that_long_with_jitter(sleeps):
    model = FlakyChatModel([ai_text("تم")], failures=[status_error(429, **{"retry-after": "2"})])
    events, error = await plan_events(model)
    assert error is None and model.attempts == 2 and len(sleeps) == 1
    assert 2 <= sleeps[0] <= 2 * (1 + usage.JITTER)
    assert shape(events)[1] == ("model_usage", "retried")


async def test_without_retry_after_the_backoff_applies(sleeps, monkeypatch):
    monkeypatch.setattr(usage, "BACKOFF_SECONDS", (0.5, 1.0))
    model = FlakyChatModel([ai_text("تم")], failures=[status_error(503), status_error(503)])
    _, error = await plan_events(model)
    assert error is None and len(sleeps) == 2
    assert 0.5 <= sleeps[0] <= 0.5 * (1 + usage.JITTER) and 1.0 <= sleeps[1] <= 1.0 * (1 + usage.JITTER)


def test_retry_after_reads_seconds_and_http_dates_and_ignores_the_unreadable():
    now = datetime(2026, 10, 27, 10, 0, 0, tzinfo=UTC)
    assert usage.retry_after_seconds(status_error(429, **{"retry-after": "3"})) == 3
    assert usage.retry_after_seconds(status_error(429, **{"retry-after": "0.5"})) == 0.5
    assert usage.retry_after_seconds(status_error(429, **{"retry-after": format_datetime(now + timedelta(seconds=10), usegmt=True)}), now) == 10
    assert usage.retry_after_seconds(status_error(429, **{"retry-after": format_datetime(now - timedelta(seconds=10), usegmt=True)}), now) == 0
    for bad in ("soon", "", "nan", "-5"):
        assert usage.retry_after_seconds(status_error(429, **{"retry-after": bad})) in (None, 0)
    assert usage.retry_after_seconds(status_error(429)) is None
    assert usage.retry_after_seconds(RuntimeError("no response")) is None


def test_jitter_stays_within_its_bounds_and_actually_varies(monkeypatch):
    monkeypatch.setattr(usage, "BACKOFF_SECONDS", (1.0, 2.0))
    waits = [usage.retry_wait(RuntimeError("x"), 0) for _ in range(300)]
    assert all(1.0 <= wait <= 1.0 * (1 + usage.JITTER) for wait in waits) and len(set(waits)) > 100
    hinted = [usage.retry_wait(status_error(429, **{"retry-after": "5"}), 1) for _ in range(100)]
    assert all(5.0 <= wait <= 5.0 * (1 + usage.JITTER) for wait in hinted)


async def test_a_wait_that_would_pass_the_run_deadline_is_not_started(sleeps):
    model = FlakyChatModel([ai_text("never")], failures=[status_error(429, **{"retry-after": "30"})])
    events, error = await plan_events(model, deadline_in=5)
    assert isinstance(error, openai.APIStatusError) and model.attempts == 1 and sleeps == []
    assert shape(events) == [("model_call", "plan"), ("model_usage", "failed")]


async def test_a_backoff_longer_than_the_time_left_gives_up_but_a_shorter_one_retries(sleeps, monkeypatch):
    monkeypatch.setattr(usage, "BACKOFF_SECONDS", (0.5, 1.0))
    _, error = await plan_events(FlakyChatModel([ai_text("never")], failures=[status_error(500)]), deadline_in=0.1)
    assert isinstance(error, openai.APIStatusError) and sleeps == []
    _, error = await plan_events(FlakyChatModel([ai_text("تم")], failures=[status_error(500)]), deadline_in=60)
    assert error is None and len(sleeps) == 1


def test_cost_and_charge_are_integers_rounded_up():
    assert usage.call_cost((1_000, 0), 300_000, 1_500_000) == 300  # 1,000 input tokens at 3 USD per million
    assert usage.call_cost((1_000, 10), 300_000, 1_500_000) == 315
    assert usage.call_cost((1, 0), 1, 0) == 1  # 1 / 1,000,000 of a unit is rounded up
    assert usage.call_cost((0, 0), 300_000, 1_500_000) == 0
    assert usage.call_charge(300, 2_000) == 360 and usage.call_charge(1, 2_000) == 2 and usage.call_charge(0, 2_000) == 0
    assert usage.call_charge(300, 0) == 300


def test_cost_and_charge_are_null_without_tokens_or_a_price_and_zero_for_a_free_price():
    assert usage.call_cost((None, None), 300_000, 1_500_000) is None
    assert usage.call_cost((10, 10), None, 1_500_000) is None and usage.call_cost((10, 10), 300_000, None) is None
    assert usage.call_cost((10, 10), 0, 0) == 0 and usage.call_charge(usage.call_cost((10, 10), 0, 0), 2_000) == 0
    assert usage.call_charge(None, 2_000) is None


PRICED = {"input_units": 300_000, "output_units": 1_500_000, "margin_bps": 2_000}


@pytest.mark.parametrize(("billing", "cost", "charge"), [("platform", 300, 360), ("setup", 300, None), ("tenant_key", None, None)])
def test_a_usage_event_prices_the_call_by_who_pays(billing, cost, charge):
    identity = usage.ModelIdentity("ollama", "m", billing, **PRICED)
    data = usage.usage_event("ab" * 8, "ok", identity, (1_000, 0))["data"]
    assert (data["cost"], data["charge"]) == (cost, charge)


def test_a_usage_event_without_tokens_or_prices_carries_no_cost():
    priced = usage.ModelIdentity("ollama", "m", "platform", **PRICED)
    assert usage.usage_event("ab" * 8, "failed", priced)["data"]["cost"] is None
    unpriced = usage.ModelIdentity("ollama", "m", "platform")
    data = usage.usage_event("ab" * 8, "ok", unpriced, (1_000, 5))["data"]
    assert data["cost"] is None and data["charge"] is None and data["input_tokens"] == 1_000


def test_a_call_reports_the_capability_of_the_identity_it_runs_on():
    plain = usage.ModelIdentity("ollama", "m", "platform")
    assert plain.capability == "standard" and plain.margin_bps == 0 and plain.input_units is None
    assert usage.call_event("ab" * 8, "plan", plain)["data"]["capability"] == "standard"
    assert usage.call_event("ab" * 8, "plan", replace(plain, capability="analysis"))["data"]["capability"] == "analysis"
    assert usage.call_event("ab" * 8, "title", replace(plain, capability="quick"))["data"]["capability"] == "quick"


async def test_a_setup_run_reports_every_call_as_quick_and_billed_to_setup():
    async with make_client(ScriptedChatModel([ai_text("تم")], title_responses=[ai_text("مهامي")])) as client:
        body = {**fresh(), "policy": {**fresh()["policy"], "provider_mode": "setup"}}
        events = parse_sse((await client.post("/v1/runs", json=body, headers=HEADERS)).text)
    calls = [data for name, data in events if name == "model_call"]
    assert [(call["kind"], call["capability"], call["billing"]) for call in calls] == [("plan", "quick", "setup"), ("title", "quick", "setup")]


async def test_a_priced_run_reports_cost_and_charge_on_its_plan_and_title_calls():
    identity = usage.ModelIdentity("ollama", "m", "platform", **PRICED)
    graph = BoundGraph(ScriptedChatModel([ai_usage(ai_text("تم"), 1_000, 10)]), InMemorySaver(), identity)
    request = RunRequest.model_validate({**fresh(), "tools": []})
    events = [payload async for mode, payload in graph.astream(initial_state(request), run_config(new_id(), 6, None), stream_mode=["custom"]) if mode == "custom"]
    done = events[1]["data"]
    assert events[0]["data"]["capability"] == "standard" and (done["cost"], done["charge"]) == (315, 378)


def test_a_model_identity_refuses_prices_and_margins_that_are_not_counts():
    for bad in ({"input_units": -1}, {"output_units": 1.5}, {"input_units": True}, {"margin_bps": -1}, {"margin_bps": None}, {"margin_bps": 0.5}):
        with pytest.raises(ValueError):
            usage.ModelIdentity("ollama", "m", "platform", **bad)
    assert usage.ModelIdentity("ollama", "m", "platform", input_units=0, output_units=0).margin_bps == 0


def test_a_cost_or_charge_above_the_shared_maximum_is_null_and_logged(caplog):
    huge = usage.ModelIdentity("ollama", "m", "platform", input_units=300_000_000, output_units=0, margin_bps=0)
    assert usage.call_cost((100_000_000, 0), 300_000_000, 0) is None
    with caplog.at_level("WARNING", logger="liwan_ai_service"):
        data = usage.usage_event("ab" * 8, "ok", huge, (100_000_000, 0))["data"]
    assert data["cost"] is None and data["charge"] is None and "ollama/m" in caplog.text
    caplog.clear()
    edge = usage.ModelIdentity("ollama", "m", "platform", input_units=2_000_000_000, output_units=0, margin_bps=2_000)  # cost fits, charge does not
    with caplog.at_level("WARNING", logger="liwan_ai_service"):
        data = usage.usage_event("ab" * 8, "ok", edge, (1_000_000, 0))["data"]
    assert (data["cost"], data["charge"]) == (2_000_000_000, None) and "ollama/m" in caplog.text


async def test_a_run_whose_price_overflows_still_answers():
    identity = usage.ModelIdentity("ollama", "m", "platform", input_units=300_000_000, output_units=0)
    model = ScriptedChatModel([ai_usage(ai_text("تم"), 100_000_000, 1)])
    emitted = []
    answer = await usage.invoke_planned(model, [], identity, emitted.append)
    assert answer.content == "تم"
    done = [item["data"] for item in emitted if item["event"] == "model_usage"][0]
    assert done["outcome"] == "ok" and done["cost"] is None and done["charge"] is None


def test_an_identity_carries_a_cached_input_price_and_refuses_a_negative_one():
    assert ModelIdentity("openai", "m", "platform", cached_input_units=125_000).cached_input_units == 125_000
    assert ModelIdentity("openai", "m", "platform").cached_input_units is None
    with pytest.raises(ValueError, match="cached_input_units"):
        ModelIdentity("openai", "m", "platform", cached_input_units=-1)
