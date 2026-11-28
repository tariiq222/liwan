"""Which calls the stream still counts as live, and for how long it can claim that (design 4.4).

A leg is remembered from the events the stream saw, so its end event is the only thing that forgets it. These tests
pin the two ways that memory is bounded: the window that expires a call the stream stopped proving active, and the
reconnect that empties a set which is then only a guess.
"""

from __future__ import annotations

import logging
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from pbx_agent.ingest import LIVE_LEG_WINDOW_SECONDS, AriIngest  # noqa: E402
from pbx_agent.queue import EventQueue  # noqa: E402

DATABASE = "liwan_acme"
NOW = 1795597800.0  # 2026-11-25T09:10:00Z
CALL = "1764049999.7"  # the linkedid: the first channel's own id
AGENT_LEG = "1764049999.8"


def channel_event(kind: str, uniqueid: str, *, state: str = "Up") -> dict:
    """One ARI channel event of the call: the channel's own id, and the call's linkedid."""
    return {
        "type": kind,
        "timestamp": "2026-11-25T09:01:00.000+0000",
        "channel": {
            "id": uniqueid,
            "linkedid": CALL,
            "name": f"PJSIP/{uniqueid}",
            "state": state,
            "caller": {"number": "+966500000000"},
            "connected": {"number": "1001"},
            "dialplan": {"context": "from-trunk", "exten": "1001"},
        },
    }


class LiveLegTest(unittest.TestCase):
    """The window on a live leg and the reconnect that empties the set."""

    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        root = Path(self.temporary.name)
        self.recordings = root / "monitor"
        self.recordings.mkdir()
        self.queue = EventQueue(root / "queue.sqlite3")
        self.addCleanup(self.queue.close)
        self.now = NOW
        self.stream = AriIngest(
            self.queue,
            database=DATABASE,
            inbound_context="from-trunk",
            recordings_dir=self.recordings,
            clock=lambda: self.now,
        )

    def ring(self) -> None:
        self.stream.handle(channel_event("ChannelCreated", CALL, state="Ring"), now=NOW)

    def test_a_call_with_no_leg_the_stream_saw_is_not_live(self) -> None:
        self.assertFalse(self.stream.live_call(CALL))

    def test_a_fresh_leg_is_live_everywhere_inside_the_window(self) -> None:
        self.ring()
        self.assertTrue(self.stream.live_call(CALL))
        self.now = NOW + LIVE_LEG_WINDOW_SECONDS - 1
        self.assertTrue(self.stream.live_call(CALL))

    def test_a_leg_the_stream_stopped_proving_is_not_live_and_is_dropped_once(self) -> None:
        self.ring()
        self.now = NOW + LIVE_LEG_WINDOW_SECONDS
        with self.assertLogs("pbx_agent.ingest", level=logging.INFO) as logs:
            self.assertFalse(self.stream.live_call(CALL))
            # The entry is gone, so the same question is answered without a second line.
            self.assertFalse(self.stream.live_call(CALL))
        self.assertEqual(len(logs.output), 1, logs.output)
        self.assertIn(f"call {CALL}", logs.output[0])

    def test_an_event_that_proves_the_call_active_refreshes_its_window(self) -> None:
        self.ring()
        self.stream.handle(channel_event("ChannelStateChange", CALL, state="Ring"), now=NOW + LIVE_LEG_WINDOW_SECONDS - 60)
        self.now = NOW + LIVE_LEG_WINDOW_SECONDS + 60
        self.assertTrue(self.stream.live_call(CALL))

    def test_an_event_alone_never_makes_a_call_live(self) -> None:
        self.stream.handle(channel_event("ChannelStateChange", CALL), now=NOW)
        self.assertFalse(self.stream.live_call(CALL))

    def test_a_leg_with_another_leg_up_stays_live_after_one_ends(self) -> None:
        self.ring()
        self.stream.handle(channel_event("ChannelCreated", AGENT_LEG), now=NOW)
        self.stream.handle(channel_event("ChannelDestroyed", AGENT_LEG), now=NOW)
        self.assertTrue(self.stream.live_call(CALL))

    def test_a_reconnect_clears_every_leg(self) -> None:
        self.ring()
        self.stream.stream_connected()
        self.assertFalse(self.stream.live_call(CALL))

    def test_a_leg_seen_after_a_reconnect_is_live_again(self) -> None:
        self.ring()
        self.stream.stream_connected()
        self.stream.handle(channel_event("ChannelCreated", AGENT_LEG), now=NOW)
        self.assertTrue(self.stream.live_call(CALL))


if __name__ == "__main__":
    unittest.main()
