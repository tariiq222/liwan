import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from pbx_agent.cel import (  # noqa: E402
    COLUMN,
    LIVE_RACE_SETTLE_SECONDS,
    CelFile,
    legs_from_rows,
    read_rows,
)
from pbx_agent.events import iso_utc  # noqa: E402
from pbx_agent.ingest import AriIngest  # noqa: E402
from pbx_agent.queue import LEG_RETENTION_SECONDS, EventQueue  # noqa: E402
from pbx_agent.reconcile import CEL_IDENTITY, CEL_OFFSET, Reconciler  # noqa: E402

DATABASE = "liwan_acme"
NOW = 1795597800.0  # 2026-11-25T09:10:00Z, after every call the fixtures describe
RECENTLY_ENDED_NOW = NOW - 8 * 60 + 30  # 09:02:30, 30 seconds after the first fixture call ended


def row(eventtype, eventtime, uniqueid, linkedid, channel, caller, exten, context, appdata="", *, quote=True) -> str:
    fields = [""] * len(COLUMN)
    fields[COLUMN["eventtype"]] = eventtype
    fields[COLUMN["eventtime"]] = eventtime
    fields[COLUMN["uniqueid"]] = uniqueid
    fields[COLUMN["linkedid"]] = linkedid
    fields[COLUMN["channame"]] = channel
    fields[COLUMN["cidnum"]] = caller
    fields[COLUMN["exten"]] = exten
    fields[COLUMN["context"]] = context
    fields[COLUMN["appdata"]] = appdata
    if quote:
        # What cel_custom writes with comma quoting: a field containing a comma is wrapped in double quotes.
        return ",".join(f'"{value}"' if "," in value else value for value in fields)
    return ",".join(fields)


COMPLETE_LEG = [
    row("CHAN_START", "2026-11-25 09:00:00", "1.1", "1.1", "PJSIP/trunk-1", "+966511111111", "1001", "from-trunk"),
    row("ANSWER", "2026-11-25 09:00:04", "1.1", "1.1", "PJSIP/trunk-1", "+966511111111", "1001", "from-trunk"),
    row("HANGUP", "2026-11-25 09:02:00", "1.1", "1.1", "PJSIP/trunk-1", "+966511111111", "1001", "from-trunk"),
]
SECOND_LEG = [
    row("CHAN_START", "2026-11-25 09:03:00", "2.2", "2.2", "PJSIP/1001-2", "1001", "+966522222222", "from-internal"),
    row("HANGUP", "2026-11-25 09:04:00", "2.2", "2.2", "PJSIP/1001-2", "1001", "+966522222222", "from-internal"),
]
# The extension's side of the first call: another channel of the same linkedid, ending a moment later.
SAME_CALL_LEG = [
    row("CHAN_START", "2026-11-25 09:00:01", "1.9", "1.1", "PJSIP/1001-9", "1001", "1001", "from-internal"),
    row("HANGUP", "2026-11-25 09:02:01", "1.9", "1.1", "PJSIP/1001-9", "1001", "1001", "from-internal"),
]
UNFINISHED_LEG = [
    row("CHAN_START", "2026-11-25 09:05:00", "3.3", "3.3", "PJSIP/trunk-3", "+966533333333", "1001", "from-trunk"),
]
OLD_OPEN_LEG = [
    row("CHAN_START", "2026-11-25 01:00:00", "4.4", "4.4", "PJSIP/trunk-4", "+966544444444", "1001", "from-trunk"),
]
DIAL_ROW = row(
    "Dial",
    "2026-11-25 09:00:01",
    "1.1",
    "1.1",
    "PJSIP/trunk-1",
    "+966511111111",
    "1001",
    "from-trunk",
    "PJSIP/1001,30",
)


def lines(rows: list[str]) -> bytes:
    return "".join(f"{line}\n" for line in rows).encode("utf-8")


def ari_event(kind: str, uniqueid: str = "1.1") -> dict:
    return {
        "type": kind,
        "timestamp": "2026-11-25T09:00:00.000+0000",
        "channel": {
            "id": uniqueid,
            "linkedid": "1.1",
            "name": "PJSIP/trunk-1",
            "state": "Up",
            "caller": {"number": "+966511111111"},
            "connected": {},
            "dialplan": {"context": "from-trunk", "exten": "1001"},
        },
    }


class CelParsingTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.path = Path(self.temporary.name) / "cel.csv"

    def test_only_complete_legs_are_rebuilt(self) -> None:
        self.path.write_bytes(lines(COMPLETE_LEG + UNFINISHED_LEG))
        rows, offset, skipped = read_rows(self.path, 0)
        self.assertEqual(skipped, 0)
        self.assertEqual(offset, self.path.stat().st_size)
        legs, hold_start = legs_from_rows(rows, now=NOW)
        self.assertEqual([leg.uniqueid for leg in legs], ["1.1"])
        self.assertEqual(hold_start, len(lines(COMPLETE_LEG)))
        self.assertEqual(legs[0].started_at, "2026-11-25T09:00:00Z")
        self.assertEqual(legs[0].answered_at, "2026-11-25T09:00:04Z")
        self.assertEqual(legs[0].ended_at, "2026-11-25T09:02:00Z")
        self.assertEqual(legs[0].caller_number, "+966511111111")
        self.assertEqual(legs[0].context, "from-trunk")

    def test_a_quoted_dial_row_with_commas_parses(self) -> None:
        self.path.write_bytes(lines([COMPLETE_LEG[0], DIAL_ROW, COMPLETE_LEG[2]]))
        rows, _offset, skipped = read_rows(self.path, 0)
        self.assertEqual(skipped, 0)
        self.assertEqual(rows[1].fields[COLUMN["appdata"]], "PJSIP/1001,30")
        legs, hold_start = legs_from_rows(rows, now=NOW)
        self.assertEqual([leg.uniqueid for leg in legs], ["1.1"])
        self.assertIsNone(hold_start)

    def test_an_unquoted_comma_row_is_skipped_without_blocking_later_rows(self) -> None:
        broken = row(
            "Dial",
            "2026-11-25 09:00:01",
            "1.1",
            "1.1",
            "PJSIP/trunk-1",
            "+966511111111",
            "1001",
            "from-trunk",
            "PJSIP/1001,30",
            quote=False,
        )
        self.path.write_bytes(lines([COMPLETE_LEG[0], broken, COMPLETE_LEG[2]] + SECOND_LEG))
        rows, offset, skipped = read_rows(self.path, 0)
        self.assertEqual(skipped, 1)
        legs, hold_start = legs_from_rows(rows, now=NOW)
        self.assertEqual([leg.uniqueid for leg in legs], ["1.1", "2.2"])
        self.assertIsNone(hold_start)
        self.assertEqual(offset, self.path.stat().st_size)

    def test_a_young_open_leg_keeps_the_offset_at_its_first_row(self) -> None:
        self.path.write_bytes(lines([COMPLETE_LEG[0]]))
        rows, _offset, _skipped = read_rows(self.path, 0)
        legs, hold_start = legs_from_rows(rows, now=NOW)
        self.assertEqual(legs, ())
        self.assertEqual(hold_start, 0)

    def test_an_open_leg_past_the_bound_is_sent_as_failed_and_releases_the_offset(self) -> None:
        self.path.write_bytes(lines(OLD_OPEN_LEG))
        rows, _offset, _skipped = read_rows(self.path, 0)
        legs, hold_start = legs_from_rows(rows, now=NOW)
        self.assertEqual(len(legs), 1)
        self.assertTrue(legs[0].abandoned)
        self.assertEqual(legs[0].started_at, "2026-11-25T01:00:00Z")
        self.assertEqual(legs[0].ended_at, "2026-11-25T01:00:00Z")
        self.assertIsNone(hold_start)

    def test_a_leg_that_ended_moments_ago_is_held_for_the_live_event(self) -> None:
        self.path.write_bytes(lines(COMPLETE_LEG))
        rows, _offset, _skipped = read_rows(self.path, 0)
        legs, hold_start = legs_from_rows(rows, now=RECENTLY_ENDED_NOW)
        self.assertEqual(legs, ())
        self.assertEqual(hold_start, 0)
        legs, hold_start = legs_from_rows(rows, now=RECENTLY_ENDED_NOW + LIVE_RACE_SETTLE_SECONDS)
        self.assertEqual([leg.uniqueid for leg in legs], ["1.1"])
        self.assertIsNone(hold_start)

    def test_a_partial_last_line_waits_for_its_newline(self) -> None:
        complete = lines(COMPLETE_LEG)
        self.path.write_bytes(complete + COMPLETE_LEG[-1][:20].encode("utf-8"))
        rows, offset, _skipped = read_rows(self.path, 0)
        self.assertEqual(len(rows), 3)
        self.assertEqual(offset, len(complete))
        rows, _offset, _skipped = read_rows(self.path, offset)
        self.assertEqual(rows, [])

    def test_a_broken_row_is_counted_and_skipped(self) -> None:
        self.path.write_bytes(b"too,few,fields\n" + lines(COMPLETE_LEG))
        rows, _offset, skipped = read_rows(self.path, 0)
        self.assertEqual(skipped, 1)
        self.assertEqual(len(legs_from_rows(rows, now=NOW)[0]), 1)

    def test_a_rotated_file_is_read_from_the_start(self) -> None:
        self.path.write_bytes(lines(COMPLETE_LEG))
        rows, offset, _skipped = read_rows(self.path, 10**6)
        self.assertEqual(offset, self.path.stat().st_size)
        self.assertEqual(len(rows), 3)

    def test_the_file_identity_changes_when_the_content_is_rewritten(self) -> None:
        source = CelFile(self.path)
        self.path.write_bytes(lines(COMPLETE_LEG))
        first = source.identity()
        self.path.write_bytes(lines(SECOND_LEG))
        self.assertNotEqual(source.identity(), first)


class ReconcileTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.queue = EventQueue(self.root / "queue.sqlite3")
        self.addCleanup(self.queue.close)
        self.cel = self.root / "cel.csv"
        self.monitor = self.root / "monitor"
        self.monitor.mkdir()
        self.stream = AriIngest(self.queue, database=DATABASE, inbound_context="from-trunk", recordings_dir=self.monitor)

    def reconciler(self, *, now: float = NOW) -> Reconciler:
        return Reconciler(
            self.queue,
            CelFile(self.cel),
            database=DATABASE,
            inbound_context="from-trunk",
            recordings_dir=self.monitor,
            clock=lambda: now,
        )

    def write(self, rows: list[str]) -> None:
        with self.cel.open("ab") as handle:
            handle.write(lines(rows))

    def bodies(self) -> list[dict]:
        return [json.loads(event.body) for event in self.queue.due(now=int(NOW) + 1)]

    def recordings(self) -> list[dict]:
        return [body for body in self.bodies() if "recording" in body["call"]]

    def test_a_leg_the_queue_never_saw_is_enqueued_once(self) -> None:
        reconciler = self.reconciler()
        self.assertEqual(reconciler.run_once(), 0)  # no file yet: nothing to read
        self.write(COMPLETE_LEG)
        self.assertEqual(reconciler.run_once(), 1)
        self.assertEqual(self.queue.depth(), 1)
        due = self.queue.due(now=int(NOW))
        self.assertIn(b'"reconciled":true', due[0].body)
        self.assertIn(b'"direction":"in"', due[0].body)
        self.assertEqual(reconciler.run_once(), 0)
        self.assertEqual(self.queue.depth(), 1)

    def test_a_new_queue_adopts_an_existing_file_without_replaying_it(self) -> None:
        self.write(COMPLETE_LEG)
        reconciler = self.reconciler()
        self.assertEqual(reconciler.run_once(), 0)
        self.assertEqual(self.queue.depth(), 0)
        self.assertEqual(int(self.queue.meta_get(CEL_OFFSET)), self.cel.stat().st_size)
        self.write(SECOND_LEG)
        self.assertEqual(reconciler.run_once(), 1)

    def test_a_call_split_across_two_passes_is_rebuilt_whole(self) -> None:
        reconciler = self.reconciler()
        reconciler.run_once()
        self.write(COMPLETE_LEG[:2])  # the call started and was answered
        self.assertEqual(reconciler.run_once(), 0)
        self.assertEqual(self.queue.depth(), 0)
        self.assertEqual(int(self.queue.meta_get(CEL_OFFSET)), 0)
        self.write(COMPLETE_LEG[2:])  # and later hung up
        self.assertEqual(reconciler.run_once(), 1)
        body = json.loads(self.queue.due(now=int(NOW))[0].body)
        self.assertEqual(body["call"]["state"], "ended")
        self.assertEqual(body["call"]["started_at"], "2026-11-25T09:00:00Z")
        self.assertEqual(body["call"]["answered_at"], "2026-11-25T09:00:04Z")
        self.assertEqual(body["call"]["ended_at"], "2026-11-25T09:02:00Z")

    def test_a_leg_that_just_ended_waits_for_the_live_stream(self) -> None:
        reconciler = self.reconciler(now=RECENTLY_ENDED_NOW)
        reconciler.run_once()  # no file yet: byte 0
        self.write(COMPLETE_LEG)
        self.assertEqual(reconciler.run_once(), 0)
        self.assertEqual(int(self.queue.meta_get(CEL_OFFSET)), 0)
        later = self.reconciler(now=RECENTLY_ENDED_NOW + LIVE_RACE_SETTLE_SECONDS)
        self.assertEqual(later.run_once(), 1)
        self.assertEqual(int(self.queue.meta_get(CEL_OFFSET)), self.cel.stat().st_size)

    def test_an_open_leg_past_the_bound_is_sent_as_failed_and_the_offset_moves_on(self) -> None:
        reconciler = self.reconciler()
        reconciler.run_once()
        self.write(OLD_OPEN_LEG)
        self.assertEqual(reconciler.run_once(), 1)
        body = json.loads(self.queue.due(now=int(NOW))[0].body)
        self.assertEqual(body["call"]["state"], "failed")
        self.assertEqual(int(self.queue.meta_get(CEL_OFFSET)), self.cel.stat().st_size)
        self.assertEqual(reconciler.run_once(), 0)

    def test_a_rewritten_file_is_read_from_the_start(self) -> None:
        reconciler = self.reconciler()
        reconciler.run_once()
        self.write(COMPLETE_LEG)
        self.assertEqual(reconciler.run_once(), 1)
        self.cel.write_bytes(lines(SECOND_LEG))  # another file, same path
        self.assertEqual(reconciler.run_once(), 1)
        self.assertEqual(self.queue.depth(), 2)

    def test_an_identity_is_kept_with_the_offset(self) -> None:
        reconciler = self.reconciler()
        self.write(COMPLETE_LEG)
        reconciler.run_once()
        self.assertEqual(self.queue.meta_get(CEL_IDENTITY), CelFile(self.cel).identity())

    def test_a_leg_the_stream_finished_is_left_alone(self) -> None:
        reconciler = self.reconciler()
        reconciler.run_once()
        self.write(COMPLETE_LEG)
        self.queue.mark_leg("1.1", now=int(NOW))
        self.assertEqual(reconciler.run_once(), 0)
        self.assertEqual(self.queue.depth(), 0)

    def test_a_call_whose_end_event_never_arrived_is_rebuilt(self) -> None:
        reconciler = self.reconciler()
        reconciler.run_once()
        for kind in ("ChannelCreated", "ChannelStateChange"):
            self.stream.handle(ari_event(kind), now=NOW)
        self.assertEqual(self.queue.depth(), 2)
        self.write(COMPLETE_LEG)
        self.assertEqual(reconciler.run_once(), 1)
        self.assertEqual(self.queue.depth(), 3)

    def test_a_call_whose_end_event_arrived_is_not_rebuilt(self) -> None:
        reconciler = self.reconciler()
        reconciler.run_once()
        self.write(COMPLETE_LEG)
        self.stream.handle(ari_event("ChannelDestroyed"), now=NOW)
        self.assertEqual(self.queue.depth(), 1)
        self.assertEqual(reconciler.run_once(), 0)
        self.assertEqual(self.queue.depth(), 1)

    def test_a_recovered_call_with_a_recording_is_announced_with_it(self) -> None:
        reconciler = self.reconciler()
        reconciler.run_once()
        (self.monitor / "1.1.wav").write_bytes(b"RIFF")
        self.write(COMPLETE_LEG)
        self.assertEqual(reconciler.run_once(), 1)
        ready = self.recordings()
        self.assertEqual(len(ready), 1)
        self.assertEqual(ready[0]["call"], {**self.bodies()[0]["call"], "recording": "ready"})
        self.assertEqual(ready[0]["source"], "cel")
        self.assertTrue(ready[0]["reconciled"])
        self.assertEqual(ready[0]["occurred_at"], iso_utc(NOW))
        self.assertEqual(len(self.bodies()), 2)
        self.assertEqual(reconciler.run_once(), 0)
        self.assertEqual(len(self.recordings()), 1)

    def test_the_stream_and_cel_announce_one_recording_once_between_them(self) -> None:
        """A call whose one leg the stream delivered and whose other leg only CEL knows gets one announcement."""
        reconciler = self.reconciler()
        reconciler.run_once()
        (self.monitor / "1.1.wav").write_bytes(b"RIFF")
        self.stream.handle(ari_event("ChannelDestroyed"), now=NOW)
        self.assertEqual(len(self.recordings()), 1)
        self.write(COMPLETE_LEG + SAME_CALL_LEG)
        self.assertEqual(reconciler.run_once(), 1)  # the extension's leg, 1.9, is the one rebuilt
        self.assertEqual([body["call"]["uniqueid"] for body in self.bodies()], ["1.1", "1.1", "1.9"])
        self.assertEqual(len(self.recordings()), 1)

    def test_the_stream_does_not_announce_again_what_cel_announced(self) -> None:
        reconciler = self.reconciler()
        reconciler.run_once()
        (self.monitor / "1.1.wav").write_bytes(b"RIFF")
        self.write(COMPLETE_LEG)
        self.assertEqual(reconciler.run_once(), 1)
        self.assertEqual(len(self.recordings()), 1)
        self.stream.handle(ari_event("ChannelDestroyed", "1.9"), now=NOW)  # a late live end of the same call
        self.assertEqual(len(self.recordings()), 1)
        self.assertEqual(self.queue.depth(), 3)

    def test_a_leg_cel_reads_again_announces_nothing_more(self) -> None:
        """An open leg that comes first in the file holds the offset, so the finished leg's rows are read again each pass."""
        reconciler = self.reconciler()
        reconciler.run_once()
        (self.monitor / "1.1.wav").write_bytes(b"RIFF")
        self.write(UNFINISHED_LEG + COMPLETE_LEG)
        self.assertEqual(reconciler.run_once(), 1)
        self.assertEqual(int(self.queue.meta_get(CEL_OFFSET)), 0)
        self.assertEqual(len(self.recordings()), 1)
        # Both claims live as long as CEL can read the leg again, so the hourly prune never releases them inside the horizon.
        self.queue.prune(now=int(NOW) + LEG_RETENTION_SECONDS - 1)
        self.assertEqual(reconciler.run_once(), 0)
        self.assertEqual(len(self.bodies()), 2)


if __name__ == "__main__":
    unittest.main()
