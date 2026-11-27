import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from pbx_agent.cel import CallLeg  # noqa: E402
from pbx_agent.events import (  # noqa: E402
    ari_call_event,
    cel_call_event,
    iso_utc,
    parse_ari_time,
    recording_ready_event,
)

DATABASE = "liwan_acme"
NOW = 1764050000.0


def channel(**overrides) -> dict:
    base = {
        "id": "1764049999.7",
        "name": "PJSIP/1001-00000007",
        "linkedid": "1764049999.7",
        "state": "Up",
        "caller": {"number": "1001", "name": "Reception"},
        "connected": {"number": "+966500000000"},
        "dialplan": {"context": "from-internal", "exten": "+966500000000"},
    }
    base.update(overrides)
    return base


class AriMappingTest(unittest.TestCase):
    def test_a_new_channel_starts_the_call(self) -> None:
        event = {"type": "ChannelCreated", "timestamp": "2026-11-25T09:00:00.123+0000", "channel": channel()}
        payload = ari_call_event(event, database=DATABASE, inbound_context="from-trunk", now=NOW)
        self.assertEqual(payload["database"], DATABASE)
        self.assertEqual(payload["source"], "ari")
        self.assertFalse(payload["reconciled"])
        self.assertEqual(payload["call"]["state"], "ringing")
        self.assertEqual(payload["call"]["started_at"], "2026-11-25T09:00:00.123000Z")
        self.assertEqual(payload["call"]["ended_at"], None)
        self.assertEqual(payload["call"]["direction"], "out")
        self.assertEqual(payload["call"]["caller_number"], "1001")
        self.assertEqual(payload["call"]["connected_number"], "+966500000000")
        self.assertEqual(payload["call"]["dialed_exten"], "+966500000000")
        self.assertEqual(payload["call"]["linkedid"], "1764049999.7")
        self.assertEqual(payload["call"]["uniqueid"], "1764049999.7")

    def test_an_answered_channel_marks_the_answer(self) -> None:
        event = {"type": "ChannelStateChange", "timestamp": "2026-11-25T09:00:05.000+0000", "channel": channel()}
        payload = ari_call_event(event, database=DATABASE, inbound_context="from-trunk", now=NOW)
        self.assertEqual(payload["call"]["state"], "answered")
        self.assertEqual(payload["call"]["answered_at"], "2026-11-25T09:00:05Z")
        self.assertIsNone(payload["call"]["started_at"])

    def test_a_ringing_state_is_not_a_transition(self) -> None:
        event = {"type": "ChannelStateChange", "channel": channel(state="Ring")}
        self.assertIsNone(ari_call_event(event, database=DATABASE, inbound_context="from-trunk", now=NOW))

    def test_a_destroyed_channel_ends_the_call(self) -> None:
        event = {"type": "ChannelDestroyed", "timestamp": "2026-11-25T09:01:00.000+0000", "channel": channel()}
        payload = ari_call_event(event, database=DATABASE, inbound_context="from-trunk", now=NOW)
        self.assertEqual(payload["call"]["state"], "ended")
        self.assertEqual(payload["call"]["ended_at"], "2026-11-25T09:01:00Z")

    def test_the_inbound_context_marks_an_incoming_call(self) -> None:
        event = {"type": "ChannelCreated", "channel": channel(dialplan={"context": "from-trunk", "exten": "1001"})}
        payload = ari_call_event(event, database=DATABASE, inbound_context="from-trunk", now=NOW)
        self.assertEqual(payload["call"]["direction"], "in")

    def test_events_without_a_usable_channel_are_ignored(self) -> None:
        for event in (
            {"type": "ChannelCreated"},
            {"type": "ChannelCreated", "channel": {"name": "x"}},
            {"type": "Dial", "channel": channel()},
            {"type": "Ping"},
        ):
            self.assertIsNone(ari_call_event(event, database=DATABASE, inbound_context="from-trunk", now=NOW))

    def test_a_missing_linkedid_falls_back_to_the_channel_id(self) -> None:
        event = {"type": "ChannelCreated", "channel": channel(linkedid=None)}
        payload = ari_call_event(event, database=DATABASE, inbound_context="from-trunk", now=NOW)
        self.assertEqual(payload["call"]["linkedid"], "1764049999.7")

    def test_an_unparseable_timestamp_falls_back_to_now(self) -> None:
        event = {"type": "ChannelCreated", "timestamp": "whenever", "channel": channel()}
        payload = ari_call_event(event, database=DATABASE, inbound_context="from-trunk", now=NOW)
        self.assertEqual(payload["call"]["started_at"], iso_utc(NOW))

    def test_asterisk_timestamps_are_normalized(self) -> None:
        self.assertEqual(parse_ari_time("2026-11-25T09:00:00.123+0000"), "2026-11-25T09:00:00.123000Z")
        self.assertEqual(parse_ari_time("2026-11-25T12:00:00+0300"), "2026-11-25T09:00:00Z")
        self.assertIsNone(parse_ari_time(""))
        self.assertIsNone(parse_ari_time(None))
        self.assertIsNone(parse_ari_time("not a time"))


class CelMappingTest(unittest.TestCase):
    def test_a_recovered_leg_is_one_complete_event(self) -> None:
        leg = CallLeg(
            uniqueid="1764049999.8",
            linkedid="1764049999.8",
            channel="PJSIP/trunk-00000008",
            caller_number="+966511111111",
            dialed_exten="1001",
            context="from-trunk",
            started_at="2026-11-25T09:00:00Z",
            answered_at="2026-11-25T09:00:04Z",
            ended_at="2026-11-25T09:02:00Z",
        )
        payload = cel_call_event(leg, database=DATABASE, inbound_context="from-trunk", now=NOW)
        self.assertEqual(payload["source"], "cel")
        self.assertTrue(payload["reconciled"])
        self.assertEqual(payload["occurred_at"], "2026-11-25T09:02:00Z")
        self.assertEqual(payload["call"]["state"], "ended")
        self.assertEqual(payload["call"]["direction"], "in")
        self.assertEqual(payload["call"]["started_at"], "2026-11-25T09:00:00Z")
        self.assertEqual(payload["call"]["answered_at"], "2026-11-25T09:00:04Z")
        self.assertIsNone(payload["call"]["connected_number"])

    def test_a_leg_cel_never_closed_is_reported_as_failed(self) -> None:
        leg = CallLeg(
            uniqueid="1764049999.9",
            linkedid="1764049999.9",
            channel="PJSIP/trunk-00000009",
            caller_number="+966511111111",
            dialed_exten="1001",
            context="from-trunk",
            started_at="2026-11-25T01:00:00Z",
            answered_at=None,
            ended_at="2026-11-25T01:00:00Z",
            abandoned=True,
        )
        payload = cel_call_event(leg, database=DATABASE, inbound_context="from-trunk", now=NOW)
        self.assertEqual(payload["call"]["state"], "failed")
        self.assertEqual(payload["call"]["ended_at"], "2026-11-25T01:00:00Z")


class RecordingReadyEventTest(unittest.TestCase):
    def test_the_recording_event_is_the_ended_call_with_the_recording_and_a_new_time(self) -> None:
        event = {"type": "ChannelDestroyed", "timestamp": "2026-11-25T09:01:00.000+0000", "channel": channel()}
        ended = ari_call_event(event, database=DATABASE, inbound_context="from-trunk", now=NOW)
        ready = recording_ready_event(ended, now=NOW)
        self.assertEqual(ready["call"], {**ended["call"], "recording": "ready"})
        self.assertEqual(ready["call"]["state"], "ended")
        self.assertEqual(ready["occurred_at"], iso_utc(NOW))
        self.assertEqual(ready["database"], DATABASE)
        self.assertEqual(ready["source"], "ari")
        self.assertFalse(ready["reconciled"])
        # The ended event it was built from is left as it was queued.
        self.assertNotIn("recording", ended["call"])
        self.assertEqual(ended["occurred_at"], "2026-11-25T09:01:00Z")

    def test_a_recovered_call_announces_its_recording_as_reconciled(self) -> None:
        leg = CallLeg(
            uniqueid="1764049999.8",
            linkedid="1764049999.8",
            channel="PJSIP/trunk-00000008",
            caller_number="+966511111111",
            dialed_exten="1001",
            context="from-trunk",
            started_at="2026-11-25T09:00:00Z",
            answered_at="2026-11-25T09:00:04Z",
            ended_at="2026-11-25T09:02:00Z",
        )
        ended = cel_call_event(leg, database=DATABASE, inbound_context="from-trunk", now=NOW)
        ready = recording_ready_event(ended, now=NOW)
        self.assertEqual(ready["call"], {**ended["call"], "recording": "ready"})
        self.assertEqual(ready["source"], "cel")
        self.assertTrue(ready["reconciled"])
        self.assertEqual(ready["occurred_at"], iso_utc(NOW))


if __name__ == "__main__":
    unittest.main()
