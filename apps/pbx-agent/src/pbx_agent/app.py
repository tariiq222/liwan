"""The HTTP surface and the lifecycle of the background work (design 2, 4.1, 4.4, 4.6).

Two routes are public, ``GET /health`` and ``GET /pbx/recordings/<token>``, and seven are called by Odoo alone on the
company's private network: ``POST /registration``, ``DELETE /registration/{extension}``, ``PUT /extensions/{extension}``,
``DELETE /extensions/{extension}``, ``POST /recordings/link``, ``PUT /recording/config`` and
``POST /recordings/delete``. The ARI event stream, the delivery worker, the reconciliation pass and the session reaper
are daemon threads started with the app and stopped with it. The ARI probe, the queue and the disk read the health
report are pushed off the event loop, since each may wait on the network or on SQLite.

A background pass that raises is logged by exception class and the worker keeps its tick: a dead worker thread would
otherwise look exactly like a busy one, which is why the report carries a beat per worker.
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
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import FileResponse

from pbx_agent.ari import AriClient, AriListener, AriTransport, ConnectionState, events_url
from pbx_agent.cel import CelFile
from pbx_agent.delivery import WORKER_STALE_SECONDS, Delivery
from pbx_agent.health import Liveness, snapshot
from pbx_agent.ingest import AriIngest
from pbx_agent.odoo_routes import register_odoo_routes
from pbx_agent.pbx_db import PbxStore, PostgresPbxStore
from pbx_agent.queue import EventQueue
from pbx_agent.reconcile import Reconciler
from pbx_agent.recordings import recording_path
from pbx_agent.sessions import REAP_STALE_SECONDS, REAP_TICK_SECONDS, SessionManager
from pbx_agent.signing import verify_recording_token

if TYPE_CHECKING:
    from collections.abc import Callable
    from pathlib import Path

    from pbx_agent.settings import Settings

log = logging.getLogger(__name__)

DELIVERY_TICK_SECONDS = 1
PRUNE_SECONDS = 3600
WORKER_JOIN_SECONDS = 10
RECORDING_MEDIA_TYPE = "audio/wav"


def create_app(
    settings: Settings,
    ari_client: AriClient | None = None,
    *,
    pbx_store: PbxStore | None = None,
    ingest: AriIngest | None = None,
    clock: Callable[[], float] = time.time,
) -> FastAPI:
    """The HTTP surface.

    ``ari_client``, ``pbx_store`` and ``ingest`` replace the Asterisk ARI client, the PostgreSQL PJSIP store and the
    live-stream writer so tests can drive the routes and health probe without Asterisk or PostgreSQL; when omitted,
    the agent builds them from settings.
    """
    queue = EventQueue(settings.queue_path)
    ari = ari_client if ari_client is not None else AriClient(AriTransport(settings.ari_url, settings.ari_username, settings.ari_password))
    store = pbx_store if pbx_store is not None else PostgresPbxStore(settings.pbx_db_url)
    sessions = SessionManager(settings, store, clock=clock)
    state = ConnectionState()
    stream = ingest if ingest is not None else AriIngest(
        queue,
        database=settings.database,
        inbound_context=settings.inbound_context,
        recordings_dir=settings.recordings_dir,
    )
    reconciler = Reconciler(
        queue,
        CelFile(settings.cel_path),
        database=settings.database,
        inbound_context=settings.inbound_context,
        recordings_dir=settings.recordings_dir,
    )
    delivery = Delivery(queue, url=settings.odoo_events_url, key=settings.events_key)
    delivery_liveness = Liveness(stale_after=WORKER_STALE_SECONDS)
    reconcile_liveness = Liveness(stale_after=settings.reconcile_seconds + 60)
    reaper_liveness = Liveness(stale_after=REAP_STALE_SECONDS)

    def on_event(event: dict) -> None:
        stream.handle(event, now=clock())

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
            threading.Thread(
                target=_reap_loop,
                args=(sessions, stop, reaper_liveness),
                name="session-reaper",
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
            sessions.close()
            queue.close()

    app = FastAPI(lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)

    register_odoo_routes(app, settings, sessions, store, live_call=stream.live_call, clock=clock)

    @app.get("/health")
    async def health() -> dict:
        reachable = await run_in_threadpool(ari.reachable)
        line_state = None
        if settings.line_endpoint:
            line_state = await run_in_threadpool(ari.endpoint_state, settings.line_endpoint)
        free_bytes = await run_in_threadpool(_free_bytes, settings.recordings_dir)
        depth = await run_in_threadpool(_queue_depth, queue)
        now = clock()
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
                "sessions": reaper_liveness.report(now),
            },
            now=now,
        )

    @app.get("/pbx/recordings/{token}")
    async def recording(token: str) -> FileResponse:
        payload = verify_recording_token(
            settings.reverse_key,
            token,
            host=settings.public_host,
            now=int(clock()),
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


def _reap_loop(sessions: SessionManager, stop: threading.Event, liveness: Liveness) -> None:
    while not stop.is_set():
        try:
            sessions.reap()
        except Exception as exc:  # noqa: BLE001 — one bad pass must not end the worker
            log.warning("session reap skipped: %s", type(exc).__name__)
        finally:
            liveness.beat(time.time())
        stop.wait(REAP_TICK_SECONDS)


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
