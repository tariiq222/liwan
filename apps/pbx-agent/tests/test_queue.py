import json
import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from pbx_agent.queue import ACKED_RETENTION_SECONDS, LEG_RETENTION_SECONDS, EventQueue  # noqa: E402

PAYLOAD = {"database": "liwan_acme", "call": {"linkedid": "1.1", "uniqueid": "1.1"}}
# The queue file of a package from before recordings were announced: the three tables it had, and nothing else.
BEFORE_RECORDINGS = """
CREATE TABLE events (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id TEXT NOT NULL UNIQUE,
    body BLOB NOT NULL,
    created_at INTEGER NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    next_attempt_at INTEGER NOT NULL,
    acknowledged_at INTEGER
);
CREATE INDEX events_due ON events (acknowledged_at, next_attempt_at);
CREATE TABLE legs (
    leg_key TEXT PRIMARY KEY,
    first_seen_at INTEGER NOT NULL
);
CREATE TABLE meta (
    name TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
"""


class QueueTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.path = Path(self.temporary.name) / "queue.sqlite3"
        self.queue = EventQueue(self.path)
        self.addCleanup(self.queue.close)

    def test_an_event_is_stored_with_its_id_and_is_due_at_once(self) -> None:
        event_id = self.queue.enqueue(PAYLOAD, now=100)
        self.assertEqual(self.queue.depth(), 1)
        due = self.queue.due(now=100)
        self.assertEqual(len(due), 1)
        self.assertEqual(due[0].event_id, event_id)
        body = json.loads(due[0].body)
        self.assertEqual(body["event_id"], event_id)
        self.assertEqual(body["call"]["linkedid"], "1.1")

    def test_an_acknowledged_event_leaves_the_queue_but_is_kept_for_a_while(self) -> None:
        event_id = self.queue.enqueue(PAYLOAD, now=100)
        self.queue.acknowledge(event_id, now=100)
        self.assertEqual(self.queue.depth(), 0)
        self.assertEqual(self.queue.due(now=100), [])
        self.assertEqual(self.queue.prune(now=100 + ACKED_RETENTION_SECONDS - 1)[0], 0)
        self.assertEqual(self.queue.prune(now=100 + ACKED_RETENTION_SECONDS + 1)[0], 1)

    def test_a_retry_keeps_the_body_and_the_id(self) -> None:
        event_id = self.queue.enqueue(PAYLOAD, now=100)
        original = self.queue.due(now=100)[0].body
        self.queue.retry(event_id, attempts=3, next_attempt_at=108)
        self.assertEqual(self.queue.due(now=107), [])
        due = self.queue.due(now=108)
        self.assertEqual(due[0].event_id, event_id)
        self.assertEqual(due[0].attempts, 3)
        self.assertEqual(due[0].body, original)

    def test_an_unacknowledged_event_is_never_pruned(self) -> None:
        self.queue.enqueue(PAYLOAD, now=0)
        self.queue.prune(now=10 * ACKED_RETENTION_SECONDS)
        self.assertEqual(self.queue.depth(), 1)

    def test_rows_are_delivered_in_arrival_order(self) -> None:
        first = self.queue.enqueue(PAYLOAD, now=100)
        second = self.queue.enqueue(PAYLOAD, now=100)
        self.assertEqual([event.event_id for event in self.queue.due(now=100)], [first, second])

    def test_the_queue_survives_a_restart(self) -> None:
        event_id = self.queue.enqueue(PAYLOAD, now=100)
        self.queue.close()
        reopened = EventQueue(self.path)
        self.addCleanup(reopened.close)
        due = reopened.due(now=100)
        self.assertEqual([event.event_id for event in due], [event_id])

    def test_a_call_leg_is_enqueued_once(self) -> None:
        first = self.queue.enqueue_for_leg("1.1", PAYLOAD, now=100)
        self.assertIsNotNone(first)
        self.assertIsNone(self.queue.enqueue_for_leg("1.1", PAYLOAD, now=100))
        self.assertEqual(self.queue.depth(), 1)

    def test_a_leg_marked_as_finished_is_not_reconciled_and_expires(self) -> None:
        # The live path marks a leg only when the call ends, so this is the finished state.
        self.queue.mark_leg("1.1", now=100)
        self.assertIsNone(self.queue.enqueue_for_leg("1.1", PAYLOAD, now=100))
        self.assertEqual(self.queue.prune(now=100 + LEG_RETENTION_SECONDS - 1)[1], 0)
        self.assertEqual(self.queue.prune(now=100 + LEG_RETENTION_SECONDS + 1)[1], 1)
        self.assertIsNotNone(self.queue.enqueue_for_leg("1.1", PAYLOAD, now=100))

    def test_a_recording_is_announced_once_and_expires(self) -> None:
        first = self.queue.enqueue_for_recording("1.1", PAYLOAD, now=100)
        self.assertIsNotNone(first)
        self.assertIsNone(self.queue.enqueue_for_recording("1.1", PAYLOAD, now=100))
        self.assertEqual(self.queue.depth(), 1)
        self.assertEqual(self.queue.prune(now=100 + LEG_RETENTION_SECONDS - 1)[2], 0)
        self.assertEqual(self.queue.prune(now=100 + LEG_RETENTION_SECONDS + 1)[2], 1)
        self.assertIsNotNone(self.queue.enqueue_for_recording("1.1", PAYLOAD, now=100))

    def test_a_queue_file_from_before_recordings_opens_and_gains_the_table(self) -> None:
        """A package that upgrades opens the queue file it already has, and what that file knew still counts."""
        path = self.path.with_name("before-recordings.sqlite3")
        old = sqlite3.connect(path)
        old.executescript(BEFORE_RECORDINGS)
        old.execute("INSERT INTO legs (leg_key, first_seen_at) VALUES ('1.1', 100)")
        old.commit()
        old.close()
        reopened = EventQueue(path)
        self.addCleanup(reopened.close)
        self.assertIsNone(reopened.enqueue_for_leg("1.1", PAYLOAD, now=200))
        self.assertIsNotNone(reopened.enqueue_for_recording("1.1", PAYLOAD, now=200))
        self.assertEqual(reopened.depth(), 1)

    def test_a_leg_and_the_recording_of_the_same_call_do_not_claim_each_other(self) -> None:
        # A call's linkedid is the uniqueid of its first channel, so the two keys can be the same text.
        self.queue.mark_leg("1.1", now=100)
        self.assertIsNotNone(self.queue.enqueue_for_recording("1.1", PAYLOAD, now=100))
        self.queue.enqueue_for_recording("2.2", PAYLOAD, now=100)
        self.queue.mark_leg("2.2", now=100)
        self.assertIsNone(self.queue.enqueue_for_leg("2.2", PAYLOAD, now=100))
        self.assertEqual(self.queue.depth(), 2)  # the two announcements; neither claimed leg stored anything

    def test_meta_values_round_trip(self) -> None:
        self.assertEqual(self.queue.meta_get("cel_offset", "0"), "0")
        self.queue.meta_set("cel_offset", "42")
        self.assertEqual(self.queue.meta_get("cel_offset"), "42")
        self.queue.meta_set("cel_offset", "43")
        self.assertEqual(self.queue.meta_get("cel_offset"), "43")


if __name__ == "__main__":
    unittest.main()
