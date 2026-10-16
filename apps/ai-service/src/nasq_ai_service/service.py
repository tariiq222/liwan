"""HTTP surface (master plan ع2). Every run is owned by (tenant, user_ref) from the headers."""
from __future__ import annotations

import asyncio
import contextlib
import logging
import os
from collections.abc import AsyncIterator
from typing import Annotated, Any

import anyio
from fastapi import Depends, FastAPI, Header, HTTPException
from fastapi.responses import StreamingResponse
from langchain_core.messages import AIMessage, HumanMessage
from langgraph.types import Command

from nasq_ai_service.contracts import PendingCall, ResumeRequest, RunMessage, RunRequest, RunStatus
from nasq_ai_service.errors import client_error, redact
from nasq_ai_service.graph import build_graph, initial_state, interrupted_replies, request_state, resume_value, run_config, text_of
from nasq_ai_service.providers import build_chat_model
from nasq_ai_service.records import records_from_results
from nasq_ai_service.settings import Settings, SettingsError
from nasq_ai_service.sse import format_event
from nasq_ai_service.store import RunRecord, RunStore, open_state

log = logging.getLogger("nasq_ai_service")
WAITING = ("waiting_tool", "waiting_user")
FINISHED = ("done", "failed", "limit_reached")
STALE_AFTER_SECONDS = 600 + 60  # the longest run timeout (Limits.timeout_seconds) plus a minute: a 'running' run older than this lost its process


def waiting_status(kind: str) -> str:
    return "waiting_tool" if kind == "read" else "waiting_user"


class ClosingStreamingResponse(StreamingResponse):
    """A streaming response that always closes its generator.

    A client that vanishes while a chunk is being sent cancels this ASGI call, not the generator, which would then only
    be closed when the garbage collector finds it; the run's final status is recorded in the generator's ``finally``.
    """

    async def __call__(self, scope, receive, send) -> None:
        try:
            await super().__call__(scope, receive, send)
        finally:
            with anyio.CancelScope(shield=True):
                await self.body_iterator.aclose()


class Owner:
    def __init__(self, tenant: str, user_ref: str) -> None:
        self.tenant, self.user_ref = tenant, user_ref


def owner(x_nasq_tenant: str = Header(...), x_nasq_user: str = Header(...)) -> Owner:
    return Owner(x_nasq_tenant, x_nasq_user)


def create_app(model, store: RunStore, checkpointer, settings: Settings) -> FastAPI:
    graph = build_graph(model, checkpointer)
    app = FastAPI(title="Nasq AI service", docs_url=None, redoc_url=None)
    in_flight: set[asyncio.Task] = set()

    async def owned_run(run_id: str, who: Owner) -> RunRecord:
        record = await store.get(run_id)
        if record is None or record.tenant != who.tenant or record.user_ref != who.user_ref:
            raise HTTPException(404, "run not found")
        return record

    def pending_of(state: Any) -> PendingCall | None:
        for task in state.tasks:
            for item in task.interrupts:
                value = item.value
                return PendingCall(call_id=value["call_id"], tool=value["tool"], kind=value["kind"], input=value["input"])
        return None

    def log_failure(run_id: str, error: Exception, what: str = "failed") -> None:
        log.error("run %s %s: %s: %s", run_id, what, type(error).__name__, redact(str(error), (settings.api_key, settings.database_url)))

    async def derive_status(run_id: str) -> tuple[str, str | None]:
        """The status and pending call id the checkpoint implies, for a run whose generator was closed before it decided."""
        try:
            state = await graph.aget_state(run_config(run_id, 1))
        except Exception as error:  # noqa: BLE001 - the checkpoint is unreadable; the run is failed rather than left running
            log_failure(run_id, error, "could not read its checkpoint")
            return "failed", None
        pending = pending_of(state)
        if pending is not None:
            return waiting_status(pending.kind), pending.call_id
        return {"limit_reached": "limit_reached", "answer": "done"}.get(state.values.get("outcome"), "failed"), None

    async def settle(run_id: str, lease: str | None, decided: tuple[str, str | None] | None) -> str:
        status, call_id = decided or await derive_status(run_id)
        try:
            await store.finish(run_id, status, lease, call_id)
        except Exception as error:  # noqa: BLE001 - a store that cannot record the status leaves the run to the stale-run recovery
            log_failure(run_id, error, "could not record its status")
        return status

    async def persist(run_id: str, lease: str | None, decided: tuple[str, str | None] | None) -> str:
        """Record the final status in a task that survives the cancellation of the stream; ``drain`` waits for it."""
        task = asyncio.create_task(settle(run_id, lease, decided))
        in_flight.add(task)
        task.add_done_callback(in_flight.discard)
        return await asyncio.shield(task)

    async def drain() -> None:
        await asyncio.gather(*in_flight, return_exceptions=True)

    app.state.drain = drain

    async def stream(run_id: str, lease: str | None, graph_input: Any, limits: dict[str, int]) -> AsyncIterator[bytes]:
        # ``decided`` is assigned BEFORE the event that announces it is yielded: a client that vanishes while that event is sent
        # closes the generator at the yield, and the run must already carry its outcome.
        decided: tuple[str, str | None] | None = None
        config = run_config(run_id, limits["max_steps"])
        deadline = asyncio.timeout(limits["timeout_seconds"])
        try:
            yield format_event("run", {"run_id": run_id})
            async with deadline, contextlib.aclosing(graph.astream(graph_input, config, stream_mode=["messages", "updates"])) as events:
                async for mode, payload in events:
                    if mode == "messages":
                        chunk, meta = payload
                        text = text_of(chunk.content) if meta.get("langgraph_node") == "plan" else ""
                        if text and not getattr(chunk, "tool_calls", None):
                            yield format_event("token", {"text": text})
                    elif mode == "updates" and "__interrupt__" in payload:
                        value = payload["__interrupt__"][0].value
                        decided = (waiting_status(value["kind"]), value["call_id"])
                        yield format_event("tool_request", value)
            if decided is None:
                values = (await graph.aget_state(config)).values
                if values.get("outcome") == "limit_reached":
                    limit = "max_tool_calls" if values["tool_calls_made"] >= values["limits"]["max_tool_calls"] else "max_steps"
                    decided = ("limit_reached", None)
                    yield format_event("limit_reached", {"limit": limit})
                else:
                    last = next((m for m in reversed(values["messages"]) if isinstance(m, AIMessage)), None)
                    decided = ("done", None)
                    yield format_event("answer", {"text": text_of(last.content) if last else "", "records": records_from_results(values["results"])})
        except Exception as error:  # noqa: BLE001 - every failure must reach the client as an event, without its text
            if isinstance(error, TimeoutError) and deadline.expired():  # the run's deadline; a provider's own TimeoutError is a failure
                decided = ("limit_reached", None)
                yield format_event("limit_reached", {"limit": "timeout"})
            else:
                log_failure(run_id, error)
                decided = ("failed", None)
                yield format_event("error", client_error(error))
        finally:
            # Also runs when the client disconnects (CancelledError/GeneratorExit): the run never stays 'running'.
            status = await persist(run_id, lease, decided)
        yield format_event("done", {"status": status})

    def sse(generator: AsyncIterator[bytes]) -> StreamingResponse:
        return ClosingStreamingResponse(generator, media_type="text/event-stream", headers={"cache-control": "no-store", "x-accel-buffering": "no"})

    @app.get("/healthz")
    async def healthz() -> dict[str, bool]:
        return {"ok": True}

    @app.post("/v1/runs")
    async def start_run(request: RunRequest, who: Annotated[Owner, Depends(owner)]) -> StreamingResponse:
        if request.tenant != who.tenant or request.user_ref != who.user_ref:
            raise HTTPException(422, "tenant/user headers must match the body")
        if request.run_id:
            record = await owned_run(request.run_id, who)
            state = await graph.aget_state(run_config(record.run_id, 1))
            if pending_of(state) is not None:
                raise HTTPException(409, "run is waiting for a tool result; resume it")
            lease = await store.acquire(record.run_id, FINISHED, stale_after_seconds=STALE_AFTER_SECONDS)
            if lease is None:
                raise HTTPException(409, "run is not finished; resume it or wait for it")
            replies = interrupted_replies(state.values.get("messages", []))
            graph_input: Any = {"messages": [*replies, HumanMessage(request.message)], **request_state(request)}
        else:
            record = await store.create(who.tenant, who.user_ref)
            lease, graph_input = record.lease, initial_state(request)
        return sse(stream(record.run_id, lease, graph_input, request.limits.model_dump()))

    @app.post("/v1/runs/{run_id}/resume")
    async def resume_run(run_id: str, body: ResumeRequest, who: Annotated[Owner, Depends(owner)]) -> StreamingResponse:
        record = await owned_run(run_id, who)
        state = await graph.aget_state(run_config(record.run_id, 1))
        pending = pending_of(state)
        if pending is None or pending.call_id != body.call_id:
            raise HTTPException(409, "no pending call with this call_id")
        # The call id is compared again inside the acquire, atomically: a late resume cannot answer a newer call.
        lease = await store.acquire(record.run_id, WAITING, stale_after_seconds=STALE_AFTER_SECONDS, pending_call_id=body.call_id)
        if lease is None:
            raise HTTPException(409, "run is already being resumed")
        return sse(stream(record.run_id, lease, Command(resume=resume_value(body.result)), state.values["limits"]))

    @app.get("/v1/runs/{run_id}")
    async def get_run(run_id: str, who: Annotated[Owner, Depends(owner)]) -> RunStatus:
        record = await owned_run(run_id, who)
        state = await graph.aget_state(run_config(record.run_id, 1))
        messages = [
            RunMessage(role="user" if isinstance(m, HumanMessage) else "assistant", content=text_of(m.content))
            for m in state.values.get("messages", [])
            if isinstance(m, HumanMessage) or (isinstance(m, AIMessage) and text_of(m.content) and not m.tool_calls)
        ]
        return RunStatus(run_id=record.run_id, status=record.status, messages=messages, pending=pending_of(state))

    return app


class EnvApp:
    """ASGI app configured from the environment whose state opens on uvicorn's own event loop.

    The Postgres pool must be created on the loop that serves requests, so it is opened in the
    ASGI lifespan startup rather than at import time.
    """

    def __init__(self) -> None:
        self.inner: FastAPI | None = None

    async def __call__(self, scope, receive, send) -> None:
        if scope["type"] != "lifespan":
            await self.inner(scope, receive, send)
            return
        aclose = None
        while True:
            message = await receive()
            if message["type"] == "lifespan.startup":
                try:
                    settings = Settings.from_env(os.environ)
                    store, checkpointer, aclose = await open_state(settings.database_url)
                    self.inner = create_app(build_chat_model(settings), store, checkpointer, settings)
                except Exception as error:  # noqa: BLE001 - the server must report why it cannot start, without secrets
                    if aclose is not None:
                        await aclose()
                    detail = f": {error.variable}" if isinstance(error, SettingsError) else ""
                    await send({"type": "lifespan.startup.failed", "message": f"{type(error).__name__}{detail}"})
                    return
                await send({"type": "lifespan.startup.complete"})
            elif message["type"] == "lifespan.shutdown":
                if self.inner is not None:
                    await self.inner.state.drain()  # shielded persist tasks use the pool: let them finish first
                if aclose is not None:
                    await aclose()
                await send({"type": "lifespan.shutdown.complete"})
                return


app = EnvApp()
