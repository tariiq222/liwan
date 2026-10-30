"""HTTP surface (master plan ع2). Every run is owned by (tenant, user_ref) from the headers."""
from __future__ import annotations

import asyncio
import contextlib
import hmac
import logging
import os
from collections.abc import AsyncIterator
from typing import Annotated, Any

import anyio
from fastapi import APIRouter, Depends, FastAPI, Header, HTTPException
from fastapi.responses import StreamingResponse
from langchain_core.messages import AIMessage, HumanMessage
from langgraph.types import Command

from liwan_ai_service.contracts import (
    AI_STATE_VERSION,
    ClaimRequest,
    PendingCall,
    ResumeRequest,
    RunList,
    RunMessage,
    RunPatch,
    RunRequest,
    RunStatus,
    RunSummary,
)
from liwan_ai_service.errors import client_error, redact
from liwan_ai_service.graph import build_graph, initial_state, interrupted_replies, request_state, resume_value, run_config, text_of
from liwan_ai_service.providers import build_chat_model
from liwan_ai_service.records import records_from_results
from liwan_ai_service.settings import GENERATION_ID, Settings, SettingsError
from liwan_ai_service.sse import format_event
from liwan_ai_service.store import ACTIVE, EXECUTING, RunRecord, RunStore, is_stale, open_state
from liwan_ai_service.titles import TITLE_TIMEOUT_SECONDS, generate_title, title_from
from liwan_ai_service.usage import ModelIdentity, call_event, new_call_id, usage_event

log = logging.getLogger("liwan_ai_service")
WAITING = ("waiting_tool", "waiting_user", "executing")  # what a resume may answer: a claimed write call is still waiting for its result
FINISHED = ("done", "failed", "limit_reached")
# The longest run timeout (Limits.timeout_seconds) plus a minute: a 'running' run older than this lost its process;
# an 'executing' one is settled-unknown (its write may have run) and is never retried.
STALE_AFTER_SECONDS = 600 + 60
RUN_LIST_LIMIT = 50


def _pair(event: dict[str, Any]) -> tuple[str, Any]:
    """A usage event as ``(sse name, payload)``."""
    return event["event"], event["data"]


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


def owner(x_liwan_tenant: str = Header(...), x_liwan_user: str = Header(...)) -> Owner:
    return Owner(x_liwan_tenant, x_liwan_user)


def create_app(model, store: RunStore, checkpointer, settings: Settings) -> FastAPI:
    if settings.generation_id is not None and not GENERATION_ID.fullmatch(settings.generation_id):
        raise SettingsError("AI_GENERATION_ID", "AI_GENERATION_ID is invalid")
    identity = ModelIdentity(settings.provider, settings.model)
    graph = build_graph(model, checkpointer, identity)
    app = FastAPI(title="LiwanOS AI service", docs_url=None, redoc_url=None)

    def require_service_token(x_liwan_service_token: Annotated[str, Header()] = "") -> None:
        if settings.service_token is not None and not hmac.compare_digest(x_liwan_service_token.encode(), settings.service_token.encode()):
            raise HTTPException(401, "invalid service token")

    def require_state_version(x_liwan_ai_state_version: Annotated[str | None, Header()] = None) -> None:
        if x_liwan_ai_state_version is not None and x_liwan_ai_state_version != AI_STATE_VERSION:
            raise HTTPException(503, "incompatible AI state contract")

    api = APIRouter(dependencies=[Depends(require_service_token), Depends(require_state_version)])
    in_flight: set[asyncio.Task] = set()
    admitted = 0

    async def is_draining() -> bool:
        return bool(settings.generation_id and await store.generation_draining(settings.generation_id))

    async def admitted_work() -> AsyncIterator[None]:
        nonlocal admitted
        admitted += 1
        try:
            yield
        finally:
            admitted -= 1

    async def new_work() -> AsyncIterator[None]:
        nonlocal admitted
        # Count admission before the first await: drain cannot miss a request
        # between its persisted gate read and its first durable run/claim write.
        admitted += 1
        try:
            if await is_draining():
                raise HTTPException(503, "AI generation is draining")
            yield
        finally:
            admitted -= 1

    def internal_token(x_liwan_service_token: Annotated[str, Header()] = "") -> None:
        if settings.service_token is None:
            raise HTTPException(503, "release administration requires a configured service token")
        require_service_token(x_liwan_service_token)
        if settings.generation_id is None:
            raise HTTPException(503, "release administration requires a generation identity")

    async def release_evidence() -> dict[str, Any]:
        activity = await store.activity()
        draining = await is_draining()
        active = sum(activity.values())
        pool = getattr(store, "pool", None)
        stats = pool.get_stats() if pool is not None else {}
        return {
            "state_version": AI_STATE_VERSION,
            "state_id": store.state_id,
            "generation_id": settings.generation_id,
            "accepting": not draining,
            "drained": draining and active == 0 and admitted == 0 and not in_flight,
            "active_runs": active,
            "running": activity["running"],
            "claimed_writes": activity["executing"],
            "pending_reads": activity["waiting_tool"],
            "local_requests": admitted,
            "settling": len(in_flight),
            "connections": stats,
            "activity_scope": "shared_state" if pool is not None else "memory_only",
        }

    @app.get("/internal/release/readiness", dependencies=[Depends(internal_token)])
    async def release_readiness() -> dict[str, Any]:
        return await release_evidence()

    @app.post("/internal/release/drain", dependencies=[Depends(internal_token)])
    async def release_drain() -> dict[str, Any]:
        await store.drain_generation(settings.generation_id)
        return await release_evidence()

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

    def stale_executing(record: RunRecord) -> bool:
        return record.status == EXECUTING and is_stale(record, STALE_AFTER_SECONDS)

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

    def log_title_failure(run_id: str, error: Exception) -> None:
        detail = redact(str(error), (settings.api_key, settings.database_url))
        log.warning("run %s could not be titled: %s: %s", run_id, type(error).__name__, detail)

    async def name_run(run_id: str, messages: list) -> AsyncIterator[bytes]:
        """Replace the provisional title with a model-written one after the first answer; best effort, never blocks the run's outcome.

        The title call is reported like the plan calls: ``model_call`` before it, ``model_usage`` after it (``aborted`` on its timeout).
        """
        humans = [m for m in messages if isinstance(m, HumanMessage)]
        answer = next((m for m in reversed(messages) if isinstance(m, AIMessage) and text_of(m.content)), None)
        record = await store.get(run_id)
        if len(humans) != 1 or answer is None or record is None or record.title_locked:
            return
        call_id = new_call_id()
        yield format_event(*_pair(call_event(call_id, "title", identity)))
        outcome, generated = "ok", None
        timeout = asyncio.timeout(TITLE_TIMEOUT_SECONDS)
        try:
            async with timeout:
                generated = await generate_title(model, text_of(humans[0].content), text_of(answer.content))
        except Exception as error:  # noqa: BLE001 - a missing title is not a failed run: the provisional title stays, the cause is logged
            outcome = "aborted" if isinstance(error, TimeoutError) and timeout.expired() else "failed"
            log_title_failure(run_id, error)
        yield format_event(*_pair(usage_event(call_id, outcome, generated.tokens if generated else (None, None))))
        if generated is None:
            return
        if generated.title is None:
            log.warning("run %s: the model returned no usable title; keeping the provisional one", run_id)
            return
        try:
            await store.set_generated_title(run_id, generated.title)
        except Exception as error:  # noqa: BLE001 - same: the title is best effort
            log_title_failure(run_id, error)

    async def stream(run_id: str, lease: str | None, graph_input: Any, limits: dict[str, int]) -> AsyncIterator[bytes]:
        # ``decided`` is assigned BEFORE the event that announces it is yielded: a client that vanishes while that event is sent
        # closes the generator at the yield, and the run must already carry its outcome.
        decided: tuple[str, str | None] | None = None
        deadline = asyncio.timeout(limits["timeout_seconds"])
        config = run_config(run_id, limits["max_steps"], deadline.when())
        try:
            yield format_event("run", {"run_id": run_id})
            async with deadline, contextlib.aclosing(graph.astream(graph_input, config, stream_mode=["messages", "updates", "custom"])) as events:
                async for mode, payload in events:
                    if mode == "messages":
                        chunk, meta = payload
                        text = text_of(chunk.content) if meta.get("langgraph_node") == "plan" else ""
                        if text and not getattr(chunk, "tool_calls", None):
                            yield format_event("token", {"text": text})
                    elif mode == "custom":  # the plan node's model_call / model_usage
                        yield format_event(*_pair(payload))
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
                    answer_text = text_of(last.content) if last else ""
                    yield format_event("answer", {"text": answer_text, "records": records_from_results(values["results"], answer_text)})
                    # After the answer is on the wire, before the stream ends: the list refetch sees the title.
                    async for event in name_run(run_id, values["messages"]):
                        yield event
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

    @api.post("/v1/runs", dependencies=[Depends(new_work)])
    async def start_run(request: RunRequest, who: Annotated[Owner, Depends(owner)]) -> StreamingResponse:
        if request.tenant != who.tenant or request.user_ref != who.user_ref:
            raise HTTPException(422, "tenant/user headers must match the body")
        if request.run_id is not None:
            record = await owned_run(request.run_id, who)
            state = await graph.aget_state(run_config(record.run_id, 1))
            if pending_of(state) is not None and not stale_executing(record):  # a stale claimed write is answered by the new message
                raise HTTPException(409, "run is waiting for a tool result; resume it")
            lease = await store.acquire(record.run_id, FINISHED, stale_after_seconds=STALE_AFTER_SECONDS, takeover=ACTIVE)
            if lease is None:
                raise HTTPException(409, "run is not finished; resume it or wait for it")
            replies = interrupted_replies(state.values.get("messages", []))
            graph_input: Any = {"messages": [*replies, HumanMessage(request.message)], **request_state(request)}
        else:
            record = await store.create(request.new_run_id, who.tenant, who.user_ref, title_from(request.message))
            if record is None:
                raise HTTPException(409, "a run with this new_run_id already exists")
            lease, graph_input = record.lease, initial_state(request)
        return sse(stream(record.run_id, lease, graph_input, request.limits.model_dump()))

    @api.post("/v1/runs/{run_id}/resume", dependencies=[Depends(admitted_work)])
    async def resume_run(run_id: str, body: ResumeRequest, who: Annotated[Owner, Depends(owner)]) -> StreamingResponse:
        record = await owned_run(run_id, who)
        state = await graph.aget_state(run_config(record.run_id, 1))
        pending = pending_of(state)
        if pending is None or pending.call_id != body.call_id:
            raise HTTPException(409, "no pending call with this call_id")
        if await is_draining() and record.status not in (EXECUTING, "waiting_tool"):
            raise HTTPException(503, "AI generation is draining; resume on the accepting generation")
        if record.status == EXECUTING and body.result.decision == "rejected":  # only the claimer resumes a claimed call, never with a decision
            raise HTTPException(409, "call is already claimed")
        # The call id is compared again inside the acquire, atomically: a late resume cannot answer a newer call.
        lease = await store.acquire(record.run_id, WAITING, stale_after_seconds=STALE_AFTER_SECONDS, pending_call_id=body.call_id)
        if lease is None:
            raise HTTPException(409, "run is already being resumed")
        return sse(stream(record.run_id, lease, Command(resume=resume_value(body.result)), state.values["limits"]))

    @api.post("/v1/runs/{run_id}/claim", dependencies=[Depends(new_work)])
    async def claim_run(run_id: str, body: ClaimRequest, who: Annotated[Owner, Depends(owner)]) -> dict[str, bool]:
        """Reserve the pending write call before the caller executes it, so exactly one claimant (and one resume) applies it."""
        record = await owned_run(run_id, who)
        pending = pending_of(await graph.aget_state(run_config(record.run_id, 1)))
        if pending is None or pending.call_id != body.call_id or pending.kind == "read":
            raise HTTPException(409, "no claimable call with this call_id")
        lease = await store.acquire(
            record.run_id, ("waiting_user",), stale_after_seconds=STALE_AFTER_SECONDS, pending_call_id=body.call_id, to_status="executing",
        )
        if lease is None:
            raise HTTPException(409, "call is already claimed or answered")
        return {"ok": True}

    def summary_of(record: RunRecord) -> RunSummary:
        status = "failed" if stale_executing(record) else record.status
        archived = record.archived_at is not None
        return RunSummary(run_id=record.run_id, title=record.title, status=status, updated_at=record.updated_at, archived=archived)

    @api.get("/v1/runs")
    async def list_runs(who: Annotated[Owner, Depends(owner)], archived: bool = False) -> RunList:
        records = await store.list_for_owner(who.tenant, who.user_ref, RUN_LIST_LIMIT, archived=archived)
        items = [summary_of(record) for record in records]
        return RunList(items=items, total=len(items))

    @api.patch("/v1/runs/{run_id}", dependencies=[Depends(new_work)])
    async def patch_run(run_id: str, body: RunPatch, who: Annotated[Owner, Depends(owner)]) -> RunSummary:
        record = await owned_run(run_id, who)
        updated = await store.update_meta(record.run_id, title=body.title, archived=body.archived)
        if updated is None:  # deleted by the retention cleanup between the ownership check and the write
            raise HTTPException(404, "run not found")
        return summary_of(updated)

    @api.get("/v1/runs/{run_id}")
    async def get_run(run_id: str, who: Annotated[Owner, Depends(owner)]) -> RunStatus:
        record = await owned_run(run_id, who)
        state = await graph.aget_state(run_config(record.run_id, 1))
        messages = [
            RunMessage(role="user" if isinstance(m, HumanMessage) else "assistant", content=text_of(m.content))
            for m in state.values.get("messages", [])
            if isinstance(m, HumanMessage) or (isinstance(m, AIMessage) and text_of(m.content) and not m.tool_calls)
        ]
        if stale_executing(record):  # settled-unknown: its write may have run, so it is neither pending nor retried
            return RunStatus(run_id=record.run_id, status="failed", messages=messages, pending=None)
        return RunStatus(run_id=record.run_id, status=record.status, messages=messages, pending=pending_of(state))

    app.include_router(api)
    return app


def log_boot_warnings(settings: Settings) -> None:
    if settings.database_url is None:
        log.warning("AI_ALLOW_MEMORY_STATE=true: run state lives in memory and is lost on restart (development only)")
    if settings.service_token is None:
        log.warning("AI_SERVICE_TOKEN is not set: the service accepts any caller (development only)")


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
                    log_boot_warnings(settings)
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
