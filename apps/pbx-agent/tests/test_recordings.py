import json
import sys
import tempfile
import unittest
from pathlib import Path

from fakes import Recorder

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from pbx_agent.delivery import Delivery  # noqa: E402
from pbx_agent.events import ari_call_event, iso_utc  # noqa: E402
from pbx_agent.ingest import AriIngest  # noqa: E402
from pbx_agent.queue import EventQueue  # noqa: E402
from pbx_agent.recordings import announce_recording, recording_path  # noqa: E402
from pbx_agent.signing import EVENT_SIGNATURE_HEADER, EVENT_TIMESTAMP_HEADER, event_signature  # noqa: E402

KEY = bytes.fromhex("ab" * 32)
URL = "http://odoo:8069/api/v1/telephony/events"
DATABASE = "liwan_acme"
NOW = 1795597800.0  # 2026-11-25T09:10:00Z
CALL = "1764049999.7"  # the linkedid: the first channel's own id, and the name of its recording
TRUNK = "1764049999.7"  # the first channel; in this package it is the one MixMonitor runs on
AGENT = "1764049999.8"  # the channel of the extension the trunk dialled


def ari_event(kind: str, uniqueid: str) -> dict:
    """One channel event of the call: the channel's own id, and the call's linkedid."""
    return {
        "type": kind,
        "timestamp": "2026-11-25T09:01:00.000+0000",
        "channel": {
            "id": uniqueid,
            "linkedid": CALL,
            "name": f"PJSIP/{uniqueid}",
            "state": "Up",
            "caller": {"number": "+966500000000"},
            "connected": {"number": "1001"},
            "dialplan": {"context": "from-trunk", "exten": "1001"},
        },
    }


def ended_envelope() -> dict:
    return ari_call_event(ari_event("ChannelDestroyed", TRUNK), database=DATABASE, inbound_context="from-trunk", now=NOW)


class RecordingPathTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name) / "recordings"
        self.root.mkdir()

    def test_a_known_call_resolves_inside_the_directory(self) -> None:
        call_id = "1700000000.42"
        (self.root / f"{call_id}.wav").write_bytes(b"RIFF")
        self.assertEqual(recording_path(self.root, call_id), (self.root / f"{call_id}.wav").resolve())

    def test_traversal_attempts_are_refused(self) -> None:
        outside = Path(self.temporary.name) / "secret.wav"
        outside.write_bytes(b"secret")
        for call_id in (
            "",
            ".",
            "..",
            "../secret",
            "../../etc/passwd",
            "/etc/passwd",
            "a/b",
            "a\\b",
            "..%2fsecret",
            "1700000000.42\x00",
        ):
            self.assertIsNone(recording_path(self.root, call_id), call_id)

    def test_a_missing_file_is_not_found(self) -> None:
        self.assertIsNone(recording_path(self.root, "1700000000.99"))

    def test_a_symlink_leaving_the_directory_is_refused(self) -> None:
        outside = Path(self.temporary.name) / "outside.wav"
        outside.write_bytes(b"secret")
        (self.root / "1700000000.42.wav").symlink_to(outside)
        self.assertIsNone(recording_path(self.root, "1700000000.42"))

    def test_a_directory_named_like_a_recording_is_refused(self) -> None:
        (self.root / "1700000000.42.wav").mkdir()
        self.assertIsNone(recording_path(self.root, "1700000000.42"))

    def test_a_non_string_is_refused(self) -> None:
        self.assertIsNone(recording_path(self.root, None))


class QueueCase(unittest.TestCase):
    """A queue and a recordings directory: what announcing a recording needs."""

    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.monitor = self.root / "monitor"
        self.monitor.mkdir()
        self.path = self.root / "queue.sqlite3"
        self.queue = EventQueue(self.path)
        self.addCleanup(self.queue.close)

    def record(self, call: str = CALL) -> None:
        """What MixMonitor leaves: the file is there from the moment the call is bridged."""
        (self.monitor / f"{call}.wav").write_bytes(b"RIFF")


class AnnounceRecordingTest(QueueCase):
    def test_the_announcement_is_queued_once_per_call(self) -> None:
        self.record()
        self.assertIsNotNone(announce_recording(self.queue, self.monitor, ended_envelope(), now=NOW))
        self.assertIsNone(announce_recording(self.queue, self.monitor, ended_envelope(), now=NOW))
        self.assertEqual(self.queue.depth(), 1)

    def test_a_call_without_a_file_queues_nothing(self) -> None:
        self.assertIsNone(announce_recording(self.queue, self.monitor, ended_envelope(), now=NOW))
        self.assertEqual(self.queue.depth(), 0)

    def test_a_call_id_that_leaves_the_directory_announces_nothing(self) -> None:
        (self.root / "secret.wav").write_bytes(b"secret")
        ended = ended_envelope()
        ended["call"]["linkedid"] = "../secret"
        self.assertIsNone(announce_recording(self.queue, self.monitor, ended, now=NOW))
        self.assertEqual(self.queue.depth(), 0)


class RecordingReadyTest(QueueCase):
    def setUp(self) -> None:
        super().setUp()
        self.stream = AriIngest(self.queue, database=DATABASE, inbound_context="from-trunk", recordings_dir=self.monitor)

    def bodies(self) -> list[dict]:
        return [json.loads(event.body) for event in self.queue.due(now=int(NOW) + 1)]

    def announced(self) -> list[dict]:
        return [body for body in self.bodies() if "recording" in body["call"]]

    def test_a_call_is_announced_once_its_last_leg_is_gone(self) -> None:
        self.record()
        self.stream.handle(ari_event("ChannelCreated", TRUNK), now=NOW)
        self.stream.handle(ari_event("ChannelCreated", AGENT), now=NOW)
        self.stream.handle(ari_event("ChannelDestroyed", AGENT), now=NOW)
        self.assertEqual(self.announced(), [])  # the trunk leg, the one MixMonitor runs on, is still up
        self.stream.handle(ari_event("ChannelDestroyed", TRUNK), now=NOW)
        ready = self.announced()
        self.assertEqual(len(ready), 1)
        self.assertEqual(
            ready[0]["call"],
            {
                "linkedid": CALL,
                "uniqueid": TRUNK,
                "channel": f"PJSIP/{TRUNK}",
                "direction": "in",
                "caller_number": "+966500000000",
                "connected_number": "1001",
                "dialed_exten": "1001",
                "state": "ended",
                "started_at": None,
                "answered_at": None,
                "ended_at": "2026-11-25T09:01:00Z",
                "recording": "ready",
            },
        )
        self.assertEqual(ready[0]["occurred_at"], iso_utc(NOW))
        self.assertEqual(ready[0]["database"], DATABASE)
        self.assertEqual(ready[0]["source"], "ari")
        self.assertFalse(ready[0]["reconciled"])
        self.assertEqual(len(self.bodies()), 5)
        self.assertEqual(len({body["event_id"] for body in self.bodies()}), 5)
        # A leg of the same call that ends later, one the stream never saw start: nothing more.
        self.stream.handle(ari_event("ChannelDestroyed", "1764049999.9"), now=NOW)
        self.assertEqual(len(self.announced()), 1)
        self.assertEqual(len(self.bodies()), 6)

    def test_a_call_without_its_own_file_is_never_announced(self) -> None:
        self.record("1764049999.6")  # another call's recording is not this call's
        self.stream.handle(ari_event("ChannelCreated", TRUNK), now=NOW)
        self.stream.handle(ari_event("ChannelDestroyed", TRUNK), now=NOW)
        self.assertEqual(self.announced(), [])
        self.assertEqual([body["call"]["state"] for body in self.bodies()], ["ringing", "ended"])

    def test_the_announcement_is_never_repeated_after_a_restart(self) -> None:
        self.record()
        self.stream.handle(ari_event("ChannelDestroyed", TRUNK), now=NOW)
        first = self.announced()
        self.assertEqual(len(first), 1)
        self.queue.close()
        reopened = EventQueue(self.path)
        self.addCleanup(reopened.close)
        restarted = AriIngest(reopened, database=DATABASE, inbound_context="from-trunk", recordings_dir=self.monitor)
        restarted.handle(ari_event("ChannelDestroyed", AGENT), now=NOW)
        bodies = [json.loads(event.body) for event in reopened.due(now=int(NOW) + 1)]
        self.assertEqual([body for body in bodies if "recording" in body["call"]], first)
        self.assertEqual(len(bodies), 3)

    def test_a_call_that_spans_a_restart_is_announced_on_its_first_ending_leg(self) -> None:
        """An agent that starts mid-call has no leg count, so the first leg it sees end counts as the call's last."""
        self.record()
        self.stream.handle(ari_event("ChannelDestroyed", AGENT), now=NOW)
        self.assertEqual([body["call"]["uniqueid"] for body in self.announced()], [AGENT])

    def test_the_announcement_is_delivered_with_its_signature_like_every_event(self) -> None:
        self.record()
        self.stream.handle(ari_event("ChannelCreated", TRUNK), now=NOW)
        self.stream.handle(ari_event("ChannelDestroyed", TRUNK), now=NOW)
        stored = [event.body for event in self.queue.due(now=int(NOW))]
        self.assertEqual(len(stored), 3)
        recorder = Recorder([200, 200, 200])
        delivery = Delivery(self.queue, url=URL, key=KEY, post=recorder, clock=lambda: NOW)
        self.assertEqual(delivery.run_once(), 3)
        self.assertEqual([call["body"] for call in recorder.calls], stored)
        self.assertEqual(self.queue.depth(), 0)
        ready = next(call for call in recorder.calls if json.loads(call["body"])["call"].get("recording"))
        self.assertEqual(ready["url"], URL)
        self.assertEqual(ready["headers"][EVENT_TIMESTAMP_HEADER], str(int(NOW)))
        self.assertEqual(ready["headers"][EVENT_SIGNATURE_HEADER], event_signature(KEY, int(NOW), ready["body"]))


if __name__ == "__main__":
    unittest.main()
