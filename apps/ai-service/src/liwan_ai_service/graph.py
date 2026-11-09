"""The one conversation graph: plan → request one tool (interrupt) → plan … → answer.

The graph executes nothing. A tool request is an ``interrupt`` whose value is the
request payload; the caller resumes with a ``ToolResult``. Limits come from the
run request and stop the graph with ``outcome = 'limit_reached'``.

One agent is active at a time (spec 2026-11-04 §6.5): the coordinator ``core`` or a specialist. A specialist sees its
own tools of every kind and the read tools of the other agents; the coordinator sees only read tools. Either hands the
request over with the in-graph ``liwan_handoff`` tool, which runs here, is never audited and spends no tool call.
"""
from __future__ import annotations

import json
import logging
from dataclasses import dataclass, field
from typing import Annotated, Any, Literal, TypedDict

import jsonschema
from langchain_core.messages import AIMessage, HumanMessage, SystemMessage, ToolMessage
from langchain_core.runnables import RunnableConfig
from langgraph.config import get_stream_writer
from langgraph.graph import END, START, StateGraph
from langgraph.graph.message import add_messages
from langgraph.types import interrupt

from liwan_ai_service.contracts import CORE_AGENT, AgentSpec, RunContext, RunRequest, ToolResult, ToolSpec, encode_tool_name
from liwan_ai_service.embeddings import Embedder
from liwan_ai_service.knowledge import KnowledgeStore
from liwan_ai_service.memory import MemoryFull, MemoryStore
from liwan_ai_service.prompts import frame_record_text, system_prompt, tool_summary
from liwan_ai_service.usage import RunModel, invoke_planned, tokens_of


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
    output_tokens: int  # what the provider reported for this request's plan calls
    max_output_tokens: int | None  # the policy's per-run cap (platform runs); None means no cap
    input_tokens: int  # the summed input tokens the provider reported for this request's plan calls
    max_input_tokens: int | None  # the tenant's per-run ceiling on input tokens (issue #554); None means no ceiling
    limit: str | None  # which limit stopped the run, when the graph itself decided it
    agents: list[dict[str, Any]]  # the specialists Odoo declared for this user and request
    agent: str  # the active agent: a specialist's key or ``core``
    handoffs: int  # hand-overs made for this request
    company: str | None  # the user's current company: whose approved notes the prompt carries
    knowledge: dict[str, list[dict[str, Any]]]  # the references found for the pending knowledge search: {call_id: refs}, never text


REMEMBER = "liwan_remember"
PROPOSE_COMPANY_NOTE = "liwan_propose_company_note"
NOTE_SCHEMA = {"type": "object", "properties": {"note": {"type": "string", "minLength": 1, "maxLength": 300}},
               "required": ["note"], "additionalProperties": False}


@dataclass(frozen=True)
class RunMemory:
    """This request's memory: where the note tools write, and the notes its prompt carries.

    The notes are read by the service for every request (a new message and a resume alike) and never enter the
    checkpoint, so a note the employee deleted, or a company note a manager discarded, is gone from the next request.
    """

    store: MemoryStore
    user_ref: str
    company: str | None
    user_notes: list[str] = field(default_factory=list)
    company_notes: list[str] = field(default_factory=list)


KNOWLEDGE_TOOL = "ai.search_knowledge"  # registered by liwan_ai; its candidates are found here, before the request leaves the graph


@dataclass(frozen=True)
class RunKnowledge:
    """This request's knowledge search: the tenant's index, the embedder that tagged it and the company it may search.

    Like ``RunMemory`` it is built by the service for every request and never enters the checkpoint.
    """

    store: KnowledgeStore
    embedder: Embedder
    company: str | None


HANDOFF = "liwan_handoff"  # no dot: it can never collide with a registered tool name
MAX_HANDOFFS = 3


def start_agent(request: RunRequest) -> str:
    """The specialist whose pages include the current page, else the only specialist the user has, else the coordinator.

    The page is a hint, never a limit: any agent can hand over to any other.
    """
    page = request.context.page if request.context else None
    by_page = next((agent.key for agent in request.agents if page in agent.pages), None)
    if by_page:
        return by_page
    return request.agents[0].key if len(request.agents) == 1 else CORE_AGENT


def visible_tools(tools: list[dict[str, Any]], agent: str) -> list[dict[str, Any]]:
    """The tools the active agent may request: every read tool, plus a specialist's own write and draft tools.

    The coordinator owns no tool, so a change or a draft always happens after a hand-over to the application's agent.
    """
    return [tool for tool in tools if tool["kind"] == "read" or tool["name"].split(".", 1)[0] == agent]


def handoff_tool(targets: list[str]) -> dict[str, Any]:
    return {
        "type": "function",
        "function": {
            "name": HANDOFF,
            "description": "Hand the request over to the agent that owns it; the user does not choose agents.",
            "parameters": {
                "type": "object",
                "properties": {"agent": {"type": "string", "enum": targets}, "reason": {"type": "string", "maxLength": 200}},
                "required": ["agent"],
                "additionalProperties": False,
            },
        },
    }


def memory_on(state: AgentState) -> bool:
    """A specialist remembers while its agent setting allows it; the coordinator while any of the user's agents does, so a
    tenant that switches memory off for every agent has no memory at all."""
    current = state.get("agent", CORE_AGENT)
    agents = state.get("agents", [])
    if current == CORE_AGENT:
        return any(agent.get("memory", True) for agent in agents)
    return next((agent.get("memory", True) for agent in agents if agent["key"] == current), False)


IN_GRAPH_TOOLS = frozenset({HANDOFF, REMEMBER, PROPOSE_COMPANY_NOTE})


def has_read_data(messages: list) -> bool:
    """Whether the conversation's history holds a data tool's call, whose result stays in the model's context."""
    return any(call["name"] not in IN_GRAPH_TOOLS for m in messages if isinstance(m, AIMessage) for call in m.tool_calls)


def memory_tools(state: AgentState, config: RunnableConfig) -> list[dict[str, Any]]:
    """The note tools of this request: none when memory is off for the active agent or no store backs the request, and
    none once the conversation holds data a tool returned (in this request or an earlier one: the history stays in the
    context). A note is learned from what the user says, never from a record, a customer message or any other tool
    result, which could otherwise plant an instruction that outlives the run; a new conversation offers them again."""
    if not memory_on(state) or config["configurable"].get(RUN_MEMORY_KEY) is None or has_read_data(state["messages"]):
        return []
    tools = [_function(REMEMBER, "Save one short note about how this user likes to work (style, preferences, recurring needs); "
                       "never a copy of a record.", NOTE_SCHEMA)]
    if state.get("company"):
        tools.append(_function(PROPOSE_COMPANY_NOTE, "Propose one short note about the company's identity, tone or terminology; "
                               "an administrator approves it before it is used.", NOTE_SCHEMA))
    return tools


def _function(name: str, description: str, parameters: dict[str, Any]) -> dict[str, Any]:
    return {"type": "function", "function": {"name": name, "description": description, "parameters": parameters}}


def handoff_targets(state: AgentState) -> list[str]:
    """The specialists the active agent may hand over to. Never back to the coordinator: a specialist already sees every
    read tool the coordinator has, so that hand-over could only lose tools."""
    if state.get("handoffs", 0) >= MAX_HANDOFFS:
        return []
    current = state.get("agent", CORE_AGENT)
    return [agent["key"] for agent in state.get("agents", []) if agent["key"] != current]


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
        "output_tokens": 0,
        "max_output_tokens": request.policy.max_output_tokens,
        "input_tokens": 0,
        "max_input_tokens": request.policy.max_input_tokens,
        "limit": None,
        "agents": [agent.model_dump() for agent in request.agents],
        "handoffs": 0,
        "company": request.company,
        "knowledge": {},
    }


def initial_state(request: RunRequest) -> dict[str, Any]:
    return {"messages": [HumanMessage(request.message)], **request_state(request), "agent": start_agent(request)}


def continued_state(request: RunRequest, previous: dict[str, Any]) -> dict[str, Any]:
    """A new message in an existing run keeps the agent it was talking to, while that agent is still offered."""
    agent = previous.get("agent", CORE_AGENT)
    if agent != CORE_AGENT and agent not in {spec.key for spec in request.agents}:
        agent = start_agent(request)
    return {**request_state(request), "agent": agent}


DEADLINE_KEY = "__deadline_at"  # a dunder key stays out of the checkpoint metadata
RUN_MODEL_KEY = "__run_model"  # the request's model, chosen from the tenant's policy; never checkpointed
RUN_MEMORY_KEY = "__run_memory"  # where the request's memory tools write; never checkpointed
RUN_KNOWLEDGE_KEY = "__run_knowledge"  # the request's knowledge search; never checkpointed


def run_config(run_id: str, max_steps: int, deadline_at: float | None = None, run_model: RunModel | None = None,
               run_memory: RunMemory | None = None, run_knowledge: RunKnowledge | None = None) -> dict[str, Any]:
    """Graph config; the recursion limit leaves room for error-only loops to reach ``max_steps`` first.

    ``deadline_at`` is the run deadline on the event loop clock: model retries do not wait past it. ``run_model`` is
    required to stream the graph and absent for reading its state.
    """
    configurable: dict[str, Any] = {"thread_id": run_id}
    if deadline_at is not None:
        configurable[DEADLINE_KEY] = deadline_at
    if run_model is not None:
        configurable[RUN_MODEL_KEY] = run_model
    if run_memory is not None:
        configurable[RUN_MEMORY_KEY] = run_memory
    if run_knowledge is not None:
        configurable[RUN_KNOWLEDGE_KEY] = run_knowledge
    return {"configurable": configurable, "recursion_limit": 3 * max_steps + 10}

log = logging.getLogger("liwan_ai_service")


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


def _carries_text(value: Any) -> bool:
    """Whether a tool result holds any text at all: a count, a total and a bare status do not."""
    if isinstance(value, str):
        return True
    if isinstance(value, dict):
        return any(_carries_text(item) for item in value.values())
    if isinstance(value, list):
        return any(_carries_text(item) for item in value)
    return False


def tool_message_content(result: ToolResult, tool: ToolSpec) -> str:
    """What a tool result becomes in the model's context, its record text framed in the fixed delimiter (issue #555).

    A read or a small change answers with record text — a knowledge passage, a task name, a project's rationale — that an
    employee wrote and a colleague reads, so the payload reaches the model as one framed block. The whole JSON is framed
    once rather than every string field: one delimiter pair covers all of the result's record text, the payload keeps its
    shape inside the frame, and the prompt stays small. A result that carries no text at all (a finance summary's
    numbers) stays bare, because framing would change the shape the model reads for nothing. A failure or a decision
    keeps its own envelope, because it is the platform's answer; so does a draft's approval, whose data is the model's own
    proposed payload, not an employee's record text.
    """
    if result.ok and result.data is not None:
        payload = json.dumps(result.data, ensure_ascii=False)
        return frame_record_text(payload) if tool.kind != "draft" and _carries_text(result.data) else payload
    return json.dumps(result.model_dump(exclude_none=True), ensure_ascii=False)


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


async def knowledge_candidates(query: str, run_knowledge: RunKnowledge | None) -> list[dict[str, Any]] | None:
    """The references nearest to ``query`` in the request's company, or None when the search is unavailable.

    The query is embedded before the search opens its connection, so no transaction waits on the provider. A provider
    or database failure is unavailability too (logged by class only: the text may carry a key or a connection string).
    """
    if run_knowledge is None or run_knowledge.company is None:
        return None
    try:
        vector = await run_knowledge.embedder.query(query)
        return await run_knowledge.store.search(int(run_knowledge.company), vector, run_knowledge.embedder.model_id)
    except Exception as error:  # noqa: BLE001 - the run goes on without the search; the cause is logged, not shown
        log.warning("knowledge search failed: %s", type(error).__name__)
        return None


def build_graph(checkpointer):
    """One compiled graph per tenant state; each request brings its own model through ``RUN_MODEL_KEY``."""

    async def plan(state: AgentState, config: RunnableConfig) -> dict[str, Any]:
        if state["steps"] >= state["limits"]["max_steps"]:
            return {"outcome": "limit_reached"}
        cap = state.get("max_output_tokens")
        if cap is not None and state.get("output_tokens", 0) >= cap:
            return {"outcome": "limit_reached", "limit": "output_tokens"}
        # The tenant's ceiling on input tokens (issue #554): every plan call sends the whole prompt and history, so the
        # calls already made are what the next one costs again. A run that has spent its ceiling stops before spending more.
        input_cap = state.get("max_input_tokens")
        if input_cap is not None and state.get("input_tokens", 0) >= input_cap:
            return {"outcome": "limit_reached", "limit": "input_tokens"}
        run_model: RunModel = config["configurable"][RUN_MODEL_KEY]
        current = state.get("agent", CORE_AGENT)
        visible = visible_tools(state["tools"], current)
        specs = [ToolSpec.model_validate(tool) for tool in visible]
        agents = {agent["key"]: AgentSpec.model_validate(agent) for agent in state.get("agents", [])}
        targets = handoff_targets(state)
        context = RunContext.model_validate(state["context"]) if state["context"] else None
        run_memory: RunMemory | None = config["configurable"].get(RUN_MEMORY_KEY)
        notes = {"user": run_memory.user_notes, "company": run_memory.company_notes} if run_memory and memory_on(state) else None
        prompt = SystemMessage(system_prompt(
            state["locale"], specs, context, agents.get(current), [agents[key] for key in targets if key in agents], notes,
        ))
        history = [message for message in state["messages"] if not isinstance(message, SystemMessage)]
        deadline_at = config["configurable"].get(DEADLINE_KEY)
        tools = run_model.model.bind_tools([*_openai_tools(visible), *([handoff_tool(targets)] if targets else []), *memory_tools(state, config)])
        response = await invoke_planned(tools, [prompt, *history], run_model.identity, get_stream_writer(), deadline_at)
        used, spent = tokens_of([response])
        if spent is None and cap is not None:
            # The cap is checked between plan calls (a call that crosses it completes); a provider reporting no usage
            # cannot be capped at all, and that is logged rather than hidden.
            log.warning("a capped run's provider reported no output tokens; the per-run cap cannot count this call")
        if used is None and input_cap is not None:
            log.warning("a capped run's provider reported no input tokens; the per-run input ceiling cannot count this call")
        update: dict[str, Any] = {
            "messages": [response], "steps": state["steps"] + 1, "output_tokens": state.get("output_tokens", 0) + (spent or 0),
            "input_tokens": state.get("input_tokens", 0) + (used or 0),
        }
        if input_cap is not None and update["input_tokens"] >= input_cap:
            # The call that reached the ceiling completes (its text has already streamed to the browser) and the run stops
            # there, exactly as the output cap does: no further prompt is spent, and a tool request it carried is not made.
            update.update({"outcome": "limit_reached", "limit": "input_tokens"})
        return update

    def route_after_plan(state: AgentState) -> Literal["retrieve", "answer", "__end__"]:
        if state["outcome"] == "limit_reached":
            return END
        last = state["messages"][-1]
        if isinstance(last, AIMessage) and last.tool_calls:
            return "retrieve"
        return "answer"

    def hand_over(state: AgentState, call: dict[str, Any], extra: list[ToolMessage]) -> dict[str, Any]:
        targets = handoff_targets(state)
        target = call["args"].get("agent") if isinstance(call["args"], dict) else None
        if target not in targets:
            return {"messages": [_error(call["id"], "invalid_arguments", "agent must be one of the offered agents"), *extra]}
        spec = next(agent for agent in state["agents"] if agent["key"] == target)
        get_stream_writer()({"event": "agent", "data": {"agent": target, "name": spec["name"]}})
        reply = ToolMessage(content=json.dumps({"ok": True, "agent": target}), tool_call_id=call["id"])
        return {"messages": [reply, *extra], "agent": target, "handoffs": state.get("handoffs", 0) + 1}

    async def save_note(state: AgentState, call: dict[str, Any], extra: list[ToolMessage], config: RunnableConfig) -> dict[str, Any]:
        offered = {tool["function"]["name"] for tool in memory_tools(state, config)}
        run_memory: RunMemory | None = config["configurable"].get(RUN_MEMORY_KEY)
        if call["name"] not in offered or run_memory is None:
            return {"messages": [_error(call["id"], "unknown_tool", f"{call['name']} is not available"), *extra]}
        invalid = invalid_arguments(call["args"], NOTE_SCHEMA)
        if invalid is not None:
            return {"messages": [_error(call["id"], "invalid_arguments", invalid), *extra]}
        try:
            if call["name"] == REMEMBER:
                note = await run_memory.store.remember(run_memory.user_ref, call["args"]["note"])
                run_memory.user_notes.append(note.content)
            else:
                await run_memory.store.propose(state["company"], call["args"]["note"], run_memory.user_ref)
        except MemoryFull as full:
            return {"messages": [_error(call["id"], "memory_full", str(full)), *extra]}
        except ValueError as error:
            return {"messages": [_error(call["id"], "invalid_arguments", str(error)), *extra]}
        status = "saved" if call["name"] == REMEMBER else "proposed for the administrator's approval"
        reply = ToolMessage(content=json.dumps({"ok": True, "status": status}), tool_call_id=call["id"])
        return {"messages": [reply, *extra]}

    def checked_tool(state: AgentState, call: dict[str, Any]) -> tuple[dict[str, Any] | None, ToolMessage | None]:
        """The offered tool a call names, or the error reply that refuses it (None for both: a call handled in the graph)."""
        # The provider names tools by their encoded form; only the active agent's visible tools can be requested.
        tools = {encode_tool_name(tool["name"]): tool for tool in visible_tools(state["tools"], state.get("agent", CORE_AGENT))}
        spec = tools.get(call["name"])
        if spec is None:
            return None, _error(call["id"], "unknown_tool", f"{call['name']} is not available")
        invalid = invalid_arguments(call["args"], spec["input_schema"])
        if invalid is None and spec["name"] == KNOWLEDGE_TOOL and not isinstance(call["args"].get("query"), str):
            invalid = "query must be a string"
        if invalid is not None:
            return spec, _error(call["id"], "invalid_arguments", invalid)
        return spec, None

    async def retrieve(state: AgentState, config: RunnableConfig) -> dict[str, Any]:
        """Find the references of a knowledge search once, before its request is made.

        A resume re-enters ``request_tool`` from the top, so searching there would embed again, and a failure by then
        would discard the result the caller already executed. No candidate, or no search, is answered here and spends no
        tool call; otherwise the references are kept in the state for ``request_tool`` to send.
        """
        first, *rest = state["messages"][-1].tool_calls
        spec, refused = checked_tool(state, first)
        if spec is None or spec["name"] != KNOWLEDGE_TOOL or refused is not None:
            return {}  # not a knowledge search, or a call ``request_tool`` refuses
        if state["tool_calls_made"] >= state["limits"]["max_tool_calls"]:
            return {}
        extra = [_error(call["id"], "one_tool_per_step", "call one tool per step; this call was not run") for call in rest]
        refs = await knowledge_candidates(first["args"]["query"], config["configurable"].get(RUN_KNOWLEDGE_KEY))
        if refs is None:
            return {"messages": [_error(first["id"], "knowledge_unavailable", "knowledge search is not available"), *extra]}
        if not refs:
            return {"messages": [ToolMessage(content=json.dumps({"items": []}), tool_call_id=first["id"]), *extra]}
        return {"knowledge": {first["id"]: refs}}

    def route_after_retrieve(state: AgentState) -> Literal["request_tool", "plan"]:
        return "plan" if isinstance(state["messages"][-1], ToolMessage) else "request_tool"

    async def request_tool(state: AgentState, config: RunnableConfig) -> dict[str, Any]:
        last: AIMessage = state["messages"][-1]
        first, *rest = last.tool_calls
        extra = [_error(call["id"], "one_tool_per_step", "call one tool per step; this call was not run") for call in rest]
        if first["name"] == HANDOFF:
            return hand_over(state, first, extra)
        if first["name"] in (REMEMBER, PROPOSE_COMPANY_NOTE):
            return await save_note(state, first, extra, config)
        current = state.get("agent", CORE_AGENT)
        spec, refused = checked_tool(state, first)
        if refused is not None:
            return {"messages": [refused, *extra]}
        if state["tool_calls_made"] >= state["limits"]["max_tool_calls"]:
            # Every tool call of the message gets an answer, or the provider rejects any follow-up turn.
            refused = [_error(call["id"], "limit_reached", "tool call limit reached; not run") for call in last.tool_calls]
            return {"outcome": "limit_reached", "messages": refused}
        tool = ToolSpec.model_validate(spec)
        tool_input = first["args"]
        if tool.name == KNOWLEDGE_TOOL:
            # The references were found once, by ``retrieve``, and are in the checkpoint: a resume never searches again.
            tool_input = {"query": first["args"]["query"], "refs": state.get("knowledge", {}).get(first["id"], [])}
        payload = {
            "call_id": first["id"],
            "tool": tool.name,
            "kind": tool.kind,
            "agent": current,
            "requires_approval": tool.requires_approval or tool.kind != "read",
            "input": tool_input,
            "summary_ar": tool_summary(tool, first["args"], "ar"),
            "summary_en": tool_summary(tool, first["args"], "en"),
        }
        result = ToolResult.model_validate(interrupt(payload))
        # A successful result reaches the model as its bare data; a failure keeps the {ok, error|decision} envelope.
        # Record text is framed once, here, where the data enters the model's context (issue #555).
        tool_message = ToolMessage(content=tool_message_content(result, tool), tool_call_id=first["id"])
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
    builder.add_node("retrieve", retrieve)
    builder.add_node("request_tool", request_tool)
    builder.add_node("answer", answer)
    builder.add_edge(START, "plan")
    builder.add_conditional_edges("plan", route_after_plan, {"retrieve": "retrieve", "answer": "answer", END: END})
    builder.add_conditional_edges("retrieve", route_after_retrieve, {"request_tool": "request_tool", "plan": "plan"})
    builder.add_conditional_edges("request_tool", route_after_tool, {"plan": "plan", END: END})
    builder.add_edge("answer", END)
    return builder.compile(checkpointer=checkpointer)
