"""A minimal OpenAI-compatible server (POST /v1/chat/completions, stream=true) that enforces the real API's rules.

It exists to drive the real ``langchain_openai`` client through the service: the scripted chat model of ``fakes.py``
never meets the provider's rules, this server does. A request that the real API would reject gets an HTTP 400 with an
OpenAI-style error body, so a regression in tool-name encoding, message order or schema shape fails a test.

Enforced: bearer key and model, ``tools[].function.name`` matching ``^[a-zA-Z0-9_-]{1,64}$`` and unique, ``parameters``
an object schema, message roles, system messages only first, every ``tool_calls`` id answered by exactly one ``tool``
message before any other role (also at the end of the list), tool messages answering a pending id only, and assistant
tool-call names legal. The scripted reply must be a tool declared in the request, as the real model never invents one.

Streaming follows the real wire format: a role chunk, tool-call arguments split across chunks with ``index``/``id``/
``type``/``name`` on the first chunk only, a finish chunk (``tool_calls`` or ``stop``), an optional usage chunk, ``[DONE]``.

Standalone: ``python -m tests.fake_openai --port 9100 --scenario list_my_tasks``.
"""
from __future__ import annotations

import argparse
import json
import re
import time
from collections.abc import Iterator
from typing import Any

import uvicorn
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, StreamingResponse

from nasq_ai_service.titles import TITLE_RULES

LEGAL_NAME = re.compile(r"^[a-zA-Z0-9_-]{1,64}$")
ROLES = {"system", "user", "assistant", "tool"}
API_KEY = "sk-test"
MODEL = "gpt-test"
FAKE_TITLE = "مهام مفتوحة"


def is_title_request(messages: list[dict[str, Any]]) -> bool:
    return messages[0].get("role") == "system" and messages[0].get("content") == TITLE_RULES


def tool_turn(name: str, args: dict[str, Any], call_id: str) -> dict[str, Any]:
    return {"tool_call": {"name": name, "args": args, "id": call_id}}


def text_turn(text: str) -> dict[str, Any]:
    return {"text": text}


SCENARIOS: dict[str, list[dict[str, Any]]] = {
    "list_my_tasks": [tool_turn("pmo__list_my_tasks", {"limit": 5}, "call_fake_1"), text_turn("هذه مهامك المفتوحة الآن")],
}


class Invalid(Exception):
    def __init__(self, message: str, param: str | None = None) -> None:
        super().__init__(message)
        self.param = param


def validate_tools(tools: Any) -> list[str]:
    if tools is None:
        return []
    if not isinstance(tools, list) or len(tools) > 128:
        raise Invalid("'tools' must be an array of at most 128 items", "tools")
    names: list[str] = []
    for index, tool in enumerate(tools):
        where = f"tools[{index}]"
        function = tool.get("function") if isinstance(tool, dict) else None
        if not isinstance(tool, dict) or tool.get("type") != "function" or not isinstance(function, dict):
            raise Invalid(f"Invalid value for '{where}': expected a function tool", where)
        name = function.get("name")
        if not isinstance(name, str) or not LEGAL_NAME.match(name):
            raise Invalid(f"Invalid '{where}.function.name': string does not match pattern. Expected a string that matches the pattern '^[a-zA-Z0-9_-]+$'.", f"{where}.function.name")
        if name in names:
            raise Invalid(f"Duplicate function name '{name}'", f"{where}.function.name")
        if not isinstance(function.get("description", ""), str):
            raise Invalid(f"Invalid '{where}.function.description': expected a string", f"{where}.function.description")
        parameters = function.get("parameters")
        if not isinstance(parameters, dict) or parameters.get("type") != "object":
            raise Invalid(f"Invalid schema for function '{name}': schema must be a JSON Schema of 'type: \"object\"'.", f"{where}.function.parameters")
        names.append(name)
    return names


def validate_messages(messages: Any) -> None:
    if not isinstance(messages, list) or not messages:
        raise Invalid("'messages' must be a non-empty array", "messages")
    pending: set[str] = set()
    for index, message in enumerate(messages):
        where = f"messages[{index}]"
        role = message.get("role") if isinstance(message, dict) else None
        if role not in ROLES:
            raise Invalid(f"Invalid value for '{where}.role': {role!r}", f"{where}.role")
        if role == "system" and index != 0:
            raise Invalid(f"Invalid '{where}': system messages are only accepted first by this server", where)
        if pending and role != "tool":
            raise Invalid(f"An assistant message with 'tool_calls' must be followed by tool messages responding to each 'tool_call_id'. The following tool_call_ids did not have response messages: {', '.join(sorted(pending))}", where)
        if role == "tool":
            call_id = message.get("tool_call_id")
            if call_id not in pending:
                raise Invalid(f"Invalid parameter: messages with role 'tool' must be a response to a preceeding message with 'tool_calls' (tool_call_id {call_id!r}).", f"{where}.tool_call_id")
            if not isinstance(message.get("content"), str):
                raise Invalid(f"Invalid '{where}.content': expected a string", f"{where}.content")
            pending.discard(call_id)
        elif role == "assistant":
            calls = message.get("tool_calls") or []
            if not calls and not message.get("content"):
                raise Invalid(f"Invalid '{where}': an assistant message needs content or tool_calls", where)
            ids = [call.get("id") for call in calls]
            if len(set(ids)) != len(ids) or not all(isinstance(i, str) and i for i in ids):
                raise Invalid(f"Invalid '{where}.tool_calls': every call needs a unique string id", f"{where}.tool_calls")
            for call in calls:
                function = call.get("function") or {}
                if call.get("type") != "function" or not isinstance(function.get("arguments"), str) or not LEGAL_NAME.match(str(function.get("name"))):
                    raise Invalid(f"Invalid '{where}.tool_calls': a function call with a legal name and string arguments is expected", f"{where}.tool_calls")
            pending = set(ids)
        elif not isinstance(message.get("content"), str | list):
            raise Invalid(f"Invalid '{where}.content': expected a string or an array", f"{where}.content")
    if pending:
        raise Invalid(f"An assistant message with 'tool_calls' must be followed by tool messages responding to each 'tool_call_id'. The following tool_call_ids did not have response messages: {', '.join(sorted(pending))}", "messages")


def chunk(model: str, delta: dict[str, Any], finish: str | None = None, usage: dict[str, int] | None = None) -> str:
    body: dict[str, Any] = {
        "id": "chatcmpl-fake", "object": "chat.completion.chunk", "created": int(time.time()), "model": model,
        "choices": [] if usage else [{"index": 0, "delta": delta, "finish_reason": finish}],
    }
    if usage:
        body["usage"] = usage
    return f"data: {json.dumps(body, ensure_ascii=False)}\n\n"


def split_in(text: str, parts: int) -> list[str]:
    size = max(1, -(-len(text) // parts))
    return [text[i:i + size] for i in range(0, len(text), size)]


def stream_turn(model: str, turn: dict[str, Any], usage: bool) -> Iterator[str]:
    yield chunk(model, {"role": "assistant", "content": ""})
    if "tool_call" in turn:
        call = turn["tool_call"]
        pieces = split_in(json.dumps(call["args"], ensure_ascii=False), 3)
        yield chunk(model, {"tool_calls": [{"index": 0, "id": call["id"], "type": "function", "function": {"name": call["name"], "arguments": ""}}]})
        for piece in pieces:
            yield chunk(model, {"tool_calls": [{"index": 0, "function": {"arguments": piece}}]})
        finish = "tool_calls"
    else:
        for piece in split_in(turn["text"], 4):
            yield chunk(model, {"content": piece})
        finish = "stop"
    yield chunk(model, {}, finish)
    if usage:
        yield chunk(model, {}, usage={"prompt_tokens": 10, "completion_tokens": 5, "total_tokens": 15})
    yield "data: [DONE]\n\n"


def error(status: int, message: str, param: str | None = None, code: str | None = "invalid_request_error") -> JSONResponse:
    return JSONResponse({"error": {"message": message, "type": "invalid_request_error", "param": param, "code": code}}, status_code=status)


def create_fake_openai(scenario: list[dict[str, Any]]) -> FastAPI:
    """The server app. ``app.state.requests`` keeps every accepted turn's request body (``title_requests`` the title ones), ``app.state.headers`` the headers of each (same order), ``app.state.rejected`` every 400 message."""
    app = FastAPI(docs_url=None, redoc_url=None)
    app.state.requests = []
    app.state.headers = []
    app.state.rejected = []
    app.state.title_requests = []
    turns = list(scenario)

    @app.post("/v1/chat/completions", response_model=None)
    async def completions(request: Request):
        if request.headers.get("authorization") != f"Bearer {API_KEY}":
            return error(401, "Incorrect API key provided", code="invalid_api_key")
        body = await request.json()
        try:
            if body.get("model") != MODEL:
                raise Invalid(f"The model `{body.get('model')}` does not exist", "model")
            if body.get("stream") is not True:
                raise Invalid("this fake serves stream=true only", "stream")
            names = validate_tools(body.get("tools"))
            validate_messages(body.get("messages"))
        except Invalid as problem:
            app.state.rejected.append(str(problem))
            return error(400, str(problem), problem.param)
        usage = bool((body.get("stream_options") or {}).get("include_usage"))
        if is_title_request(body["messages"]):  # a title request is answered apart: it is not a turn of the scenario
            app.state.title_requests.append(body)
            return StreamingResponse(stream_turn(MODEL, text_turn(FAKE_TITLE), usage), media_type="text/event-stream")
        app.state.requests.append(body)
        app.state.headers.append(dict(request.headers))
        if not turns:
            return error(500, "the fake's scenario is exhausted", code="server_error")
        turn = turns.pop(0)
        if "tool_call" in turn and turn["tool_call"]["name"] not in names:
            return error(500, f"scripted tool {turn['tool_call']['name']!r} is not among the request's tools {names}", code="server_error")
        return StreamingResponse(stream_turn(MODEL, turn, usage), media_type="text/event-stream")

    return app


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=9100)
    parser.add_argument("--scenario", choices=sorted(SCENARIOS), default="list_my_tasks")
    args = parser.parse_args()
    uvicorn.run(create_fake_openai(SCENARIOS[args.scenario]), host="127.0.0.1", port=args.port, log_level="info")
