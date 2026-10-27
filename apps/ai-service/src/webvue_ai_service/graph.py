"""The one agent graph: plan → request one tool (interrupt) → plan … → answer.

The graph executes nothing. A tool request is an ``interrupt`` whose value is the
request payload; the caller resumes with a ``ToolResult``. Limits come from the
run request and stop the graph with ``outcome = 'limit_reached'``.
"""
from __future__ import annotations

import json
from typing import Annotated, Any, Literal, TypedDict

import jsonschema
from langchain_core.language_models import BaseChatModel
from langchain_core.messages import AIMessage, HumanMessage, SystemMessage, ToolMessage
from langchain_core.runnables import RunnableConfig
from langgraph.config import get_stream_writer
from langgraph.graph import END, START, StateGraph
from langgraph.graph.message import add_messages
from langgraph.types import interrupt

from webvue_ai_service.contracts import RunContext, RunRequest, ToolResult, ToolSpec, encode_tool_name
from webvue_ai_service.prompts import system_prompt, tool_summary
from webvue_ai_service.usage import ModelIdentity, invoke_planned


class AgentState(TypedDict):
    messages: Annotated[list, add_messages]
    tools: list[dict[str, Any]]
    limits: dict[str, int]
    locale: str
    context: dict[str, Any] | None
    tool_calls_made: int
    steps: int
    results: list[tuple[str, dict[str, Any]]]
    outcome: str | None


def request_state(request: RunRequest) -> dict[str, Any]:
    """The per-request part of the state: what a new run starts with and a continued run is refreshed with."""
    return {
        "tools": [tool.model_dump() for tool in request.tools],
        "limits": request.limits.model_dump(),
        "locale": request.locale,
        "context": request.context.model_dump() if request.context else None,
        "tool_calls_made": 0,
        "steps": 0,
        "results": [],
        "outcome": None,
    }


def initial_state(request: RunRequest) -> dict[str, Any]:
    return {"messages": [HumanMessage(request.message)], **request_state(request)}


DEADLINE_KEY = "__deadline_at"  # a dunder key stays out of the checkpoint metadata


def run_config(run_id: str, max_steps: int, deadline_at: float | None = None) -> dict[str, Any]:
    """Graph config; the recursion limit leaves room for error-only loops to reach ``max_steps`` first.

    ``deadline_at`` is the run deadline on the event loop clock: model retries do not wait past it.
    """
    configurable: dict[str, Any] = {"thread_id": run_id}
    if deadline_at is not None:
        configurable[DEADLINE_KEY] = deadline_at
    return {"configurable": configurable, "recursion_limit": 3 * max_steps + 10}


def text_of(content: str | list[Any]) -> str:
    """The text of a message: a string as is, provider content blocks reduced to their text blocks."""
    if isinstance(content, str):
        return content
    parts = []
    for block in content:
        if isinstance(block, str):
            parts.append(block)
        elif isinstance(block, dict) and block.get("type") == "text":
            parts.append(block.get("text", ""))
    return "".join(parts)


def resume_value(result: ToolResult) -> dict[str, Any]:
    return result.model_dump(exclude_none=True)


def _openai_tools(tools: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [
        {
            "type": "function",
            "function": {"name": encode_tool_name(tool["name"]), "description": tool["description"]["en"], "parameters": tool["input_schema"]},
        }
        for tool in tools
    ]


def _error(call_id: str, code: str, message: str) -> ToolMessage:
    return ToolMessage(content=json.dumps({"ok": False, "error": {"code": code, "message": message}}, ensure_ascii=False), tool_call_id=call_id)


def interrupted_replies(messages: list) -> list[ToolMessage]:
    """Error replies for the tool calls of the last model message that never got one (a cancel or a crash cut the turn short).

    A thread whose last model message has unanswered tool calls is rejected by every provider on the next turn.
    """
    last = next((m for m in reversed(messages) if isinstance(m, AIMessage)), None)
    if last is None:
        return []
    answered = {m.tool_call_id for m in messages if isinstance(m, ToolMessage)}
    message = "the previous turn was interrupted before this call ran"
    return [_error(call["id"], "interrupted", message) for call in last.tool_calls if call["id"] not in answered]


def invalid_arguments(args: Any, schema: dict[str, Any]) -> str | None:
    """Why ``args`` do not fit ``schema``, or None. A broken schema is also invalid arguments, with a fixed message."""
    try:
        jsonschema.validate(args, schema)
    except jsonschema.ValidationError as error:
        return error.message
    except Exception:  # noqa: BLE001 - SchemaError, unresolvable references...: whatever the cause the call is refused, its text is not shown
        return "the arguments could not be validated"
    return None


def build_graph(model: BaseChatModel, checkpointer, identity: ModelIdentity):
    bound = model.bind_tools  # resolved per call so tests may swap tools per run

    async def plan(state: AgentState, config: RunnableConfig) -> dict[str, Any]:
        if state["steps"] >= state["limits"]["max_steps"]:
            return {"outcome": "limit_reached"}
        specs = [ToolSpec.model_validate(tool) for tool in state["tools"]]
        context = RunContext.model_validate(state["context"]) if state["context"] else None
        prompt = SystemMessage(system_prompt(state["locale"], specs, context))
        history = [message for message in state["messages"] if not isinstance(message, SystemMessage)]
        deadline_at = config["configurable"].get(DEADLINE_KEY)
        response = await invoke_planned(bound(_openai_tools(state["tools"])), [prompt, *history], identity, get_stream_writer(), deadline_at)
        return {"messages": [response], "steps": state["steps"] + 1}

    def route_after_plan(state: AgentState) -> Literal["request_tool", "answer", "__end__"]:
        if state["outcome"] == "limit_reached":
            return END
        last = state["messages"][-1]
        if isinstance(last, AIMessage) and last.tool_calls:
            return "request_tool"
        return "answer"

    def request_tool(state: AgentState) -> dict[str, Any]:
        last: AIMessage = state["messages"][-1]
        first, *rest = last.tool_calls
        extra = [_error(call["id"], "one_tool_per_step", "call one tool per step; this call was not run") for call in rest]
        tools = {encode_tool_name(tool["name"]): tool for tool in state["tools"]}  # the provider names tools by their encoded form
        spec = tools.get(first["name"])
        if spec is None:
            return {"messages": [_error(first["id"], "unknown_tool", f"{first['name']} is not available"), *extra]}
        invalid = invalid_arguments(first["args"], spec["input_schema"])
        if invalid is not None:
            return {"messages": [_error(first["id"], "invalid_arguments", invalid), *extra]}
        if state["tool_calls_made"] >= state["limits"]["max_tool_calls"]:
            # Every tool call of the message gets an answer, or the provider rejects any follow-up turn.
            refused = [_error(call["id"], "limit_reached", "tool call limit reached; not run") for call in last.tool_calls]
            return {"outcome": "limit_reached", "messages": refused}
        tool = ToolSpec.model_validate(spec)
        payload = {
            "call_id": first["id"],
            "tool": tool.name,
            "kind": tool.kind,
            "input": first["args"],
            "summary_ar": tool_summary(tool, first["args"], "ar"),
            "summary_en": tool_summary(tool, first["args"], "en"),
        }
        result = ToolResult.model_validate(interrupt(payload))
        # A successful result reaches the model as its bare data; a failure keeps the {ok, error|decision} envelope.
        content = result.data if result.ok and result.data is not None else result.model_dump(exclude_none=True)
        tool_message = ToolMessage(content=json.dumps(content, ensure_ascii=False), tool_call_id=first["id"])
        results = list(state["results"])
        if result.ok and result.data is not None and tool.kind == "read":
            results.append((tool.name, result.data))
        return {"messages": [tool_message, *extra], "tool_calls_made": state["tool_calls_made"] + 1, "results": results}

    def route_after_tool(state: AgentState) -> Literal["plan", "__end__"]:
        return END if state["outcome"] == "limit_reached" else "plan"

    def answer(state: AgentState) -> dict[str, Any]:
        return {"outcome": "answer"}

    builder = StateGraph(AgentState)
    builder.add_node("plan", plan)
    builder.add_node("request_tool", request_tool)
    builder.add_node("answer", answer)
    builder.add_edge(START, "plan")
    builder.add_conditional_edges("plan", route_after_plan, {"request_tool": "request_tool", "answer": "answer", END: END})
    builder.add_conditional_edges("request_tool", route_after_tool, {"plan": "plan", END: END})
    builder.add_edge("answer", END)
    return builder.compile(checkpointer=checkpointer)
