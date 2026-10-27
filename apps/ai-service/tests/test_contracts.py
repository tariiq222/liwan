import pytest
from pydantic import ValidationError

from webvue_ai_service.contracts import ModelCallEvent, ModelUsageEvent, ResumeRequest, RunRequest, ToolSpec

READ_TOOL = {
    "name": "pmo.list_my_tasks",
    "kind": "read",
    "description": {"ar": "يعرض مهامي", "en": "List my tasks"},
    "input_schema": {"type": "object", "properties": {"limit": {"type": "integer"}}, "additionalProperties": False},
    "route": {"method": "GET", "path": "/api/v1/tasks"},
    "input_map": {"query": {"filter": "mine", "limit": "$limit"}},
    "result_summary": ["items[].id", "items[].name", "total"],
    "draft_target": None,
}
DRAFT_TOOL = {
    "name": "pmo.draft_project",
    "kind": "draft",
    "description": {"ar": "مسودة مشروع", "en": "Project draft"},
    "input_schema": {"type": "object", "properties": {"name": {"type": "string"}}, "required": ["name"]},
    "route": None,
    "input_map": {},
    "result_summary": [],
    "draft_target": "/projects/new",
}


def run_request(**overrides):
    body = {
        "tenant": "t1", "user_ref": "42", "locale": "ar", "message": "وش مهامي؟",
        "context": None, "tools": [READ_TOOL, DRAFT_TOOL],
        "limits": {"max_steps": 12, "max_tool_calls": 8, "timeout_seconds": 120}, "new_run_id": "r_" + "ab" * 12,
    }
    body.update(overrides)
    return RunRequest.model_validate(body)


def test_run_request_accepts_the_contract_shape():
    request = run_request()
    assert [tool.name for tool in request.tools] == ["pmo.list_my_tasks", "pmo.draft_project"]
    assert request.tools[0].route.method == "GET"
    assert request.tools[1].draft_target == "/projects/new"
    assert request.limits.max_tool_calls == 8


def test_tool_kind_and_name_are_validated():
    with pytest.raises(ValidationError):
        ToolSpec.model_validate({**READ_TOOL, "kind": "delete"})
    with pytest.raises(ValidationError):
        ToolSpec.model_validate({**READ_TOOL, "name": "ListMyTasks"})


def test_read_tool_needs_a_route_and_draft_needs_a_target():
    with pytest.raises(ValidationError):
        ToolSpec.model_validate({**READ_TOOL, "route": None})
    with pytest.raises(ValidationError):
        ToolSpec.model_validate({**DRAFT_TOOL, "draft_target": None})


def test_locale_is_ar_or_en_and_message_is_bounded():
    with pytest.raises(ValidationError):
        run_request(locale="fr")
    with pytest.raises(ValidationError):
        run_request(message="")
    with pytest.raises(ValidationError):
        run_request(message="x" * 8001)


def test_resume_request_shapes():
    ok = ResumeRequest.model_validate({"call_id": "c_1", "result": {"ok": True, "data": {"items": [], "total": 0}}})
    assert ok.result.ok is True and ok.result.data == {"items": [], "total": 0}
    denied = ResumeRequest.model_validate({"call_id": "c_1", "result": {"ok": False, "error": {"code": "forbidden", "message": "no"}}})
    assert denied.result.error.code == "forbidden"
    rejected = ResumeRequest.model_validate({"call_id": "c_2", "result": {"ok": False, "decision": "rejected"}})
    assert rejected.result.decision == "rejected"
    with pytest.raises(ValidationError):
        ResumeRequest.model_validate({"call_id": "c_1", "result": {"ok": False}})


def test_tool_input_schema_must_be_a_valid_json_schema():
    with pytest.raises(ValidationError, match="valid JSON Schema"):
        ToolSpec.model_validate({**READ_TOOL, "input_schema": {"type": "object", "properties": {"limit": {"type": "no-such-type"}}}})


def test_tool_names_must_be_unique_and_survive_provider_encoding():
    with pytest.raises(ValidationError, match="unique"):
        run_request(tools=[READ_TOOL, READ_TOOL])
    a = {**READ_TOOL, "name": "a.b__c"}
    b = {**READ_TOOL, "name": "a__b.c"}
    with pytest.raises(ValidationError, match="collide"):
        run_request(tools=[a, b])


def test_tool_list_and_name_length_are_capped():
    many = [{**READ_TOOL, "name": f"pmo.tool_{i}"} for i in range(101)]
    with pytest.raises(ValidationError):
        run_request(tools=many)
    run_request(tools=many[:100])
    with pytest.raises(ValidationError):
        ToolSpec.model_validate({**READ_TOOL, "name": "pmo." + "a" * 60})


@pytest.mark.parametrize("page", ["Project", "1page", "a b", "x" * 41, "", "pa/ge"])
def test_context_page_is_a_slug(page):
    with pytest.raises(ValidationError):
        run_request(context={"page": page})


def test_context_page_accepts_slugs():
    assert run_request(context={"page": "project-detail", "id": 3}).context.page == "project-detail"


def test_tool_result_data_is_capped_at_200_kb():
    with pytest.raises(ValidationError, match="exceeds"):
        ResumeRequest.model_validate({"call_id": "c_1", "result": {"ok": True, "data": {"blob": "x" * (200 * 1024)}}})
    ResumeRequest.model_validate({"call_id": "c_1", "result": {"ok": True, "data": {"blob": "x" * 1000}}})


def test_a_request_names_exactly_one_run():
    for overrides in ({"new_run_id": None}, {"run_id": "r_" + "cd" * 12}):
        with pytest.raises(ValidationError):
            run_request(**overrides)
    assert run_request(new_run_id=None, run_id="r_" + "cd" * 12).run_id == "r_" + "cd" * 12


def test_a_new_run_id_has_the_service_shape():
    for bad in ("r_abc", "R_" + "ab" * 12, "r_" + "zz" * 12, "r_" + "ab" * 13):
        with pytest.raises(ValidationError):
            run_request(new_run_id=bad)


def test_model_events_are_strict_and_pair_their_tokens():
    call = {"call_id": "ab" * 8, "kind": "plan", "provider": "openrouter", "model": "anthropic/claude-sonnet-4.5", "called_at": "2026-10-27T10:00:00Z"}
    assert ModelCallEvent.model_validate(call).kind == "plan"
    for bad in ({"kind": "other"}, {"provider": "Open AI"}, {"model": ""}, {"model": "a\nb"}, {"call_id": "xyz"}, {"called_at": "2026-10-27T10:00:00"}, {"extra": 1}):
        with pytest.raises(ValidationError):
            ModelCallEvent.model_validate({**call, **bad})
    usage = {"call_id": "ab" * 8, "outcome": "ok", "input_tokens": 3, "output_tokens": 5}
    assert ModelUsageEvent.model_validate(usage).output_tokens == 5
    assert ModelUsageEvent.model_validate({**usage, "input_tokens": None, "output_tokens": None}).input_tokens is None
    for bad in ({"output_tokens": None}, {"input_tokens": -1}, {"outcome": "lost"}, {"output_tokens": 100_000_001}):
        with pytest.raises(ValidationError):
            ModelUsageEvent.model_validate({**usage, **bad})
