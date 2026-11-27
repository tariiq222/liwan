"""The periodic comparison of Asterisk CEL with what already reached the queue (design 4.4, 4.6).

A call whose events were lost before the queue is recovered from CEL: every completed leg the queue has never seen
is re-enqueued once, in the same envelope the stream uses, and its recording is announced when the file exists.

The stored offset never moves past the first row of a leg that has not ended, or of one that ended moments ago, so a
call that spans two passes is rebuilt from all of its rows and a just-finished call waits for its live end event. The
offset is tied to the file it came from: a rotated or rewritten file is read from the start. A queue with no stored
state adopts the file as it stands, because history from before this agent existed is not resent: doing so would mint
new event ids for calls Odoo may already hold.
"""

from __future__ import annotations

import time
from typing import TYPE_CHECKING

from pbx_agent.cel import ABSENT_IDENTITY
from pbx_agent.events import cel_call_event
from pbx_agent.recordings import announce_recording

if TYPE_CHECKING:
    from collections.abc import Callable
    from pathlib import Path

    from pbx_agent.cel import CelFile
    from pbx_agent.queue import EventQueue

CEL_OFFSET = "cel_offset"
CEL_IDENTITY = "cel_identity"


class Reconciler:
    """One pass over what CEL appended since the last one; the caller decides how often to run it."""

    def __init__(
        self,
        queue: EventQueue,
        source: CelFile,
        *,
        database: str,
        inbound_context: str,
        recordings_dir: Path,
        clock: Callable[[], float] = time.time,
    ) -> None:
        self._queue = queue
        self._source = source
        self._database = database
        self._inbound_context = inbound_context
        self._recordings_dir = recordings_dir
        self._clock = clock

    def run_once(self) -> int:
        """Read what CEL appended since the last pass, re-enqueue each finished leg the queue never saw, and announce
        the recording of each such call whose file exists."""
        try:
            identity = self._source.identity()
        except OSError:
            # No file yet: nothing to read, and a file that appears later starts this agent's history at byte 0.
            self._queue.meta_set(CEL_OFFSET, "0")
            self._queue.meta_set(CEL_IDENTITY, ABSENT_IDENTITY)
            return 0
        stored_offset = self._queue.meta_get(CEL_OFFSET)
        if stored_offset is None:
            self._queue.meta_set(CEL_OFFSET, str(self._source.size()))
            self._queue.meta_set(CEL_IDENTITY, identity)
            return 0
        offset = 0 if self._queue.meta_get(CEL_IDENTITY) != identity else int(stored_offset or 0)
        now = self._clock()
        batch = self._source.read(offset, now=now)
        moment = int(now)
        recovered = 0
        for leg in batch.legs:
            payload = cel_call_event(
                leg,
                database=self._database,
                inbound_context=self._inbound_context,
                now=moment,
            )
            if self._queue.enqueue_for_leg(leg.uniqueid, payload, now=moment) is not None:
                recovered += 1
                announce_recording(self._queue, self._recordings_dir, payload, now=now)
        # An open leg, or one that ended moments ago, keeps the offset at its first row for the next pass.
        safe_offset = batch.hold_start if batch.hold_start is not None else batch.offset
        self._queue.meta_set(CEL_OFFSET, str(safe_offset))
        self._queue.meta_set(CEL_IDENTITY, identity)
        return recovered
