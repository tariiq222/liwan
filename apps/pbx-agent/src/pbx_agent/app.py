"""The HTTP surface and the lifecycle of the background work (design 2, 4.4, 4.6).

Two public routes only: ``GET /health`` and ``GET /pbx/recordings/<token>``. The ARI event stream, the delivery
worker and the reconciliation pass are daemon threads started with the app and stopped with it. The ARI probe,
the queue and the disk read the health report are pushed off the event loop, since each may wait on the network
or on SQLite.

A background pass that raises is logged by exception class and the worker keeps its tick: a dead delivery thread
would otherwise look exactly like a busy one, which is why the report carries a beat per worker.
"""

from __future__ import annotations

import logging
import shutil
import sqlite3
import threading
import time
from contextlib import asynccontextmanager
from typing import TYPE_CHECKING

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from starlette.concurrency import run_in_threadpool

from pbx_agent.ari import AriClient, AriListener, AriTransport, ConnectionState, events_url
from pbx_agent.cel import CelFile
from pbx_agent.delivery import WORKER_STALE_SECONDS, Delivery
from pbx_agent.health import Liveness, snapshot
from pbx_agent.ingest import handle_ari_event
from pbx_agent.odoo_routes import link_route, registration_route
from pbx_agent.queue import EventQueue
from pbx_agent.reconcile import Reconciler
from pbx_agent.recordings import recording_path
from pbx_agent.signing import verify_recording_token

if TYPE_CHECKING:
    from pathlib import Path

    from pbx_agent.settings import Settings

log = logging.getLogger(__name__)

DELIVERY_TICK_SECONDS = 1
PRUNE_SECONDS = 3600
WORKER_JOIN_SECONDS = 10
RECORDING_MEDIA_TYPE = "audio/wav"


def create_app(settings: Settings, ari_client=None) -> FastAPI:
    """The HTTP surface. `ari_client` exists so a test can drive the routes without an Asterisk to talk to."""
    queue = EventQueue(settings.queue_path)
    ari = ari_client or AriClient(AriTransport(settings.ari_url, settings.ari_username, settings.ari_password))
    state = ConnectionState()
    reconciler = Reconciler(
        queue,
        CelFile(settings.cel_path),
        database=settings.database,
        inbound_context=settings.inbound_context,
    )
    delivery = Delivery(queue, url=settings.odoo_events_url, key=settings.events_key)
    delivery_liveness = Liveness(stale_after=WORKER_STALE_SECONDS)
    reconcile_liveness = Liveness(stale_after=settings.reconcile_seconds + 60)

    def on_event(event: dict) -> None:
        handle_ari_event(
            queue,
            event,
            database=settings.database,
            inbound_context=settings.inbound_context,
            now=time.time(),
        )

    listener = AriListener(
        url=events_url(settings.ari_url, settings.ari_username, settings.ari_password),
        on_event=on_event,
        state=state,
    )

    @asynccontextmanager
    async def lifespan(_app: FastAPI):
        stop = threading.Event()
        workers = [
            threading.Thread(target=listener.run_forever, args=(stop,), name="ari-events", daemon=True),
            threading.Thread(
                target=_delivery_loop,
                args=(delivery, queue, stop, delivery_liveness),
                name="event-delivery",
                daemon=True,
            ),
            threading.Thread(
                target=_reconcile_loop,
                args=(reconciler, stop, settings.reconcile_seconds, reconcile_liveness),
                name="reconcile",
                daemon=True,
            ),
        ]
        for worker in workers:
            worker.start()
        try:
            yield
        finally:
            stop.set()
            for worker in workers:
                worker.join(timeout=WORKER_JOIN_SECONDS)
            queue.close()

    app = FastAPI(lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)

    registration_route(app, settings, ari, settings.reverse_key)
    link_route(app, settings, settings.reverse_key)

    @app.get("/health")
    async def health() -> dict:
        reachable = await run_in_threadpool(ari.reachable)
        line_state = None
        if settings.line_endpoint:
            line_state = await run_in_threadpool(ari.endpoint_state, settings.line_endpoint)
        free_bytes = await run_in_threadpool(_free_bytes, settings.recordings_dir)
        depth = await run_in_threadpool(_queue_depth, queue)
        now = time.time()
        return snapshot(
            ari_reachable=reachable,
            ari_connected=state.connected,
            line_endpoint=settings.line_endpoint,
            line_state=line_state,
            recordings_free_bytes=free_bytes,
            recordings_min_free_bytes=settings.recordings_min_free_bytes,
            queue_depth=depth,
            delivery_last_success_at=delivery.last_success_at,
            workers={
                "delivery": delivery_liveness.report(now),
                "reconcile": reconcile_liveness.report(now),
            },
            now=now,
        )

    @app.get("/pbx/recordings/{token}")
    async def recording(token: str) -> FileResponse:
        payload = verify_recording_token(
            settings.reverse_key,
            token,
            host=settings.public_host,
            now=int(time.time()),
        )
        path = None if payload is None else recording_path(settings.recordings_dir, payload["call"])
        if path is None:
            raise HTTPException(status_code=404)
        return FileResponse(path, media_type=RECORDING_MEDIA_TYPE)

    return app


def _delivery_loop(delivery: Delivery, queue: EventQueue, stop: threading.Event, liveness: Liveness) -> None:
    last_prune = 0.0
    while not stop.is_set():
        try:
            delivery.run_once()
            moment = time.time()
            if moment - last_prune >= PRUNE_SECONDS:
                queue.prune(now=int(moment))
                last_prune = moment
        except Exception as exc:  # noqa: BLE001 — one bad pass must not end the worker
            log.warning("queue pass skipped: %s", type(exc).__name__)
        finally:
            liveness.beat(time.time())
        stop.wait(DELIVERY_TICK_SECONDS)


def _reconcile_loop(reconciler: Reconciler, stop: threading.Event, interval: int, liveness: Liveness) -> None:
    while not stop.wait(interval):
        try:
            recovered = reconciler.run_once()
        except Exception as exc:  # noqa: BLE001 — one bad pass must not end the worker
            log.warning("reconciliation skipped: %s", type(exc).__name__)
        else:
            if recovered:
                log.info("reconciliation re-enqueued %d call leg(s)", recovered)
        finally:
            liveness.beat(time.time())


def _free_bytes(path: Path) -> int | None:
    try:
        return int(shutil.disk_usage(str(path)).free)
    except OSError:
        return None


def _queue_depth(queue: EventQueue) -> int | None:
    try:
        return queue.depth()
    except sqlite3.Error:
        return None
