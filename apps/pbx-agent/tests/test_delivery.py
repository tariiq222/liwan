import http.client
import json
import sys
import tempfile
import unittest
from pathlib import Path

from fakes import Recorder

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from pbx_agent.delivery import (  # noqa: E402
    BACKOFF_MAX_SECONDS,
    BATCH_SIZE,
    REQUEST_TIMEOUT_SECONDS,
    WORKER_STALE_SECONDS,
    Delivery,
    backoff_seconds,
)
from pbx_agent.queue import EventQueue  # noqa: E402
from pbx_agent.signing import EVENT_SIGNATURE_HEADER, EVENT_TIMESTAMP_HEADER, event_signature  # noqa: E402

KEY = bytes.fromhex("ab" * 32)
URL = "http://odoo:8069/api/v1/telephony/events"
PAYLOAD = {"database": "liwan_acme", "call": {"linkedid": "1.1"}}


class DeliveryTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.queue = EventQueue(Path(self.temporary.name) / "queue.sqlite3")
        self.addCleanup(self.queue.close)

    def delivery(self, post, now=100.0) -> Delivery:
        return Delivery(self.queue, url=URL, key=KEY, post=post, clock=lambda: now)

    def test_a_2xx_acknowledges_the_row(self) -> None:
        self.queue.enqueue(PAYLOAD, now=100)
        recorder = Recorder([204])
        self.assertEqual(self.delivery(recorder).run_once(), 1)
        self.assertEqual(self.queue.depth(), 0)
        self.assertEqual(recorder.calls[0]["url"], URL)

    def test_the_request_is_signed_over_the_stored_bytes(self) -> None:
        self.queue.enqueue(PAYLOAD, now=100)
        stored = self.queue.due(now=100)[0].body
        recorder = Recorder([200])
        self.delivery(recorder).run_once()
        call = recorder.calls[0]
        self.assertEqual(call["body"], stored)
        self.assertEqual(call["headers"][EVENT_TIMESTAMP_HEADER], "100")
        self.assertEqual(call["headers"][EVENT_SIGNATURE_HEADER], event_signature(KEY, 100, stored))

    def test_each_request_is_signed_with_its_own_timestamp(self) -> None:
        self.queue.enqueue(PAYLOAD, now=100)
        self.queue.enqueue(PAYLOAD, now=100)
        recorder = Recorder([200, 200])
        ticks = iter([100.0, 101.0, 102.0])
        delivery = Delivery(self.queue, url=URL, key=KEY, post=recorder, clock=lambda: next(ticks))
        self.assertEqual(delivery.run_once(), 2)
        stamps = [call["headers"][EVENT_TIMESTAMP_HEADER] for call in recorder.calls]
        self.assertEqual(stamps, ["101", "102"])
        for call, stamp in zip(recorder.calls, (101, 102)):
            self.assertEqual(call["headers"][EVENT_SIGNATURE_HEADER], event_signature(KEY, stamp, call["body"]))

    def test_a_5xx_is_retried_with_the_same_id_and_body(self) -> None:
        event_id = self.queue.enqueue(PAYLOAD, now=100)
        first = Recorder([500])
        self.assertEqual(self.delivery(first).run_once(), 0)
        self.assertEqual(self.queue.depth(), 1)
        # Not due before the backoff elapses, still the same row afterwards.
        self.delivery(Recorder([]), now=101.0).run_once()
        self.assertEqual(len(first.calls), 1)
        second = Recorder([200])
        self.delivery(second, now=102.0).run_once()
        self.assertEqual(len(second.calls), 1)
        self.assertEqual(second.calls[0]["body"], first.calls[0]["body"])
        self.assertEqual(json.loads(second.calls[0]["body"])["event_id"], event_id)
        self.assertEqual(self.queue.depth(), 0)

    def test_every_failure_class_keeps_the_row(self) -> None:
        self.queue.enqueue(PAYLOAD, now=100)
        for answer in (401, 403, 404, 422, ConnectionRefusedError("no odoo"), http.client.BadStatusLine("garbage")):
            recorder = Recorder([answer])
            self.delivery(recorder, now=100.0).run_once()
            self.assertEqual(self.queue.depth(), 1)
            # Push the row back to "due now" so the next answer is exercised.
            event = self.queue.due(now=10**9)[0]
            self.queue.retry(event.event_id, attempts=0, next_attempt_at=100)

    def test_the_last_successful_send_is_remembered(self) -> None:
        self.queue.enqueue(PAYLOAD, now=100)
        failing = self.delivery(Recorder([500]), now=100.0)
        failing.run_once()
        self.assertIsNone(failing.last_success_at)
        succeeding = self.delivery(Recorder([200]), now=102.0)
        succeeding.run_once()
        self.assertEqual(succeeding.last_success_at, 102)

    def test_the_worker_stale_bound_covers_a_full_slow_batch(self) -> None:
        self.assertGreater(WORKER_STALE_SECONDS, BATCH_SIZE * REQUEST_TIMEOUT_SECONDS)
        self.assertEqual(WORKER_STALE_SECONDS, BATCH_SIZE * REQUEST_TIMEOUT_SECONDS + 60)

    def test_the_backoff_grows_and_is_capped(self) -> None:
        self.assertEqual([backoff_seconds(attempt) for attempt in range(1, 6)], [2, 4, 8, 16, 32])
        self.assertEqual(backoff_seconds(20), BACKOFF_MAX_SECONDS)
        self.assertEqual(backoff_seconds(0), 0)

    def test_a_batch_is_bounded(self) -> None:
        for _ in range(25):
            self.queue.enqueue(PAYLOAD, now=100)
        recorder = Recorder([200] * 25)
        self.assertEqual(self.delivery(recorder).run_once(), 20)
        self.assertEqual(self.queue.depth(), 5)


if __name__ == "__main__":
    unittest.main()
