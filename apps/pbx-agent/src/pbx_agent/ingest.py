"""Turning one live ARI event into queued rows (design 4.4, 4.5).

A call leg is remembered as delivered only when the call ends. Marking it at the first event would make
reconciliation treat the call as finished, and a call whose end event was lost would stay open in Odoo forever;
with the mark at the end, CEL still rebuilds it.

The recording of a call is announced when a leg of it ends and the stream knows of no leg of it still up: MixMonitor
keeps writing until the channel it runs on hangs up, and that channel is one of the call's legs, so a call may still
be recording while one of its legs is up.

A call counts as live only while the stream keeps proving it active. The leg set is a memory of what the stream saw,
never a fact about Asterisk: an end event lost to a reconnect, an agent restart or a dropped Stasis pairing would
otherwise keep its call live for good, and a live call is a recording Odoo may never delete. So an entry the stream
has not proven active for ``LIVE_LEG_WINDOW_SECONDS`` is dead, and a reconnect empties the set, which is then only a
guess.
"""

from __future__ import annotations

import logging
import threading
import time
from typing import TYPE_CHECKING, NamedTuple

from pbx_agent.events import ari_call_event
from pbx_agent.recordings import announce_recording

if TYPE_CHECKING:
    from collections.abc import Callable
    from pathlib import Path

    from pbx_agent.queue import EventQueue

log = logging.getLogger(__name__)

# How long a leg stays live without the stream proving its call active. A call costs at most a minute of dialling
# plus talk time, so no real call reaches this; it only bounds the damage of an end event that never arrived, which
# would otherwise pin the calls Odoo's retention pass asks for and stop retention for the whole company.
LIVE_LEG_WINDOW_SECONDS = 12 * 60 * 60


class AriIngest:
    """The live stream's writer into the queue: each transition, the legs it finishes, and each finished call's recording.

    Only the stream's thread calls ``handle`` and ``stream_connected``; ``live_call`` is read from the routes' threads,
    so the leg set is locked and the queue keeps its own lock.
    """

    def __init__(
        self,
        queue: EventQueue,
        *,
        database: str,
        inbound_context: str,
        recordings_dir: Path,
        clock: Callable[[], float] = time.time,
    ) -> None:
        self._queue = queue
        self._database = database
        self._inbound_context = inbound_context
        self._recordings_dir = recordings_dir
        self._live = _LiveLegs(clock=clock)

    def handle(self, event: dict, *, now: float) -> None:
        """Store the call event of an ARI event, mark the leg it ended, and announce the call's recording when that
        was the last leg the stream knows of; an event that is not a transition stores nothing."""
        linkedid = _event_linkedid(event)
        if linkedid is not None:
            self._live.observed(linkedid, now=now)
        payload = ari_call_event(event, database=self._database, inbound_context=self._inbound_context, now=now)
        if payload is None:
            return
        moment = int(now)
        self._queue.enqueue(payload, now=moment)
        call = payload["call"]
        if call["state"] == "ringing":
            self._live.started(call["linkedid"], now=now)
        elif call["state"] == "ended":
            self._queue.mark_leg(call["uniqueid"], now=moment)
            if self._live.ended(call["linkedid"]):
                announce_recording(self._queue, self._recordings_dir, payload, now=now)

    def live_call(self, linkedid: str) -> bool:
        """Whether the stream proved a leg of this call up within the window; a recording is not deleted under a
        live call. An entry past the window is dropped here, so a lost end event cannot hold the recording forever."""
        return self._live.live(linkedid)

    def stream_connected(self) -> None:
        """Forget every leg when the ARI stream (re)connects: what the set held was the previous connection's view,
        with every end event the outage swallowed missing from it."""
        self._live.clear()


class _Leg(NamedTuple):
    count: int
    last_seen: float


class _LiveLegs:
    """How many legs each call still has on the stream, and when the stream last proved the call active.

    The count is empty when the agent starts, so the end of a leg the agent never saw start counts as the end of
    its call: a call that spans a restart is announced on its first ending leg, rather than never.
    """

    def __init__(self, *, clock: Callable[[], float]) -> None:
        self._clock = clock
        self._lock = threading.Lock()
        self._live: dict[str, _Leg] = {}

    def started(self, linkedid: str, *, now: float) -> None:
        with self._lock:
            leg = self._live.get(linkedid)
            count = 1 if leg is None else leg.count + 1
            self._live[linkedid] = _Leg(count=count, last_seen=now)

    def observed(self, linkedid: str, *, now: float) -> None:
        """Refresh a call the stream already knows: an event proves an entry active, never creates one."""
        with self._lock:
            leg = self._live.get(linkedid)
            if leg is not None:
                self._live[linkedid] = _Leg(count=leg.count, last_seen=now)

    def ended(self, linkedid: str) -> bool:
        """Count one ended leg; ``True`` when the call has none left."""
        with self._lock:
            leg = self._live.get(linkedid)
            if leg is not None and leg.count > 1:
                self._live[linkedid] = _Leg(count=leg.count - 1, last_seen=leg.last_seen)
                return False
            self._live.pop(linkedid, None)
            return True

    def live(self, linkedid: str) -> bool:
        """Whether the stream proved a leg of this call up within the window; an expired entry is dropped."""
        with self._lock:
            leg = self._live.get(linkedid)
            if leg is None:
                return False
            idle = self._clock() - leg.last_seen
            if idle < LIVE_LEG_WINDOW_SECONDS:
                return True
            del self._live[linkedid]
        # Outside the lock, so the removal that logs is the one that happened and the lock never waits on a handler.
        log.info("live leg expired: call %s last observed %d seconds ago", linkedid, int(idle))
        return False

    def clear(self) -> None:
        with self._lock:
            self._live.clear()


def _event_linkedid(event: dict) -> str | None:
    """The call an ARI event names, by the same rule the event envelope keys it: its linkedid, else its own id."""
    channel = event.get("channel")
    if not isinstance(channel, dict):
        return None
    linkedid = channel.get("linkedid") or channel.get("id")
    return linkedid if isinstance(linkedid, str) and linkedid else None
