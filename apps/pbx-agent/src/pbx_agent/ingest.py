"""Turning one live ARI event into queued rows (design 4.4, 4.5).

A call leg is remembered as delivered only when the call ends. Marking it at the first event would make
reconciliation treat the call as finished, and a call whose end event was lost would stay open in Odoo forever;
with the mark at the end, CEL still rebuilds it.

The recording of a call is announced when a leg of it ends and the stream knows of no leg of it still up: MixMonitor
keeps writing until the channel it runs on hangs up, and that channel is one of the call's legs, so a call may still
be recording while one of its legs is up.
"""

from __future__ import annotations

import threading
from typing import TYPE_CHECKING

from pbx_agent.events import ari_call_event
from pbx_agent.recordings import announce_recording

if TYPE_CHECKING:
    from pathlib import Path

    from pbx_agent.queue import EventQueue


class AriIngest:
    """The live stream's writer into the queue: each transition, the legs it finishes, and each finished call's recording.

    Only the stream's thread calls ``handle``; ``live_call`` is read from the routes' threads, so the leg count is
    locked and the queue keeps its own lock.
    """

    def __init__(self, queue: EventQueue, *, database: str, inbound_context: str, recordings_dir: Path) -> None:
        self._queue = queue
        self._database = database
        self._inbound_context = inbound_context
        self._recordings_dir = recordings_dir
        self._live = _LiveLegs()

    def handle(self, event: dict, *, now: float) -> None:
        """Store the call event of an ARI event, mark the leg it ended, and announce the call's recording when that
        was the last leg the stream knows of; an event that is not a transition stores nothing."""
        payload = ari_call_event(event, database=self._database, inbound_context=self._inbound_context, now=now)
        if payload is None:
            return
        moment = int(now)
        self._queue.enqueue(payload, now=moment)
        call = payload["call"]
        if call["state"] == "ringing":
            self._live.started(call["linkedid"])
        elif call["state"] == "ended":
            self._queue.mark_leg(call["uniqueid"], now=moment)
            if self._live.ended(call["linkedid"]):
                announce_recording(self._queue, self._recordings_dir, payload, now=now)

    def live_call(self, linkedid: str) -> bool:
        """Whether the stream knows a leg of this call still up; a recording is not deleted under a live call."""
        return self._live.live(linkedid)


class _LiveLegs:
    """How many legs each call still has on the stream, counted from the channel events themselves.

    The count is empty when the agent starts, so the end of a leg the agent never saw start counts as the end of
    its call: a call that spans a restart is announced on its first ending leg, rather than never.
    """

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._live: dict[str, int] = {}

    def started(self, linkedid: str) -> None:
        with self._lock:
            self._live[linkedid] = self._live.get(linkedid, 0) + 1

    def ended(self, linkedid: str) -> bool:
        """Count one ended leg; ``True`` when the call has none left."""
        with self._lock:
            remaining = self._live.get(linkedid, 0) - 1
            if remaining > 0:
                self._live[linkedid] = remaining
                return False
            self._live.pop(linkedid, None)
            return True

    def live(self, linkedid: str) -> bool:
        with self._lock:
            return self._live.get(linkedid, 0) > 0
