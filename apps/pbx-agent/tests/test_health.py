import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from pbx_agent.delivery import BATCH_SIZE, REQUEST_TIMEOUT_SECONDS, WORKER_STALE_SECONDS  # noqa: E402
from pbx_agent.health import DELIVERY_STALE_SECONDS, Liveness, snapshot  # noqa: E402

NOW = 1795597200.0
HEALTHY_WORKERS = {
    "delivery": {"last_beat_seconds": 0.5, "stale": False},
    "reconcile": {"last_beat_seconds": 2.0, "stale": False},
}


def report(**overrides) -> dict:
    fields = {
        "ari_reachable": True,
        "ari_connected": True,
        "line_endpoint": "trunk_main",
        "line_state": "online",
        "recordings_free_bytes": 10**10,
        "recordings_min_free_bytes": 536870912,
        "queue_depth": 3,
        "delivery_last_success_at": NOW - 10,
        "workers": HEALTHY_WORKERS,
        "now": NOW,
    }
    fields.update(overrides)
    return snapshot(**fields)


class HealthTest(unittest.TestCase):
    def test_a_healthy_package_reports_ok(self) -> None:
        body = report()
        self.assertEqual(body["status"], "ok")
        self.assertEqual(body["ari"], {"reachable": True, "connected": True})
        self.assertEqual(body["line"], {"endpoint": "trunk_main", "state": "online"})
        self.assertEqual(body["recordings"]["free_bytes"], 10**10)
        self.assertEqual(body["queue"], {"pending": 3})
        self.assertFalse(body["delivery"]["stale"])
        self.assertEqual(body["delivery"]["last_success_at"], "2026-11-25T08:59:50Z")
        self.assertEqual(body["workers"], HEALTHY_WORKERS)

    def test_an_unreachable_ari_degrades_the_report(self) -> None:
        body = report(ari_reachable=False, ari_connected=False)
        self.assertEqual(body["status"], "degraded")
        self.assertFalse(body["ari"]["connected"])

    def test_a_disconnected_event_stream_degrades_the_report(self) -> None:
        self.assertEqual(report(ari_connected=False)["status"], "degraded")

    def test_low_storage_degrades_the_report(self) -> None:
        self.assertEqual(report(recordings_free_bytes=1024)["status"], "degraded")

    def test_an_unreadable_disk_is_still_reported(self) -> None:
        body = report(recordings_free_bytes=None)
        self.assertEqual(body["status"], "ok")
        self.assertIsNone(body["recordings"]["free_bytes"])

    def test_a_backlog_that_never_reached_odoo_degrades_the_report(self) -> None:
        body = report(queue_depth=2, delivery_last_success_at=None)
        self.assertEqual(body["status"], "degraded")
        self.assertTrue(body["delivery"]["stale"])

    def test_a_backlog_whose_last_send_is_stale_degrades_the_report(self) -> None:
        body = report(queue_depth=1, delivery_last_success_at=NOW - DELIVERY_STALE_SECONDS - 1)
        self.assertEqual(body["status"], "degraded")

    def test_an_idle_agent_with_an_empty_queue_is_healthy(self) -> None:
        body = report(queue_depth=0, delivery_last_success_at=None)
        self.assertEqual(body["status"], "ok")
        self.assertIsNone(body["delivery"]["last_success_at"])

    def test_a_stopped_worker_degrades_the_report(self) -> None:
        workers = dict(HEALTHY_WORKERS)
        workers["delivery"] = {"last_beat_seconds": 400.0, "stale": True}
        self.assertEqual(report(workers=workers)["status"], "degraded")

    def test_an_unreadable_queue_degrades_the_report(self) -> None:
        body = report(queue_depth=None)
        self.assertEqual(body["status"], "degraded")
        self.assertIsNone(body["queue"]["pending"])

    def test_a_package_without_a_line_omits_line_state(self) -> None:
        self.assertIsNone(report(line_endpoint=None, line_state=None)["line"])


class LivenessTest(unittest.TestCase):
    def test_a_fresh_worker_is_not_stale_and_a_silent_one_is(self) -> None:
        beat = Liveness(stale_after=30)
        beat.beat(now=1000.0)
        self.assertEqual(beat.report(1000.5), {"last_beat_seconds": 0.5, "stale": False})
        self.assertTrue(beat.report(1031.0)["stale"])

    def test_a_delivery_pass_longer_than_a_slow_batch_is_not_stale(self) -> None:
        beat = Liveness(stale_after=WORKER_STALE_SECONDS)
        beat.beat(now=1000.0)
        self.assertFalse(beat.report(1000.0 + BATCH_SIZE * REQUEST_TIMEOUT_SECONDS)["stale"])
        self.assertTrue(beat.report(1000.0 + WORKER_STALE_SECONDS + 1)["stale"])


if __name__ == "__main__":
    unittest.main()
